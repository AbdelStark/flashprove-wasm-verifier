"""The release gate fails on missing, partial, failed or inconsistent evidence (#46)."""
import copy
from hashlib import sha256
import json
from pathlib import Path
import tempfile
import unittest

from conformance.release_gate import lock_value, validate

ROOT = Path(__file__).resolve().parent.parent
COMMIT = "c" * 40
MODULE = "a" * 64
PINS = {"upstreamCommit": lock_value(ROOT, "upstream.lock", "FLASHPROVE_COMMIT"),
        "toolchainSha256": sha256((ROOT / "toolchain.lock").read_bytes()).hexdigest()}
GOOD = {
    "conformance-node": {"schema": 1, **PINS, "moduleSha256": MODULE, "status": "passed", "safetyViolations": 0,
                         "equalityDifferences": 0,
                         "gates": {name: {"state": "passed"} for name in ("prerequisites", "C1", "C2", "C3", "C4", "C6")},
                         "counts": {"C1": {"whole": 4}, "C2": {"whole": 40}, "C6": {"whole": 30}}},
    "fuzz": {"schema": 1, **PINS, "moduleSha256": MODULE, "status": "passed", "safetyViolations": 0,
             "equalityDifferences": 0, "requestedSeeds": 1000, "executedSeeds": 1000,
             "shard": {"index": 0, "count": 1}, "gates": {"C5": {"state": "passed"}},
             "counts": {"C5": {"nativeExits": {"1": 1000}}}},
    "c7": {"status": "passed", "commit": COMMIT},
    "repro": {"identical": True, "commit": COMMIT, "moduleSha256": MODULE},
}


class ReleaseGate(unittest.TestCase):
    def run_gate(self, evidence):
        with tempfile.TemporaryDirectory() as directory:
            for name, report in evidence.items():
                if report is not None:
                    (Path(directory) / f"{name}.json").write_text(json.dumps(report))
            return validate(ROOT, Path(directory), COMMIT)

    def changed(self, name, path, value):
        evidence = copy.deepcopy(GOOD)
        target = evidence[name]
        for key in path[:-1]:
            target = target[key]
        target[path[-1]] = value
        return evidence

    def assertFails(self, evidence, fragment):
        record, problems = self.run_gate(evidence)
        self.assertEqual(record["status"], "failed")
        self.assertTrue(any(fragment in problem for problem in problems), f"{fragment!r} not in {problems}")

    def test_complete_evidence_passes(self):
        record, problems = self.run_gate(GOOD)
        self.assertEqual(problems, [])
        self.assertEqual(record["status"], "passed")
        self.assertEqual(record["counts"]["C5"]["seeds"], 1000)
        self.assertTrue(all(state == "passed" for state in record["gates"].values()))

    def test_missing_evidence(self):
        for name in GOOD:
            self.assertFails({**GOOD, name: None}, f"{name}: missing")

    def test_failed_prerequisite_and_missing_cases(self):
        self.assertFails(self.changed("conformance-node", ["gates", "prerequisites", "state"], "failed"),
                         "gate prerequisites is failed")
        evidence = copy.deepcopy(GOOD)
        del evidence["conformance-node"]["gates"]["C6"]
        self.assertFails(evidence, "gate C6 is missing")
        self.assertFails(self.changed("conformance-node", ["counts", "C2"], {}), "no C2 cases")

    def test_mismatched_pins_and_module(self):
        self.assertFails(self.changed("fuzz", ["upstreamCommit"], "0" * 40), "upstreamCommit")
        self.assertFails(self.changed("conformance-node", ["toolchainSha256"], "0" * 64), "toolchainSha256")
        self.assertFails(self.changed("conformance-node", ["moduleSha256"], "b" * 64), "is not the reproducible module")
        self.assertFails(self.changed("repro", ["identical"], False), "modules not identical")
        self.assertFails(self.changed("repro", ["commit"], "d" * 40), "another commit")

    def test_safety_violation_and_differences(self):
        self.assertFails(self.changed("fuzz", ["safetyViolations"], 1), "safety violations 1")
        self.assertFails(self.changed("conformance-node", ["equalityDifferences"], 2), "equality differences 2")

    def test_partial_or_unmerged_seeds(self):
        self.assertFails(self.changed("fuzz", ["executedSeeds"], 999), "999 of 1000 seeds")
        evidence = self.changed("fuzz", ["requestedSeeds"], 500)
        evidence["fuzz"]["executedSeeds"] = 500
        self.assertFails(evidence, "at least 1000 required")
        self.assertFails(self.changed("fuzz", ["shard"], {"index": 1, "count": 4}), "not the merged report")
        self.assertFails(self.changed("c7", ["commit"], "d" * 40), "c7: not passed")


if __name__ == "__main__":
    unittest.main()
