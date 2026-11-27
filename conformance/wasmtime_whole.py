"""Run every published whole call through the independent Wasmtime host and compare it with native (#39).

The Wasmtime host is the Python embedding at the toolchain.lock version, installed from hash-pinned
wheels. Each call runs the parent and three serial stages, each child replayed in a fresh store. The
report keeps replay evidence (each fork's observation digest, replayed clock reads, child status and
pipe bytes) apart from linear-memory evidence (peak pages per instance). A host fault must end in
exit 5 with exactly NOT CHECKED: internal-stage."""

from hashlib import sha256
from importlib.metadata import files as package_files, version
from pathlib import Path
import platform
import subprocess
import sys
from time import monotonic_ns

from conformance.compare import Case, RunResult, compare, load_exclusions
from conformance.evidence import write_json
from conformance.memory import PARENT_PAGES, STAGES, invocation, snapshot
from conformance.native_c1 import BUILD, FIXTURES, ROOT, UPSTREAM
from host.wasmtime.stages import FAILED, MAX_PAGES, PartRunner

MODULE = BUILD / "wasm/cp_verify.wasm"
NATIVE = BUILD / "native/cp_verify"
REPORT = BUILD / "conformance-wasmtime.json"
# A request stage cap below the measured envelope: the call must reach it and refuse (ADR 0006).
REFUSAL_PAGES = 8192


def lock(name, key):
    for line in (ROOT / name).read_text().splitlines():
        if line.startswith(key + "="):
            return line.split("=", 1)[1]
    raise ValueError(f"{name}: no {key}")


def runtime():
    """The installed embedding must be the pinned version; record its native library digest."""
    installed = version("wasmtime")
    if installed != lock("toolchain.lock", "WASMTIME_VERSION"):
        raise ValueError(f"wasmtime {installed} is not the pinned version")
    libraries = [path for path in package_files("wasmtime") or [] if "libwasmtime" in path.name]
    if not libraries:
        raise ValueError("no Wasmtime C API library in the installed package")
    library = Path(libraries[0].locate())
    return {"name": "wasmtime-python", "version": installed, "library": library.name,
            "librarySha256": sha256(library.read_bytes()).hexdigest()}


def guest(family, pages):
    args, _ = invocation(family)
    files, _ = snapshot(family)
    peaks, replays = {}, []

    def observe(fork, event, count):
        if event == "end":
            stage = "parent" if fork is None else STAGES[fork.ordinal]
            peaks[stage] = max(peaks.get(stage, 0), count)

    runner = PartRunner(MODULE, max_pages=pages, parent_pages=PARENT_PAGES, observe=observe)
    begin = monotonic_ns()
    result = runner.run_whole(tuple(arg.encode() for arg in ("cp_verify", *args)), files, evidence=replays)
    elapsed = monotonic_ns() - begin
    return args, RunResult(result.status, result.stdout, result.stderr), {"peakLinearPages": peaks}, replays, elapsed


def main():
    exclusions = load_exclusions()
    report = {"schema": 1, "upstreamCommit": lock("upstream.lock", "FLASHPROVE_COMMIT"),
              "toolchainSha256": sha256((ROOT / "toolchain.lock").read_bytes()).hexdigest(),
              "moduleSha256": sha256(MODULE.read_bytes()).hexdigest(), "runtime": runtime(),
              "host": {"machine": platform.machine(), "system": platform.system()},
              "status": "failed", "cases": [], "safetyViolations": 0, "equalityDifferences": 0}
    compare_native = NATIVE.exists()
    for family in FIXTURES:
        args, result, memory, replays, elapsed = guest(family, MAX_PAGES)
        case = {"caseId": f"wasmtime-whole-{family}", "fixture": family, "guestExit": result.status,
                "elapsedNs": elapsed, "memory": memory, "replays": replays}
        if len(replays) != len(STAGES) or [r["ordinal"] for r in replays] != list(range(len(STAGES))):
            raise ValueError(f"{family}: expected one replayed child per stage, got {replays}")
        if compare_native:
            native = subprocess.run([str(NATIVE), *args], cwd=UPSTREAM, capture_output=True, env={"LC_ALL": "C"},
                                    timeout=600, check=False)
            row = compare(RunResult(native.returncode, native.stdout, native.stderr), result,
                          Case(case["caseId"], "C1", "whole"), exclusions)
            case.update(nativeExit=native.returncode, equal=row["equal"], safetyViolation=row["safetyViolation"],
                        **({"firstDifference": row["firstDifference"]} if "firstDifference" in row else {}))
            report["equalityDifferences"] += int(not row["equal"])
            report["safetyViolations"] += int(row["safetyViolation"])
        verdict = result.stdout.rstrip(b"\n").rsplit(b"\n", 1)[-1].decode("ascii", "replace")
        case["guestVerdict"] = verdict
        report["cases"].append(case)
        print(f"Wasmtime whole call: {family} exit={result.status} {verdict}"
              + (f", native {'equal' if case['equal'] else 'DIFFERS'}" if compare_native else "")
              + f", peak pages {memory['peakLinearPages']}", flush=True)

    # A host fault refuses: the request stage cannot grow past a lowered cap.
    _, refused, memory, replays, _ = guest("full-size", REFUSAL_PAGES)
    refusal_ok = refused.status == 5 and refused.stdout == FAILED and refused.stderr == b""
    report["refusal"] = {"childPages": REFUSAL_PAGES, "guestExit": refused.status, "exact": refusal_ok,
                         "memory": memory, "stagesStarted": len(replays)}
    print(f"Wasmtime whole call: full-size at {REFUSAL_PAGES} child pages exit={refused.status} "
          f"{'exact refusal' if refusal_ok else 'NOT the exact refusal'}", flush=True)

    passed = refusal_ok and all(case.get("equal", True) and case["guestExit"] == 0 for case in report["cases"])
    passed = passed and not report["safetyViolations"] and (compare_native or "--guest-only" in sys.argv)
    report["status"] = "passed" if passed else "failed"
    report["nativeCompared"] = compare_native
    write_json(REPORT, report)
    print(f"Wasmtime whole calls: {report['status']}, report in {REPORT.relative_to(ROOT)}", flush=True)
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
