"""Confirm, reduce and reload local C5 mismatch descriptors."""

from pathlib import Path
from tempfile import TemporaryDirectory

from conformance.evidence import write_json
from conformance.fuzz_cases import FIXTURE_IDS, GENERATOR_VERSION, read_operation
from conformance.m1 import read_json


def signature(result):
    return {key: result.get(key) for key in (
        "nativeExit", "guestExit", "nativeVerdict", "guestVerdict", "safetyViolation", "firstDifference", "hostFailure",
    )}


def minimize(operations, result, evaluate):
    wanted = signature(result)
    if result["equal"] or signature(evaluate(operations)) != wanted:
        return None
    reduced = operations
    index = 0
    while index < len(reduced):
        candidate = reduced[:index] + reduced[index + 1:]
        try:
            matches = signature(evaluate(candidate)) == wanted
        except ValueError:
            matches = False
        if matches:
            reduced = candidate
            index = 0
        else:
            index += 1
    return reduced


def atomic_json(path, value):
    with TemporaryDirectory(prefix=".report-", dir=path.parent) as directory:
        pending = Path(directory) / "data.json"
        write_json(pending, value)
        pending.chmod(0o600)
        pending.replace(path)


def preserve(directory, sample, args, original, minimized, provenance):
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    descriptor = {
        "schema": 1, "caseId": original["caseId"], "fixtureId": sample.fixture,
        "upstreamCommit": provenance["upstreamCommit"], "args": args, "generatorVersion": GENERATOR_VERSION,
        "seed": sample.seed, "rule": "R-EQ-1" if original["safetyViolation"] else "R-EQ-2", "stage": "whole",
        "firstDifference": original["firstDifference"], "provenance": provenance,
        "originalOperations": [operation.record() for operation in sample.operations],
        "operations": [operation.record() for operation in minimized], "signature": signature(original),
    }
    atomic_json(directory / f"{original['caseId']}.json", descriptor)


def read_regression(path, identity, fixture_args):
    record = read_json(path)
    fixture = record["fixtureId"]
    seed = record["seed"]
    provenance = record["provenance"]
    if (type(record["schema"]) is not int or record["schema"] != 1 or record["generatorVersion"] != GENERATOR_VERSION
        or fixture not in FIXTURE_IDS or type(seed) is not int or not 0 <= seed < 1 << 53
        or record["caseId"] != f"seed-{seed}" or record["stage"] != "whole"
        or record["upstreamCommit"] != identity["upstreamCommit"]
        or provenance["upstreamCommit"] != identity["upstreamCommit"]
        or provenance["toolchainSha256"] != identity["toolchainSha256"]
        or provenance["fixtureSha256"][fixture] != identity["fixtureSha256"][fixture]
        or record["rule"] not in ("R-EQ-1", "R-EQ-2")
        or record["firstDifference"] != record["signature"]["firstDifference"]
        or record["args"] != fixture_args(fixture)):
        raise ValueError("regression schema, pins or fixture identity disagree")
    operations = record["operations"]
    if type(operations) is not list:
        raise ValueError("invalid regression operations")
    return record, tuple(read_operation(operation) for operation in operations)
