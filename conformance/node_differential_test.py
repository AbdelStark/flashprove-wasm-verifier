"""Check the Node gate without compiling proofs or needing fixture downloads."""

from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from subprocess import CompletedProcess
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from conformance.compare import Case, RunResult, compare
from conformance.evidence import write_json
from conformance.node_differential import Invocation, differential, read_json


class NodeGateTest(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        (self.root / "conformance").mkdir()
        (self.root / "conformance/excluded-fields.txt").touch()
        (self.root / "build/wasm").mkdir(parents=True)
        (self.root / "build/wasm/cp_verify.wasm").write_bytes(b"module bytes")
        (self.root / "toolchain.lock").write_text("NODE_MAJOR=24\n")
        self.m1_report = self.root / "build/conformance-m1.json"
        self.report = self.root / "build/conformance-node.json"

    def execute(self):
        with redirect_stdout(StringIO()):
            status = differential(self.root, "make")
        return status, read_json(self.report)

    def test_numeric_failure_overwrites_stale_pass_and_prevents_node_calls(self):
        write_json(self.report, {"status": "passed"})

        def m1(*_args):
            write_json(self.m1_report, {"schema": 1, "status": "failed", "counts": {}, "gates": {
                "C3": {"state": "failed", "firstDifference": {"line": 1}}, "C4": {"state": "not-run"},
            }})
            return 1

        with (patch("conformance.node_differential.m1", side_effect=m1),
              patch("conformance.node_differential.execute_case") as run):
            status, report = self.execute()
        self.assertEqual((status, report["status"]), (1, "failed"))
        self.assertEqual(report["gates"]["C3"]["firstDifference"], {"line": 1})
        self.assertEqual(report["gates"]["C1"]["state"], "not-run")
        self.assertEqual(report["gates"]["C6"]["state"], "not-run")
        run.assert_not_called()

    def test_a_changed_module_cannot_use_prior_numeric_evidence(self):
        def m1(*_args):
            write_json(self.m1_report, {"schema": 1, "status": "passed", "counts": {}, "moduleSha256": "0" * 64,
                                         "gates": {corpus: {"state": "passed"} for corpus in ("C3", "C4")}})
            return 0

        with (patch("conformance.node_differential.m1", side_effect=m1),
              patch("conformance.node_differential.subprocess.run", return_value=CompletedProcess([], 0)),
              patch("conformance.node_differential.subprocess.check_output", return_value="v24.0.0\n"),
              patch("conformance.node_differential.execute_case") as run):
            status, report = self.execute()
        self.assertEqual(status, 1)
        self.assertEqual(report["gates"]["prerequisites"]["reason"], "missing-or-invalid-evidence")
        run.assert_not_called()

    def test_safety_failure_stops_after_recording_the_case(self):
        case = Case("first", "C1", "whole")
        second = Case("second", "C1", "whole")
        guest = RunResult(0, b"YES\n", b"")
        result = compare(RunResult(1, b"NO: private-proof-text\n", b""), guest, case)
        with (patch("conformance.node_differential.prerequisites", return_value=True),
              patch("conformance.node_differential.published_cases", return_value=[Invocation(case, []), Invocation(second, [])]),
              patch("conformance.node_differential.execute_case", return_value=result) as run):
            status, report = self.execute()
        self.assertEqual(status, 1)
        self.assertEqual((report["equalityDifferences"], report["safetyViolations"]), (1, 1))
        self.assertEqual(report["gates"]["C1"]["firstDifference"], {"caseId": "first", "kind": "exit"})
        self.assertEqual(report["counts"]["C1"]["nativeVerdicts"], {"NO": 1})
        self.assertEqual(report["counts"]["C1"]["guestVerdicts"], {"YES": 1})
        self.assertEqual(report["gates"]["C6"]["state"], "not-run")
        self.assertNotIn("private-proof-text", self.report.read_text())
        self.assertEqual(run.call_count, 1)
