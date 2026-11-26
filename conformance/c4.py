"""Run the verifier's table constructors and compare their exact digest inputs."""

from hashlib import sha256
from itertools import zip_longest
import json
from math import prod
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
from tempfile import TemporaryDirectory

from conformance.evidence import Mismatch, numeric_evidence


ROOT = Path(__file__).resolve().parents[1]
UPSTREAM = ROOT / ".upstream/FlashProve"
OUT = ROOT / "build/c4"
WASMTIME = ROOT / ".toolchain/wasmtime/wasmtime"
TABLES = {"silu": "tsilu", "sigmoid": "tsig", "rope": "trope", "exp": "texp"}
FIXTURES = ("accepted-proof", "accepted-proof-clipped-gap", "full-size", "full-size-clipped-gap")
WORD = struct.Struct("<I")


def decode(data, policy_digest, parameters):
    position = 0
    for table in TABLES:
        if len(data) - position < 36:
            raise Mismatch(f"{table}: truncated table header", table=table, field="header")
        count, = WORD.unpack_from(data, position)
        digest = data[position + 4:position + 36]
        start = position + 36
        position = start + count * 4
        if not count or position > len(data):
            raise Mismatch(f"{table}: truncated or empty table", table=table, field="length")
        dimensions = {
            "silu": [65536], "sigmoid": [65536],
            "rope": [2, 1 << parameters[b"lt"], parameters[b"dh"] // 2], "exp": [count],
        }[table]
        if prod(dimensions) != count:
            raise Mismatch(f"{table}: decoded length {count}, expected {prod(dimensions)}", table=table, field="length")
        values = data[start:position]
        yield {
            "schema": 1, "policySha256": policy_digest, "table": table, "dimensions": dimensions,
            "elementBytes": 4, "digest": digest.hex(),
            "elements": [values[i:i + 4].hex() for i in range(0, len(values), 4)],
        }
    if position != len(data):
        raise Mismatch("unexpected data after the fourth table", field="trailing bytes")


def compare(expected, observed):
    table = expected["table"]
    for key in ("schema", "policySha256", "table", "dimensions", "elementBytes"):
        if expected[key] != observed[key]:
            raise Mismatch(f"{table} {key}: expected {expected[key]}, got {observed[key]}", table=table, field=key)
    for index, (native, guest) in enumerate(zip_longest(expected["elements"], observed["elements"])):
        if native != guest:
            raise Mismatch(f"{table}[{index}]: native={native}, wasm={guest} (little-endian)", table=table, index=index)
    if expected["digest"] != observed["digest"]:
        raise Mismatch(f"{table} digest: native={expected['digest']}, wasm={observed['digest']}", table=table, field="digest")


def tables(work, family, config):
    policy = (config / "policy.txt").read_bytes()
    parameters = {key: int(value) for key, value in re.findall(rb"^([a-zA-Z_0-9]+) ([0-9]+)$", policy, re.MULTILINE)}
    policy_digest = sha256(policy).hexdigest()
    runs = []
    for label, command in (
        ("native", [work / "tables", config]),
        ("wasm", [WASMTIME, "run", "--dir", f"{config}::/config", work / "tables.wasm", "/config"]),
    ):
        proc = subprocess.run(command, capture_output=True, check=False)
        (OUT / f"{family}.{label}.stdout").write_bytes(proc.stdout)
        if proc.returncode:
            (OUT / f"{family}.{label}.stderr").write_bytes(proc.stderr)
            verdict = proc.stdout.splitlines()[-1:]
            raise ValueError(f"{family}/{label}: probe exited {proc.returncode} with {verdict}. See {OUT}")
        result = list(decode(proc.stderr, policy_digest, parameters))
        (OUT / f"{family}.{label}.json").write_text(json.dumps({"schema": 1, "tables": result}) + "\n")
        runs.append(result)
    native, guest = runs
    for oracle, actual in zip(native, guest):
        table = oracle["table"]
        compare(oracle, actual)
        prefix = TABLES[table]
        pinned = struct.pack("<8I", *(parameters[f"{prefix}{i}".encode()] for i in range(8))).hex()
        if oracle["digest"] != pinned:
            raise Mismatch(f"{family}/{table}: expected pinned digest {pinned}, got {oracle['digest']}",
                           table=table, field="policy digest")
    print(f"C4: {family}, " + ", ".join(f"{t['table']}={len(t['elements'])}" for t in native), flush=True)
    return native


def sweep(work):
    oracle = subprocess.check_output([work / "tables", "--rope-sweep"])
    guest = subprocess.check_output([WASMTIME, "run", work / "tables.wasm", "--rope-sweep"])
    expected_count = 2 * 2 * 1024 * sum(1 << i for i in range(7))
    if len(oracle) != expected_count * 4 or len(guest) != len(oracle):
        raise Mismatch("served RoPE sweep length mismatch", table="rope", field="sweep length")
    if oracle != guest:
        for index, (native, wasm) in enumerate(zip(WORD.iter_unpack(oracle), WORD.iter_unpack(guest))):
            if native != wasm:
                theta_selector, within_theta = divmod(index, expected_count // 2)
                for width in (2, 4, 8, 16, 32, 64, 128):
                    group = 2 * 1024 * (width // 2)
                    if within_theta < group:
                        sine, within_kind = divmod(within_theta, group // 2)
                        position, pair = divmod(within_kind, width // 2)
                        theta = (10000, 500000)[theta_selector]
                        raise Mismatch(f"RoPE sweep theta={theta} dh={width} sine={sine} t={position} i={pair}: "
                                       f"native={native[0]}, wasm={wasm[0]}", table="rope", field="sweep", index=index)
                    within_theta -= group
    print(f"C4: {expected_count} served RoPE entries matched exactly")
    return expected_count


def check_digest_refusal(work):
    with TemporaryDirectory(dir=OUT) as directory:
        config = Path(directory) / "config"
        shutil.copytree(UPSTREAM / "examples/accepted-proof/config", config)
        policy = config / "policy.txt"
        changed, count = re.subn(rb"^tsilu0 [0-9]+$", b"tsilu0 0", policy.read_bytes(), flags=re.MULTILINE)
        if count != 1:
            raise ValueError("digest refusal test could not replace one SiLU digest word")
        policy.write_bytes(changed)
        for command in ([work / "tables", config],
                        [WASMTIME, "run", "-W", "unknown-imports-trap=y", "--dir", f"{config}::/config", ROOT / "build/wasm/cp_verify.wasm",
                         "-plan", "accounting", "/config", "128"]):
            proc = subprocess.run(command, capture_output=True, check=False)
            if proc.returncode != 1 or proc.stdout.splitlines()[-1:] != [b"NO: table-digest-silu"]:
                raise ValueError(f"changed SiLU digest: unexpected exit {proc.returncode} and terminal line")
    print("C4: native and wasm rejected a changed SiLU digest")


def main(work, counts):
    counts.update(policies=0, tables=0, tableEntries=0)
    for family in FIXTURES:
        try:
            values = tables(work, family, UPSTREAM / "examples" / family / "config")
        except Mismatch as error:
            error.location["fixture"] = family
            raise
        counts["policies"] += 1
        counts["tables"] += len(values)
        counts["tableEntries"] += sum(len(value["elements"]) for value in values)
    counts["ropeSweepEntries"] = sweep(work)

    example = values[0]
    altered = {**example, "elements": example["elements"].copy()}
    altered["elements"][1] = WORD.pack(int.from_bytes(bytes.fromhex(altered["elements"][1]), "little") ^ 1).hex()
    try:
        compare(example, altered)
    except ValueError as error:
        if not str(error).startswith("silu[1]: native="):
            raise
        print(f"C4: changed entry rejected at {error}")
    else:
        raise ValueError("changed table entry passed")
    check_digest_refusal(work)


if __name__ == "__main__":
    try:
        work, *reports = sys.argv[1:]
        with numeric_evidence(reports[0] if reports else None) as counts:
            main(Path(work), counts)
    except (ValueError, KeyError) as error:
        (OUT / "failure.txt").write_text(f"{error}\n")
        raise SystemExit("C4: table check failed. See build/c4/failure.txt.") from error
