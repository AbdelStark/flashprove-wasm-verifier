"""Compare published proofs and argument boundaries through the public Node command."""

from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
import os
import re
import signal
import subprocess
import sys
from tempfile import TemporaryDirectory

from conformance.compare import Case, RunResult, compare, first_byte_difference, lines, load_exclusions
from conformance.evidence import write_json
from conformance.m1 import lock_value, m1, read_json
from conformance.native_c1 import FIXTURES, cases


HOST_REFUSAL = b"NOT CHECKED: internal-stage\n"
MODES = {"whole": "wholeCalls", "key": "partCalls", "leaf": "partCalls", "plan": "plans"}


@dataclass(frozen=True)
class Invocation:
    case: Case
    args: list[str]
    expected: tuple[int, str] | None = None
    full_streams: bool = False


def published_cases():
    for family, policy in FIXTURES.items():
        for name, args, status, verdict in cases(f"examples/{family}", policy):
            mode = "plan" if name.startswith("plan-") else name
            full_streams = family == "accepted-proof" and mode == "whole"
            expected = (status, verdict)
            yield Invocation(Case(f"{family}/{name}", "C1", mode),
                             [*args, "-j", "1"] if full_streams else args, expected, full_streams)
            if full_streams:
                yield Invocation(Case(f"{family}/show-stages", "C1", "whole"), [*args, "-show-stages"], expected)


def argument_cases():
    fixture = "examples/accepted-proof"
    published = list(cases(fixture, None))
    whole, key = published[0][1], published[1][1]
    files, identity = whole[:5], whole[5:]
    clipped = "accepted-proof-clipped-gap"
    policy = FIXTURES[clipped]
    clip = next(cases(f"examples/{clipped}", policy))[1]
    wrong_policy = "clipped-gap," + ",".join(map(str, (policy[0] + 1, *policy[1:])))
    for name, args in (
        ("missing-id", [*files, "-q"]),
        ("malformed-id", [*files, "-id", "g" * 64, "-q"]),
        ("wrong-id", [*files, "-id", "0" * 64, "-q"]),
        ("wrong-policy", [*clip[:-2], "-policy", wrong_policy]),
        ("missing-policy", clip[:-2]),
        ("bits-malformed", [*whole, "-bits", "nan"]),
        ("bits-below-bar", [*whole, "-bits", "127"]),
        ("bits-at-bar", [*whole, "-bits", "128"]),
        ("bits-above-digest", [*whole, "-bits", "129"]),
        ("next-token", [*whole, "-next-token"]),
        ("no-proof-of-work", [*clip, "-no-proof-of-work"]),
        ("misplaced-option", ["-q", *whole]),
        ("duplicate-id", [*whole, *identity]),
        ("missing-option-value", [*whole, "-j"]),
        ("relative-path-spelling", [*(f"./{path}" for path in files), *identity]),
    ):
        yield Invocation(Case(name, "C6", "whole"), args)
    for threads in (0, 1, 256, 257):
        yield Invocation(Case(f"threads-{threads}", "C6", "key"), [*key, "-j", str(threads)])


def run(command, cwd):
    with subprocess.Popen(command, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          start_new_session=True) as proc:
        try:
            stdout, stderr = proc.communicate(timeout=600)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.communicate()
            raise
        return RunResult(proc.returncode, stdout, stderr)


def run_pair(root, args, cwd):
    native = run([root / "build/native/cp_verify", *args], cwd)
    guest = run([root / "bin/fpv", *args], cwd)
    if guest.status == 5 and guest.stdout == HOST_REFUSAL and not guest.stderr:
        guest = RunResult(guest.status, guest.stdout, guest.stderr, "host-internal")
    return native, guest


def execute_case(root, directory, invocation, exclusions):
    case = invocation.case
    cwd = directory / case.corpus / case.id
    cwd.mkdir(parents=True)
    (cwd / "examples").symlink_to(root / ".upstream/FlashProve/examples", target_is_directory=True)
    native, guest = run_pair(root, invocation.args, cwd)
    outputs = root / "build/node-conformance" / case.corpus / case.id
    outputs.mkdir(parents=True, exist_ok=True)
    for runtime, result in (("native", native), ("node", guest)):
        (outputs / f"{runtime}.stdout").write_bytes(result.stdout)
        (outputs / f"{runtime}.stderr").write_bytes(result.stderr)
    if invocation.expected is not None:
        status, verdict = invocation.expected
        if native.status != status or native.stdout.splitlines()[-1:] != [verdict.encode("ascii")]:
            raise ValueError("published oracle did not match its expected outcome")
    result = compare(native, guest, case, exclusions)
    if result["equal"] and (invocation.full_streams or native.status == 2):
        difference = first_byte_difference("stdout", lines(native.stdout), lines(guest.stdout), exclusions)
        difference = difference or first_byte_difference("stderr", lines(native.stderr), lines(guest.stderr), exclusions)
        if difference:
            result.update(equal=False, firstDifference=difference)
    write_json(outputs / "case.json", result)
    return result


def corpus_gate(root, directory, report, corpus, invocations, exclusions):
    gate = report["gates"][corpus]
    gate["state"] = "failed"
    counts = dict.fromkeys(MODES.values(), 0)
    counts.update(nativeVerdicts={}, guestVerdicts={})
    report["counts"][corpus] = counts
    equal = True
    seen = set()
    for invocation in invocations:
        case = invocation.case
        if case.corpus != corpus or case.id in seen:
            gate["reason"] = "invalid-case-matrix"
            return False
        seen.add(case.id)
        try:
            result = execute_case(root, directory, invocation, exclusions)
        except (OSError, ValueError, subprocess.SubprocessError):
            gate["reason"] = "invalid-or-unavailable-case"
            gate["caseId"] = case.id
            return False
        report["cases"].append(result)
        counts[MODES[case.mode]] += 1
        for counter, value in (("nativeVerdicts", result["nativeVerdict"]), ("guestVerdicts", result["guestVerdict"])):
            verdict = (value or "no-verdict").split(":", 1)[0]
            counts[counter][verdict] = counts[counter].get(verdict, 0) + 1
        if not result["equal"]:
            report["equalityDifferences"] += 1
            gate.setdefault("firstDifference", {"caseId": case.id, **result["firstDifference"]})
            equal = False
        details = result.get("firstDifference", result.get("guestVerdict"))
        print(f"Node {corpus}: {case.id} ({case.mode}) exit={result['guestExit']} {details or 'no verdict'}", flush=True)
        if result["safetyViolation"]:
            report["safetyViolations"] += 1
            gate["reason"] = "safety-violation"
            return False
    if not seen:
        gate["reason"] = "missing-cases"
        return False
    if equal:
        gate["state"] = "passed"
    else:
        gate["reason"] = "equality-difference"
    return equal


def prerequisites(root, make, report):
    gate = report["gates"]["prerequisites"]
    gate["state"] = "failed"
    status = m1(root, make)
    evidence = read_json(root / "build/conformance-m1.json")
    if evidence["schema"] != 1:
        raise ValueError("invalid M1 evidence version")
    for name in ("upstreamCommit", "toolchainSha256", "moduleSha256"):
        if name in evidence:
            report[name] = evidence[name]
    for corpus in ("C3", "C4"):
        report["gates"][corpus] = evidence["gates"][corpus]
        if corpus in evidence["counts"]:
            report["counts"][corpus] = evidence["counts"][corpus]
    if status or evidence["status"] != "passed" or any(
        report["gates"][corpus]["state"] != "passed" for corpus in ("C3", "C4")
    ):
        gate["reason"] = "m1-gate-failed"
        return False
    if subprocess.run([make, "host-build"], cwd=root, check=False).returncode:
        gate["reason"] = "host-build-failed"
        return False
    version = subprocess.check_output(["node", "--version"], cwd=root, text=True).strip()
    major = lock_value(root, "toolchain.lock", "NODE_MAJOR", r"[0-9]+")
    module = root / "build/wasm/cp_verify.wasm"
    if re.fullmatch(rf"v{major}\.[0-9]+\.[0-9]+", version) is None or (
        sha256(module.read_bytes()).hexdigest() != report["moduleSha256"]
    ):
        raise ValueError("invalid runtime or changed module")
    report["runtime"]["version"] = version
    gate["state"] = "passed"
    return True


def differential(root, make):
    build = root / "build"
    build.mkdir(exist_ok=True)
    destination = build / "conformance-node.json"
    destination.unlink(missing_ok=True)
    report = {"schema": 1, "runtime": {"name": "node"}, "cases": [], "counts": {}, "status": "failed",
              "equalityDifferences": 0, "safetyViolations": 0,
              "gates": {name: {"state": "not-run"} for name in ("prerequisites", "C3", "C4", "C1", "C6")}}
    with TemporaryDirectory(prefix=".node-conformance-", dir=build) as temporary:
        directory = Path(temporary)
        try:
            exclusions = load_exclusions(root / "conformance/excluded-fields.txt")
            if prerequisites(root, make, report):
                c1 = corpus_gate(root, directory, report, "C1", published_cases(), exclusions)
                if not report["safetyViolations"]:
                    c6 = corpus_gate(root, directory, report, "C6", argument_cases(), exclusions)
                    if c1 and c6:
                        report["status"] = "passed"
        except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
            report["gates"]["prerequisites"] = {"state": "failed", "reason": "missing-or-invalid-evidence"}
        finally:
            pending = directory / "report.json"
            write_json(pending, report)
            pending.replace(destination)
    print(f"Node conformance: {report['status']}; {len(report['cases'])} cases, "
          f"{report['equalityDifferences']} equality differences, {report['safetyViolations']} safety violations", flush=True)
    for corpus, counts in report["counts"].items():
        print(f"Node {corpus} counts: {counts}", flush=True)
    print("Node conformance: report build/conformance-node.json", flush=True)
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(differential(Path.cwd(), sys.argv[1]))
