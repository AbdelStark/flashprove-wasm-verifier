"""Check that M1 cannot pass with missing or differing evidence."""

import io
from contextlib import redirect_stdout
from pathlib import Path
from subprocess import CompletedProcess
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from conformance.c3 import compare as compare_numeric
from conformance.compare import Case, RunResult, compare
from conformance.evidence import Mismatch, numeric_evidence, write_json
from conformance.m1 import CASES, CORPORA, m1, read_json


class M1Test(unittest.TestCase):
    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        (self.root / "upstream.lock").write_text("FLASHPROVE_COMMIT=" + "a" * 40 + "\n")
        (self.root / "toolchain.lock").write_text("WASMTIME_VERSION=51.0.0\n")
        wasm = self.root / "build/wasm"
        wasm.mkdir(parents=True)
        (wasm / "cp_verify.wasm").write_bytes(b"module bytes")
        (self.root / "port").mkdir()
        audit = {"dependencies": [], "direct_c_symbols": [], "linked_c_symbols": [], "imports": []}
        write_json(self.root / "port/audit.json", audit)
        write_json(wasm / "audit-observed.json", audit)
        self.path = self.root / "build/conformance-m1.json"

    def execute(self, runner=None):
        with redirect_stdout(io.StringIO()):
            if runner is None:
                status = m1(self.root, str(self.root / "missing-make"))
            else:
                with patch("conformance.m1.subprocess.run", side_effect=runner):
                    status = m1(self.root, "make")
        return status, read_json(self.path)

    def test_missing_prerequisite_overwrites_stale_success(self):
        write_json(self.path, {"status": "passed"})
        status, report = self.execute()
        self.assertEqual(status, 1)
        self.assertEqual(report["status"], "failed")
        self.assertEqual(report["gates"]["prerequisites"]["reason"], "missing-or-invalid-evidence")
        self.assertEqual(report["gates"]["C3"]["state"], "not-run")

    def test_successful_runner_must_produce_current_evidence(self):
        commands = []

        def run(command, **_):
            commands.append(command[0])
            return CompletedProcess(command, 0)

        status, report = self.execute(run)
        self.assertEqual(status, 1)
        self.assertEqual(report["gates"]["C3"]["reason"], "missing-evidence")
        self.assertEqual(report["gates"]["C1"]["state"], "not-run")
        self.assertEqual(commands, ["make", "conformance/c3.sh"])

    def test_exact_difference_fails_with_redacted_location(self):
        def run(command, **_):
            if command[0] == "make":
                return CompletedProcess(command, 0)
            self.assertEqual(command[0], "conformance/c3.sh")
            with self.assertRaises(Mismatch):
                with numeric_evidence(command[1]):
                    compare_numeric("hash vectors", b"oracle bytes\n", b"different guest bytes\n")
            return CompletedProcess(command, 1)

        status, report = self.execute(run)
        self.assertEqual(status, 1)
        self.assertEqual(report["gates"]["C3"]["firstDifference"], {"field": "hash vectors", "line": 1})
        self.assertEqual(report["equalityDifferences"], 1)
        self.assertNotIn("oracle bytes", self.path.read_text())
        self.assertEqual(report["gates"]["C4"]["state"], "not-run")

    def c1_cases(self, fail=False, omit_last=False):
        def run(command, **_):
            if command[0] == "make":
                pass
            elif Path(command[0]).suffix == ".sh":
                corpus = Path(command[0]).stem.upper()
                write_json(Path(command[1]), {"schema": 1, "counts": CORPORA[corpus]})
            else:
                cases = list(CASES.items())
                for index, (case_id, mode) in enumerate(cases[:-1] if omit_last else cases):
                    if mode == "plan":
                        native = RunResult(4, b"PLAN ONLY: no proof was checked\n", b"")
                    else:
                        native = RunResult(3, f"---- the call ----\nPART PASSED: {mode}\n".encode(), b"")
                    guest = RunResult(5, b"NOT CHECKED: a private path\n", b"") if fail and index == 0 else native
                    result = compare(native, guest, Case(case_id, "C1", mode))
                    write_json(Path(command[-1]) / f"{index}.json", result)
            return CompletedProcess(command, 0)

        return self.execute(run)

    def test_counts_part_calls_and_plans_separately(self):
        status, report = self.c1_cases()
        self.assertEqual(status, 0)
        self.assertEqual(report["status"], "passed")
        self.assertEqual(report["counts"]["C1"], {"wholeCalls": 0, "partCalls": 8, "plans": 16})
        self.assertEqual(len(report["cases"]), 24)

    def test_c1_case_difference_fails_even_with_zero_runner_status(self):
        status, report = self.c1_cases(fail=True)
        self.assertEqual(status, 1)
        self.assertEqual(report["gates"]["C1"]["firstDifference"], {"caseId": "accepted-proof/key", "kind": "exit"})
        self.assertEqual(report["equalityDifferences"], 1)
        self.assertNotIn("a private path", self.path.read_text())

    def test_incomplete_c1_matrix_fails(self):
        status, report = self.c1_cases(omit_last=True)
        self.assertEqual(status, 1)
        self.assertEqual(report["gates"]["C1"]["reason"], "missing-cases")
        self.assertEqual(report["counts"]["C1"]["plans"], 15)
