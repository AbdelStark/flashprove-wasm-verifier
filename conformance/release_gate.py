"""Require every release gate for one commit and write the release evidence (RFC-0010, #46).

Usage: python3 -m conformance.release_gate EVIDENCE_DIR COMMIT OUTPUT_JSON

EVIDENCE_DIR holds conformance-node.json (C1, C2, C6 with the M1 C3 and C4 gates), fuzz.json (merged
C5 shards), c7.json and repro.json, each produced by its own job. Missing, partial, failed or
inconsistent evidence fails the release: any gate not passed, any safety violation or difference,
fewer than 1,000 seeds, pins that differ from the locks, or a tested module that is not the
reproducible one."""
from hashlib import sha256
import json
from pathlib import Path
import re
import sys

MIN_SEEDS = 1000
NODE_GATES = ("prerequisites", "C1", "C2", "C3", "C4", "C6")


def lock_value(root, name, key):
    match = re.search(rf"^{key}=(\S+)$", (root / name).read_text(), re.M)
    return match.group(1) if match else None


def validate(root, evidence, commit):
    """Return (record, problems)."""
    problems = []
    pins = {"upstreamCommit": lock_value(root, "upstream.lock", "FLASHPROVE_COMMIT"),
            "toolchainSha256": sha256((root / "toolchain.lock").read_bytes()).hexdigest()}
    reports = {}
    for name in ("conformance-node", "fuzz", "c7", "repro"):
        path = evidence / f"{name}.json"
        try:
            reports[name] = json.loads(path.read_text())
        except (OSError, ValueError):
            problems.append(f"{name}: missing or unreadable evidence")
    record = {"schema": 1, "commit": commit, **pins, "status": "failed", "gates": {}, "counts": {}}
    node, fuzz, c7, repro = (reports.get(name) for name in ("conformance-node", "fuzz", "c7", "repro"))

    if repro is not None:
        if repro.get("identical") is not True or repro.get("commit") != commit:
            problems.append("repro: modules not identical, or built from another commit")
        record["moduleSha256"] = repro.get("moduleSha256")
        record["gates"]["repro"] = "passed" if repro.get("identical") is True else "failed"
    module = record.get("moduleSha256")

    for name, report in (("conformance-node", node), ("fuzz", fuzz)):
        if report is None:
            continue
        if report.get("schema") != 1:
            problems.append(f"{name}: unknown schema")
        for key, value in pins.items():
            if report.get(key) != value:
                problems.append(f"{name}: {key} {report.get(key)} does not match the lock ({value})")
        if module is None or report.get("moduleSha256") != module:
            problems.append(f"{name}: tested module {report.get('moduleSha256')} is not the reproducible module {module}")
        if report.get("safetyViolations") != 0:
            problems.append(f"{name}: safety violations {report.get('safetyViolations')}")
        if report.get("equalityDifferences") != 0:
            problems.append(f"{name}: equality differences {report.get('equalityDifferences')}")
        if report.get("status") != "passed":
            problems.append(f"{name}: status {report.get('status')}")

    if node is not None:
        for gate in NODE_GATES:
            state = node.get("gates", {}).get(gate, {}).get("state")
            record["gates"][gate] = state or "missing"
            if state != "passed":
                problems.append(f"conformance-node: gate {gate} is {state or 'missing'}")
        for corpus in ("C1", "C2", "C6"):
            if not node.get("counts", {}).get(corpus):
                problems.append(f"conformance-node: no {corpus} cases")
            else:
                record["counts"][corpus] = node["counts"][corpus]

    if fuzz is not None:
        requested, executed = fuzz.get("requestedSeeds"), fuzz.get("executedSeeds")
        record["gates"]["C5"] = fuzz.get("gates", {}).get("C5", {}).get("state") or "missing"
        if record["gates"]["C5"] != "passed":
            problems.append(f"fuzz: gate C5 is {record['gates']['C5']}")
        if type(requested) is not int or requested < MIN_SEEDS or executed != requested:
            problems.append(f"fuzz: {executed} of {requested} seeds executed; at least {MIN_SEEDS} required")
        if fuzz.get("shard", {}) != {"index": 0, "count": 1}:
            problems.append("fuzz: evidence is a shard, not the merged report")
        record["counts"]["C5"] = {"seeds": executed, **fuzz.get("counts", {}).get("C5", {})}

    if c7 is not None:
        record["gates"]["C7"] = c7.get("status") or "missing"
        if c7.get("status") != "passed" or c7.get("commit") != commit:
            problems.append("c7: not passed for this commit")

    for gate in ("repro", *NODE_GATES, "C5", "C7"):
        record["gates"].setdefault(gate, "missing")
    record["status"] = "passed" if not problems else "failed"
    record["problems"] = problems
    return record, problems


def main(argv):
    if len(argv) != 4:
        print(__doc__, file=sys.stderr)
        return 2
    record, problems = validate(Path.cwd(), Path(argv[1]), argv[2])
    Path(argv[3]).write_text(json.dumps(record, indent=2, sort_keys=True) + "\n")
    for problem in problems:
        print(f"release gate: {problem}", file=sys.stderr)
    if not problems:
        print(f"release gate: passed for {argv[2][:12]}; module {record['moduleSha256'][:12]}; "
              f"{record['counts']['C5']['seeds']} seeds; gates {', '.join(sorted(record['gates']))}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
