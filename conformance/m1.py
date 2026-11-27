"""Run the M1 prerequisites and retain only redacted conformance evidence."""

from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess
import sys
from tempfile import TemporaryDirectory

from conformance.evidence import write_json
from conformance.native_c1 import FIXTURES


CORPORA = {
    "C3": {"sharedPrograms": 4, "nativeOnlyPrograms": 3, "fieldRecords": 113, "hashVectors": 57},
    "C4": {"policies": 4, "tables": 16, "tableEntries": 812044, "ropeSweepEntries": 520192},
}
CASES = {
    f"{family}/{stage}": ("plan" if stage.startswith("plan-") else stage)
    for family in FIXTURES
    for stage in ("key", "leaf", "plan-id", "plan-accounting", "plan-arrays", "plan-request")
}


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def lock_value(root, file, key, pattern):
    match = re.search(rf"^{key}=({pattern})$", (root / file).read_text(), re.MULTILINE)
    if match is None:
        raise ValueError(f"missing evidence for {key}")
    return match[1]


def run_gate(command, root, report, name):
    status = subprocess.run(command, cwd=root, check=False).returncode
    if status:
        report["gates"][name]["exit"] = status if status > 0 else 128 - status
    return status


def numeric_gate(root, work, report, corpus):
    path = work / f"{corpus}.json"
    gate = report["gates"][corpus]
    gate["state"] = "failed"
    status = run_gate([f"conformance/{corpus.lower()}.sh", str(path)], root, report, corpus)
    if not path.is_file():
        gate["reason"] = "runner-failed" if status else "missing-evidence"
        return False
    evidence = read_json(path)
    counts = evidence["counts"]
    if evidence["schema"] != 1 or type(counts) is not dict or any(
        key not in CORPORA[corpus] or type(value) is not int or not 0 <= value <= CORPORA[corpus][key]
        for key, value in counts.items()
    ):
        raise ValueError("invalid numeric evidence")
    report["counts"][corpus] = counts
    if "firstDifference" in evidence:
        gate["firstDifference"] = evidence["firstDifference"]
        report["equalityDifferences"] += 1
        return False
    if status or counts != CORPORA[corpus]:
        gate["reason"] = "runner-failed" if status else "incomplete-evidence"
        return False
    gate["state"] = "passed"
    return True


def c1_gate(root, work, report):
    path = work / "C1"
    path.mkdir()
    gate = report["gates"]["C1"]
    gate["state"] = "failed"
    command = [root / ".toolchain/wasmtime-python/bin/python", "-B", "-m", "conformance.wasmtime_c1",
               "--evidence", str(path)]
    status = run_gate(command, root, report, "C1")
    counts = report["counts"]["C1"] = {"wholeCalls": 0, "partCalls": 0, "plans": 0}
    seen = set()
    for file in sorted(path.glob("*.json")):
        case = read_json(file)
        case_id, mode = case["caseId"], case["mode"]
        if (case["schema"] != 1 or case["corpus"] != "C1" or CASES.get(case_id) != mode or case_id in seen
                or type(case["equal"]) is not bool or type(case["safetyViolation"]) is not bool
                or case["equal"] == ("firstDifference" in case)):
            raise ValueError("invalid C1 evidence")
        seen.add(case_id)
        report["cases"].append(case)
        counts["plans" if mode == "plan" else "partCalls"] += 1
        report["equalityDifferences"] += int(not case["equal"])
        report["safetyViolations"] += int(case["safetyViolation"])
        if "firstDifference" in case and "firstDifference" not in gate:
            gate["firstDifference"] = {"caseId": case_id, **case["firstDifference"]}
    if report["equalityDifferences"] or report["safetyViolations"]:
        gate["reason"] = "comparison-failed"
        return False
    if status or seen != CASES.keys():
        gate["reason"] = "runner-failed" if status else "missing-cases"
        return False
    gate["state"] = "passed"
    return True


def m1(root, make):
    build = root / "build"
    build.mkdir(exist_ok=True)
    destination = build / "conformance-m1.json"
    destination.unlink(missing_ok=True)
    report = {"schema": 1, "cases": [], "counts": {}, "equalityDifferences": 0, "safetyViolations": 0,
              "gates": {name: {"state": "not-run"} for name in ("prerequisites", *CORPORA, "C1")},
              "status": "failed"}
    with TemporaryDirectory(prefix=".m1-", dir=build) as directory:
        work = Path(directory)
        gate = report["gates"]["prerequisites"]
        try:
            gate["state"] = "failed"
            report["upstreamCommit"] = lock_value(root, "upstream.lock", "FLASHPROVE_COMMIT", "[0-9a-f]{40}")
            report["toolchainSha256"] = sha256((root / "toolchain.lock").read_bytes()).hexdigest()
            report["runtime"] = {"name": "wasmtime", "version": lock_value(
                root, "toolchain.lock", "WASMTIME_VERSION", r"[0-9]+\.[0-9]+\.[0-9]+")}
            if not run_gate([make, "m1-prerequisites"], root, report, "prerequisites"):
                module = build / "wasm/cp_verify.wasm"
                report["moduleSha256"] = sha256(module.read_bytes()).hexdigest()
                audit = read_json(module.with_name("audit-observed.json"))
                # The reviewed inventory, with only the changes an opt-in candidate declares.
                sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
                from audit_wasm import candidate, reviewed_inventory
                if audit != reviewed_inventory(candidate(root), root / "port/audit.json"):
                    raise ValueError("unreviewed audit evidence")
                report["counts"]["audit"] = {
                    "dependencies": len(audit["dependencies"]), "typedImports": len(audit["imports"]),
                    "cSymbols": len(set(audit["direct_c_symbols"]) | set(audit["linked_c_symbols"])),
                }
                gate["state"] = "passed"
                for corpus in CORPORA:
                    gate = report["gates"][corpus]
                    if not numeric_gate(root, work, report, corpus):
                        break
                else:
                    gate = report["gates"]["C1"]
                    if c1_gate(root, work, report):
                        report["status"] = "passed"
            else:
                gate["reason"] = "command-failed"
        except (OSError, ValueError, KeyError, TypeError):
            gate["state"] = "failed"
            gate["reason"] = "missing-or-invalid-evidence"
        finally:
            pending = work / "report.json"
            write_json(pending, report)
            pending.replace(destination)
    print(f"M1: {report['status']}; report build/conformance-m1.json", flush=True)
    for name, result in report["gates"].items():
        print(f"M1 {name}: {json.dumps(result, sort_keys=True)}", flush=True)
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(m1(Path.cwd(), sys.argv[1]))
