"""Lock the comparison boundary with synthetic terminal records."""

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from conformance.compare import Case, RunResult, compare, load_exclusions


WHOLE = Case("example/whole", "C1", "whole")
KEY = Case("example/key", "C1", "key")
PLAN = Case("example/plan", "C1", "plan")
WHOLE_CLOSE = b"commitment: bound\nproof of work: 32 bits\nresult-v1 status=0 bits=128\n"
POLICY = b"WITHIN LIMITS: clipped-gap C=64 theta=32 cap=1 s=15 sh=8\n"
PLAN_END = b"PLAN ONLY: no proof was checked\n"


class CompareTest(unittest.TestCase):
    def test_altered_policy_suffix_is_unsafe(self):
        native = RunResult(0, WHOLE_CLOSE + POLICY, b"")
        guest = RunResult(0, WHOLE_CLOSE + POLICY.replace(b"cap=1", b"cap=2"), b"")
        result = compare(native, guest, WHOLE)
        self.assertTrue(result["safetyViolation"])
        self.assertFalse(result["equal"])
        self.assertEqual(result["firstDifference"], {"kind": "verdict"})

    def test_exit_zero_with_a_refusal_is_unsafe(self):
        native = RunResult(1, b"NO: policy\n", b"")
        guest = RunResult(0, native.stdout, b"")
        result = compare(native, guest, WHOLE)
        self.assertTrue(result["safetyViolation"])
        self.assertEqual(result["firstDifference"], {"kind": "exit"})

    def test_changed_accounting_is_an_equality_difference(self):
        native = RunResult(0, WHOLE_CLOSE + b"YES\n", b"")
        guest = RunResult(0, native.stdout.replace(b"bits=128", b"bits=129"), b"")
        result = compare(native, guest, WHOLE)
        self.assertFalse(result["safetyViolation"])
        self.assertFalse(result["equal"])
        self.assertEqual(result["firstDifference"], {"kind": "bytes", "stream": "stdout", "line": 3, "byte": 27})

    def test_part_compares_the_complete_closing_record(self):
        native = RunResult(3, b"stage header\n---- the call ----\naccounting: 128\nPART PASSED: key\n", b"")
        guest = RunResult(3, native.stdout.replace(b"128", b"129"), b"")
        result = compare(native, guest, KEY)
        self.assertFalse(result["safetyViolation"])
        self.assertEqual(result["firstDifference"]["line"], 2)

    def test_only_anchored_wall_time_is_excluded(self):
        native = RunResult(4, b"---- stage key ---- 1 thread(s), 1.123 s\n" + PLAN_END, b"")
        timed = RunResult(4, native.stdout.replace(b"1.123", b"9.987"), b"")
        approved = frozenset({"stage-wall-time"})
        self.assertFalse(compare(native, timed, PLAN)["equal"])
        self.assertTrue(compare(native, timed, PLAN, approved)["equal"])
        threads = RunResult(4, timed.stdout.replace(b"1 thread", b"2 thread"), b"")
        self.assertFalse(compare(native, threads, PLAN, approved)["equal"])
        prefixed = RunResult(4, b"faux " + native.stdout, b"")
        prefixed_guest = RunResult(4, b"faux " + timed.stdout, b"")
        self.assertFalse(compare(prefixed, prefixed_guest, PLAN, approved)["equal"])
        stderr_native = RunResult(4, PLAN_END, native.stdout)
        stderr_guest = RunResult(4, PLAN_END, timed.stdout)
        self.assertFalse(compare(stderr_native, stderr_guest, PLAN, approved)["equal"])

    def test_acceptance_field_cannot_be_excluded(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "exclusions.txt"
            path.write_text("result-v1.bits\tThis is an acceptance field.\n")
            with self.assertRaisesRegex(ValueError, "invalid output exclusion"):
                load_exclusions(path)
        self.assertEqual(load_exclusions(), frozenset({"stage-wall-time"}))

    def test_plan_compares_all_bytes_on_both_streams(self):
        native = RunResult(4, b"A\rB\n\n" + PLAN_END, b"first\nlast\n")
        for guest, stream in ((RunResult(4, b"A\nB\n\n" + PLAN_END, native.stderr), "stdout"),
                              (RunResult(4, native.stdout, b"other\nlast\n"), "stderr")):
            with self.subTest(stream=stream):
                result = compare(native, guest, PLAN)
                self.assertEqual(result["firstDifference"]["stream"], stream)
                self.assertEqual(result["firstDifference"]["line"], 1)

    def test_host_failure_stays_visible_and_refusal_details_are_redacted(self):
        message = b"NOT CHECKED: input value from a private path\n"
        native = RunResult(5, message, b"")
        guest = RunResult(5, message, b"", "trap")
        result = compare(native, guest, WHOLE)
        self.assertIs(result["equal"], False)
        self.assertEqual(result["hostFailure"], "trap")
        self.assertEqual(result["firstDifference"], {"kind": "host-failure"})
        self.assertEqual(result["nativeVerdict"], "NOT CHECKED")

    def test_missing_final_lf_is_a_byte_difference(self):
        native = RunResult(0, WHOLE_CLOSE + b"YES\n", b"")
        guest = RunResult(0, WHOLE_CLOSE + b"YES", b"")
        result = compare(native, guest, WHOLE)
        self.assertFalse(result["safetyViolation"])
        self.assertEqual(result["firstDifference"], {"kind": "bytes", "stream": "stdout", "line": 4, "byte": 4})

    def test_incomplete_native_reference_is_invalid(self):
        result = RunResult(0, b"YES\n", b"")
        with self.assertRaisesRegex(ValueError, "invalid native whole-call closing record"):
            compare(result, result, WHOLE)


if __name__ == "__main__":
    unittest.main()
