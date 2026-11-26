"""Exercise C5 evidence without a native build, fixtures or a real mismatch."""

from contextlib import redirect_stdout
from copy import deepcopy
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from conformance.compare import Case, RunResult, compare
from conformance.fuzz import assigned_seeds, merge_reports, replay, report_for, summarize
from conformance.fuzz_cases import FIXTURE_IDS, Operation, SeedCase, SplitMix64, generate, mutate, read_operation
from conformance.fuzz_regressions import minimize, preserve, read_regression


IDENTITY = {"upstreamCommit": "a" * 40, "toolchainSha256": "b" * 64, "moduleSha256": "c" * 64,
            "runtime": {"name": "node", "version": "v24.22.3"},
            "fixtureSha256": {fixture: "d" * 64 for fixture in FIXTURE_IDS}}


def fixture_size(_fixture, _target):
    return 257


def report(seeds, shard):
    data = report_for(seeds, shard)
    data.update(IDENTITY, status="passed")
    for gate in data["gates"].values():
        gate["state"] = "passed"
    for seed in assigned_seeds(seeds, shard):
        sample = generate(seed, fixture_size)
        verdict = RunResult(1, b"NO: proof-refused\n", b"")
        result = compare(verdict, verdict, Case(f"seed-{seed}", "C5", "whole"))
        result.update(seed=seed, fixtureId=sample.fixture, inputClass=sample.input_class, mutationKind=sample.operations[0].kind)
        data["cases"].append(result)
    summarize(data)
    return data


class FuzzTest(unittest.TestCase):
    def test_splitmix_words_and_seed_operations(self):
        generator = SplitMix64(0)
        self.assertEqual([generator.next() for _ in range(4)], [
            0xE220A8397B1DCDAF, 0x6E789E6AA1B965F4, 0x06C45D188009454F, 0xF88BB8A8724C81EC,
        ])
        self.assertEqual(generate(0, fixture_size), SeedCase(0, "key", "accepted-proof", (
            Operation("ivk/key.bin", "truncate", 125),)))
        self.assertEqual(generate(1, fixture_size), SeedCase(1, "configuration", "accepted-proof-clipped-gap", (
            Operation("config/policy.txt", "append", 257, 185),)))
        self.assertEqual(generate(2, fixture_size), SeedCase(2, "token", "accepted-proof", (
            Operation("example.y", "flip", 235, 8),)))

    def test_operation_bounds_and_replay_paths(self):
        self.assertEqual(mutate(b"abc", Operation("example.proof", "flip", 1, 2)), b"a`c")
        self.assertEqual(mutate(b"abc", Operation("example.proof", "truncate", 1)), b"a")
        self.assertEqual(mutate(b"abc", Operation("example.proof", "append", 3, 33)), b"abc!")
        with self.assertRaises(ValueError):
            mutate(b"abc", Operation("example.proof", "append", 2, 33))
        with self.assertRaises(ValueError):
            read_operation({"target": "../example.proof", "kind": "flip", "offset": 0, "value": 1})

    def test_seed_records_are_independent_of_partition_and_merge_order(self):
        single = report(43, (0, 1))
        shards = [report(43, (index, 4)) for index in reversed(range(4))]
        merged = merge_reports(43, shards)
        self.assertEqual(merged["cases"], single["cases"])
        self.assertEqual(merged["counts"], single["counts"])
        self.assertEqual(merged["executedSeeds"], 43)

    def test_merge_rejects_missing_duplicate_different_pin_and_unredacted_records(self):
        first, second = report(10, (0, 2)), report(10, (1, 2))
        with self.assertRaisesRegex(ValueError, "shard count"):
            merge_reports(10, [first])
        with self.assertRaisesRegex(ValueError, "duplicate shard"):
            merge_reports(10, [first, first])
        for change, error in (
            (lambda data: data["cases"].pop(), "omitted seed"),
            (lambda data: data["cases"].append(data["cases"][0]), "duplicate"),
            (lambda data: data.update(moduleSha256="f" * 64), "inconsistent"),
            (lambda data: data["cases"][0].update(rawOutput="private-proof-text"), "invalid seed record"),
            (lambda data: data["cases"][0].update(inputClass="proof"), "seed metadata"),
        ):
            damaged = deepcopy(second)
            change(damaged)
            with self.assertRaisesRegex(ValueError, error):
                merge_reports(10, [first, damaged])

    def test_confirm_minimize_preserve_and_replay_a_mismatch(self):
        optional = Operation("ivk/key.bin", "flip", 0, 1)
        necessary = Operation("example.proof", "append", 2, 91)
        sample = SeedCase(7, "proof", FIXTURE_IDS[0], (optional, necessary))
        case = Case("seed-7", "C5", "whole")
        rejected = RunResult(1, b"NO: proof-refused\n", b"")

        def evaluator(operations):
            guest = RunResult(0, b"YES\n", b"") if necessary in operations else rejected
            return compare(rejected, guest, case)

        original = evaluator(sample.operations)
        reduced = minimize(sample.operations, original, evaluator)
        self.assertEqual(reduced, (necessary,))
        self.assertIsNone(minimize(sample.operations, original, lambda _: evaluator(())))
        args = ["registered-fixture"]
        with TemporaryDirectory() as directory:
            root = Path(directory)
            private = root / "build/fuzz/private"
            preserve(private, sample, args, original, reduced, IDENTITY)
            path = private / "seed-7.json"
            descriptor, parsed = read_regression(path, IDENTITY, lambda _: args)
            self.assertEqual(parsed, reduced)
            self.assertEqual(descriptor["originalOperations"], [optional.record(), necessary.record()])
            (root / "conformance").mkdir()
            (root / "conformance/excluded-fields.txt").touch()

            def prepare(_root, _make, data):
                data.update(IDENTITY)
                return True

            streamed = StringIO()
            with (patch("conformance.fuzz.prepare", side_effect=prepare),
                  patch("conformance.fuzz.fixture_args", return_value=args),
                  patch("conformance.fuzz.evaluate", side_effect=lambda *values: evaluator(values[4])),
                  redirect_stdout(streamed)):
                self.assertEqual(replay(root, "make", path), 1)
            self.assertIn("reproduced", streamed.getvalue())
