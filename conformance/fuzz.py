"""Run and reconcile the deterministic C5 differential corpus."""

import argparse
from collections import Counter
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from hashlib import sha256
from pathlib import Path
import re
import subprocess
import sys
from tempfile import TemporaryDirectory

from conformance.compare import HOST_FAILURES, PARTS, POLICY, Case, compare, load_exclusions
from conformance.fuzz_cases import FIXTURE_IDS, GENERATOR_VERSION, TARGETS, generate, mutate
from conformance.fuzz_regressions import atomic_json, minimize, preserve, read_regression, signature
from conformance.m1 import read_json
from conformance.native_c1 import FIXTURES, cases
from conformance.node_differential import copy_fixture, prerequisites, run_pair


IDENTITY = ("upstreamCommit", "toolchainSha256", "moduleSha256", "runtime", "fixtureSha256")
VERDICTS = {None, "YES", "NO", "NOT CHECKED", "NOT-A-VERIFICATION", "PLAN ONLY: no proof was checked",
            *(part.decode("ascii") for part in PARTS)}
CASE_FIELDS = {"schema", "caseId", "corpus", "mode", "nativeExit", "guestExit", "nativeVerdict", "guestVerdict",
               "equal", "safetyViolation", "seed", "fixtureId", "inputClass", "mutationKind"}


class ShardError(ValueError):
    """A bounded diagnostic for missing or inconsistent shard evidence."""


def fixture_args(root, fixture):
    return next(cases(f"examples/{fixture}", FIXTURES[fixture], root / ".upstream/FlashProve"))[1]


def fixture_path(root, fixture):
    return root / ".upstream/FlashProve/examples" / fixture


def evaluate(root, work, fixture, args, operations, seed, exclusions):
    with TemporaryDirectory(prefix="case-", dir=work) as directory:
        cwd = Path(directory)
        inputs = copy_fixture(root, cwd, fixture)
        for operation in operations:
            target = inputs / operation.target
            target.write_bytes(mutate(target.read_bytes(), operation))
        native, guest = run_pair(root, args, cwd)
    return compare(native, guest, Case(f"seed-{seed}", "C5", "whole"), exclusions)


def report_for(seeds, shard):
    return {"schema": 1, "generatorVersion": GENERATOR_VERSION, "requestedSeeds": seeds,
            "shard": {"index": shard[0], "count": shard[1]}, "runtime": {"name": "node"},
            "status": "failed", "cases": [], "counts": {},
            "gates": {name: {"state": "not-run"} for name in ("prerequisites", "C3", "C4", "C5")}}


def prepare(root, make, report):
    if not prerequisites(root, make, report):
        return False
    report["fixtureSha256"] = {
        fixture: sha256((fixture_path(root, fixture) / "SHA256SUMS").read_bytes()).hexdigest()
        for fixture in FIXTURE_IDS
    }
    return True


def summarize(report):
    rows = report["cases"]
    rows.sort(key=lambda row: row["seed"])
    report["executedSeeds"] = len(rows)
    report["safetyViolations"] = sum(row["safetyViolation"] for row in rows)
    report["equalityDifferences"] = sum(not row["equal"] for row in rows)
    report["counts"]["C5"] = {
        "classes": dict(Counter(row["inputClass"] for row in rows)),
        "mutations": dict(Counter(row["mutationKind"] for row in rows)),
        "nativeExits": dict(Counter(str(row["nativeExit"]) for row in rows)),
        "guestExits": dict(Counter(str(row["guestExit"]) for row in rows)),
    }


def assigned_seeds(seeds, shard):
    return range(shard[0], seeds, shard[1])


def run_cases(root, work, report, seeds, jobs, exclusions):
    gate = report["gates"]["C5"]
    gate["state"] = "failed"
    sizes = {(fixture, target): (fixture_path(root, fixture) / target).stat().st_size
             for fixture in FIXTURE_IDS for target in TARGETS}
    args_by_fixture = {fixture: fixture_args(root, fixture) for fixture in FIXTURE_IDS}

    def run(seed):
        sample = generate(seed, lambda fixture, target: sizes[fixture, target])
        args = args_by_fixture[sample.fixture]
        return sample, evaluate(root, work, sample.fixture, args, sample.operations, seed, exclusions)

    pending_seeds = iter(seeds)
    failures = []
    with ThreadPoolExecutor(max_workers=jobs) as pool:
        active = {pool.submit(run, next(pending_seeds)) for _ in range(min(jobs, len(seeds)))}
        stopped = False
        while active and not stopped:
            done, _ = wait(active, return_when=FIRST_COMPLETED)
            for future in done:
                active.remove(future)
                try:
                    sample, result = future.result()
                except (OSError, ValueError, subprocess.SubprocessError):
                    gate["reason"] = "case-unavailable"
                    stopped = True
                    break
                result.update(seed=sample.seed, fixtureId=sample.fixture, inputClass=sample.input_class,
                              mutationKind=sample.operations[0].kind)
                report["cases"].append(result)
                if not result["equal"]:
                    failures.append((sample, result))
                if result["safetyViolation"]:
                    gate["reason"] = "safety-violation"
                    stopped = True
                    break
                seed = next(pending_seeds, None)
                if seed is not None:
                    active.add(pool.submit(run, seed))
        for future in active:
            future.cancel()

    confirmed = 0
    provenance = {key: report[key] for key in IDENTITY}
    for sample, result in failures:
        args = args_by_fixture[sample.fixture]

        def rerun(operations):
            return evaluate(root, work, sample.fixture, args, operations, sample.seed, exclusions)

        try:
            minimized = minimize(sample.operations, result, rerun)
            if minimized is not None:
                private = root / "build/fuzz/private" / report["moduleSha256"]
                preserve(private, sample, args, result, minimized, provenance)
                confirmed += 1
        except (OSError, ValueError, subprocess.SubprocessError):
            gate["descriptorError"] = True
    gate["confirmedMismatches"] = confirmed
    if failures:
        gate.setdefault("reason", "equality-difference")
    elif not stopped and len(report["cases"]) == len(seeds):
        gate["state"] = "passed"
        report["status"] = "passed"


def announce(report):
    print(f"C5 {report['status']}; {report['executedSeeds']} executed of {report['requestedSeeds']} requested seeds; "
          f"{report['equalityDifferences']} equality differences, {report['safetyViolations']} safety violations", flush=True)
    print(f"C5 coverage {report['counts']['C5']}", flush=True)
    for name, gate in report["gates"].items():
        print(f"C5 gate {name} {gate['state']} {gate.get('reason', '')}".rstrip(), flush=True)


def run_fuzz(root, make, seeds, shard, jobs, destination):
    report = report_for(seeds, shard)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.unlink(missing_ok=True)
    with TemporaryDirectory(prefix=".c5-", dir=destination.parent) as directory:
        try:
            exclusions = load_exclusions(root / "conformance/excluded-fields.txt")
            if prepare(root, make, report):
                run_cases(root, Path(directory), report, assigned_seeds(seeds, shard), jobs, exclusions)
        except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
            phase = "C5" if report["gates"]["C5"]["state"] == "failed" else "prerequisites"
            report["gates"][phase].update(state="failed", reason="missing-or-invalid-evidence")
        finally:
            summarize(report)
            atomic_json(destination, report)
    announce(report)
    return 0 if report["status"] == "passed" else 1


def shard_identity(report):
    identity = {key: report[key] for key in IDENTITY}
    for key, width in (("upstreamCommit", 40), ("toolchainSha256", 64), ("moduleSha256", 64)):
        if re.fullmatch(rf"[0-9a-f]{{{width}}}", identity[key]) is None:
            raise ShardError("invalid shard provenance")
    runtime = identity["runtime"]
    fixtures = identity["fixtureSha256"]
    if (runtime.keys() != {"name", "version"} or runtime["name"] != "node"
        or re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", runtime["version"]) is None
        or fixtures.keys() != set(FIXTURE_IDS)
        or any(re.fullmatch(r"[0-9a-f]{64}", digest) is None for digest in fixtures.values())):
        raise ShardError("invalid shard runtime or fixture provenance")
    return identity


def valid_result(row):
    if not CASE_FIELDS <= row.keys() <= CASE_FIELDS | {"firstDifference", "hostFailure"}:
        return False
    for name in ("nativeExit", "guestExit"):
        if type(row[name]) is not int or not -255 <= row[name] <= 255:
            return False
    for name in ("nativeVerdict", "guestVerdict"):
        value = row[name]
        if value is not None and (not isinstance(value, str) or len(value) > 184
                                  or (value not in VERDICTS and POLICY.fullmatch(value.encode("utf-8")) is None)):
            return False
    if "hostFailure" in row and row["hostFailure"] not in HOST_FAILURES:
        return False
    if row["equal"]:
        return ("firstDifference" not in row and "hostFailure" not in row and not row["safetyViolation"]
                and row["nativeExit"] == row["guestExit"] and row["nativeVerdict"] == row["guestVerdict"])
    difference = row.get("firstDifference")
    if type(difference) is not dict:
        return False
    if difference.keys() == {"kind"}:
        return difference["kind"] in ("exit", "verdict", "host-failure")
    return (difference.keys() == {"kind", "stream", "line", "byte"} and difference["kind"] == "bytes"
            and difference["stream"] in ("stdout", "stderr")
            and all(type(difference[key]) is int and 0 < difference[key] < 1 << 53 for key in ("line", "byte")))


def merge_reports(seeds, reports):
    merged = report_for(seeds, (0, 1))
    if not reports:
        raise ShardError("no shard evidence")
    identity = shard_identity(reports[0])
    shards = reports[0]["shard"]["count"]
    if type(shards) is not int or not 1 <= shards <= seeds or len(reports) != shards:
        raise ShardError("missing or inconsistent shard count")
    indices = set()
    seen = set()
    for report in reports:
        shard = report["shard"]
        index = shard["index"]
        if (type(report["schema"]) is not int or report["schema"] != 1 or report["generatorVersion"] != GENERATOR_VERSION
            or report["requestedSeeds"] != seeds or shard["count"] != shards
            or type(index) is not int or not 0 <= index < shards or index in indices
            or shard_identity(report) != identity
            or any(report["gates"][name]["state"] != "passed" for name in ("prerequisites", "C3", "C4"))):
            raise ShardError("duplicate shard or inconsistent version, coverage or pins")
        indices.add(index)
        assigned = assigned_seeds(seeds, (index, shards))
        rows = report["cases"]
        for row in rows:
            seed = row["seed"]
            if (type(seed) is not int or seed not in assigned or seed in seen
                or type(row["schema"]) is not int or row["schema"] != 1 or row["corpus"] != "C5" or row["mode"] != "whole"
                or row["caseId"] != f"seed-{seed}"
                or type(row["equal"]) is not bool or type(row["safetyViolation"]) is not bool
                or not valid_result(row)):
                raise ShardError("duplicate, unexpected or invalid seed record")
            sample = generate(seed, lambda _fixture, _target: 1)
            if (row["fixtureId"], row["inputClass"], row["mutationKind"]) != (
                sample.fixture, sample.input_class, sample.operations[0].kind,
            ):
                raise ShardError("seed metadata does not match the generator")
            seen.add(seed)
        if len(rows) != len(assigned) or report["executedSeeds"] != len(rows):
            raise ShardError("omitted seed records")
        if (report["equalityDifferences"] != sum(not row["equal"] for row in rows)
            or report["safetyViolations"] != sum(row["safetyViolation"] for row in rows)):
            raise ShardError("shard discrepancy counts differ from its cases")
        merged["cases"].extend(rows)
    merged.update(identity)
    summarize(merged)
    for name in ("prerequisites", "C3", "C4"):
        merged["gates"][name]["state"] = "passed"
    if merged["equalityDifferences"] or merged["safetyViolations"]:
        reason = "safety-violation" if merged["safetyViolations"] else "equality-difference"
        merged["gates"]["C5"].update(state="failed", reason=reason)
    elif any(report["status"] != "passed" or report["gates"]["C5"]["state"] != "passed" for report in reports):
        raise ShardError("shard did not pass its seed gate")
    else:
        merged["gates"]["C5"]["state"] = "passed"
        merged["status"] = "passed"
    return merged


def replay(root, make, path):
    report = report_for(1, (0, 1))
    if not prepare(root, make, report):
        return 1
    descriptor, operations = read_regression(path, report, lambda fixture: fixture_args(root, fixture))
    with TemporaryDirectory(prefix=".c5-replay-", dir=root / "build") as directory:
        result = evaluate(root, Path(directory), descriptor["fixtureId"], descriptor["args"], operations,
                          descriptor["seed"], load_exclusions(root / "conformance/excluded-fields.txt"))
    if result["equal"]:
        print("C5 regression now matches native", flush=True)
        return 0
    state = "reproduced" if signature(result) == descriptor["signature"] else "changed"
    print(f"C5 regression {state} its mismatch", flush=True)
    return 1


def positive(value):
    if re.fullmatch(r"[1-9][0-9]{0,15}", value) is None or int(value) >= 1 << 53:
        raise argparse.ArgumentTypeError("expected a positive JSON-safe integer")
    return int(value)


def shard_index(value):
    if re.fullmatch(r"(?:0|[1-9][0-9]{0,15})/[1-9][0-9]{0,15}", value) is None:
        raise argparse.ArgumentTypeError("expected a shard index/count")
    return tuple(map(int, value.split("/")))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    run = commands.add_parser("run")
    run.add_argument("--make", default="make")
    run.add_argument("--seeds", type=positive, required=True)
    run.add_argument("--jobs", type=positive, default=1)
    run.add_argument("--shard", type=shard_index, default=(0, 1))
    merge = commands.add_parser("merge")
    merge.add_argument("--seeds", type=positive, required=True)
    merge.add_argument("--output", type=Path, required=True)
    merge.add_argument("reports", type=Path, nargs="+")
    repeat = commands.add_parser("replay")
    repeat.add_argument("--make", default="make")
    repeat.add_argument("descriptor", type=Path)
    args = parser.parse_args(argv)
    root = Path.cwd()
    try:
        if args.command == "run":
            index, count = args.shard
            if not 0 <= index < count <= args.seeds or args.jobs > len(assigned_seeds(args.seeds, args.shard)):
                parser.error("shard or worker count is outside the requested seeds")
            destination = root / "build/fuzz" / f"seeds-{args.seeds}-{index}-of-{count}.json"
            return run_fuzz(root, args.make, args.seeds, args.shard, args.jobs, destination)
        if args.command == "merge":
            if any(path.resolve() == args.output.resolve() for path in args.reports):
                parser.error("merge output must differ from each shard report")
            inputs = [read_json(path) for path in args.reports]
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.unlink(missing_ok=True)
            report = merge_reports(args.seeds, inputs)
            atomic_json(args.output, report)
            announce(report)
            return 0 if report["status"] == "passed" else 1
        return replay(root, args.make, args.descriptor)
    except ShardError as error:
        print(f"C5 merge failed: {error}", file=sys.stderr)
        return 1
    except (OSError, ValueError, TypeError, KeyError, AttributeError, subprocess.SubprocessError):
        print("C5 could not validate the requested evidence", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
