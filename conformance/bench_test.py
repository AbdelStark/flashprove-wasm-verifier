"""The benchmark gate rejects incomplete or incomparable reports (#40)."""
import copy
from hashlib import sha256
import unittest

from conformance.bench import BROWSER_SCOPE, PROCESS_SCOPE, RUNTIMES, SCOPES, validate
from conformance.native_c1 import UPSTREAM

DIGEST = sha256((UPSTREAM / "examples/full-size/SHA256SUMS").read_bytes()).hexdigest()


def row(runtime):
    return {"schema": 1, "runtime": runtime, "runtimeVersion": "1", "cpu": "CPU", "os": "Linux", "machine": "x86_64",
            "timer": "t", "memoryMethod": "m", "scope": SCOPES[runtime], "warmupCount": 1,
            "samplesNs": [3, 1, 2], "medianNs": 2, "fixture": "full-size", "fixtureSha256": DIGEST,
            "args": ["examples/full-size/config", "-id", "x"], "exitCode": 0, "verdict": "YES"}


REPORT = {"schema": 1, "rows": [row(runtime) for runtime in RUNTIMES]}


class BenchGate(unittest.TestCase):
    def broken(self, runtime, **changes):
        report = copy.deepcopy(REPORT)
        for item in report["rows"]:
            if item["runtime"] == runtime:
                item.update(changes)
        return validate(report)

    def assertProblem(self, problems, fragment):
        self.assertTrue(any(fragment in problem for problem in problems), f"{fragment!r} not in {problems}")

    def test_complete_report(self):
        self.assertEqual(validate(REPORT), [])
        self.assertNotEqual(PROCESS_SCOPE, BROWSER_SCOPE)

    def test_missing_runtime(self):
        report = copy.deepcopy(REPORT)
        report["rows"] = [item for item in report["rows"] if item["runtime"] != "bend"]
        self.assertProblem(validate(report), "bend: missing row")

    def test_samples_and_median(self):
        self.assertProblem(self.broken("node", samplesNs=[1, 2]), "needs 3 positive integer samples")
        self.assertProblem(self.broken("node", samplesNs=[1, 2, 0]), "needs 3 positive integer samples")
        self.assertProblem(self.broken("node", medianNs=3), "median does not match")
        self.assertProblem(self.broken("node", warmupCount=0), "one warmup")

    def test_incompatible_scope_or_call(self):
        self.assertProblem(self.broken("chromium", scope=PROCESS_SCOPE), "chromium: undeclared measurement scope")
        self.assertProblem(self.broken("wasmtime", args=["-plan", "id"]), "not a whole call")
        self.assertProblem(self.broken("firefox", cpu="Other CPU"), "another CPU than native")

    def test_verdicts_and_fixture(self):
        self.assertProblem(self.broken("webkit", exitCode=5, verdict="NOT CHECKED: internal-stage"), "differs from native")
        self.assertProblem(self.broken("native", exitCode=1, verdict="NO: x"), "reference call did not pass")
        self.assertProblem(self.broken("bend", fixtureSha256="0" * 64), "unknown fixture digest")
        self.assertProblem(self.broken("node", runtimeVersion=""), "missing runtimeVersion")


if __name__ == "__main__":
    unittest.main()
