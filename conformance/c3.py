"""Run upstream known answers and compare full-width C3 records."""

from itertools import zip_longest
from pathlib import Path
import re
import subprocess
import sys

from conformance.evidence import Mismatch, numeric_evidence


ROOT = Path(__file__).resolve().parents[1]
UPSTREAM = ROOT / ".upstream/FlashProve"
OUT = ROOT / "build/c3"
WASMTIME = ROOT / ".toolchain/wasmtime/wasmtime"
FIELD_MODULUS = (1 << 64) - (1 << 32) + 1


def run(label, *command, cwd=UPSTREAM, inputs=b""):
    proc = subprocess.run(command, cwd=cwd, input=inputs, capture_output=True, check=False)
    (OUT / f"{label}.stdout").write_bytes(proc.stdout)
    (OUT / f"{label}.stderr").write_bytes(proc.stderr)
    if proc.returncode:
        raise SystemExit(f"C3: {label} exited {proc.returncode}. See {OUT}")
    return proc.stdout


def compare(label, expected, actual):
    for index, (want, got) in enumerate(zip_longest(expected.splitlines(keepends=True),
                                                    actual.splitlines(keepends=True)), 1):
        if want != got:
            raise Mismatch(f"{label} line {index}: expected {want!r}, got {got!r}",
                           field=label, line=index)


def check_fields(data):
    lines = data.splitlines()
    if len(lines) != 113:
        raise Mismatch(f"expected 113 full-width field records, got {len(lines)}", field="field record count")
    for index, line in enumerate(lines, 1):
        kind, *words = line.split()
        if any(re.fullmatch(rb"[0-9a-f]{16}", word) is None for word in words):
            raise Mismatch(f"field record {index} contains an invalid word", field="field records", line=index)
        a, b, *values = map(lambda word: int(word, 16), words)
        if kind == b"reduction" and len(values) == 2:
            expected = [((a << 64) | b) % FIELD_MODULUS] * 2
        elif kind == b"field" and len(values) == 3:
            expected = [value % FIELD_MODULUS for value in (a + b, a - b, a * b)]
        else:
            raise Mismatch(f"invalid field record kind or length at line {index}", field="field records", line=index)
        if values != expected:
            raise Mismatch(f"field record {index}: {line!r}, expected {expected}", field="field records", line=index)


def main(work, counts):
    for name in ("field_test", "field_setting_test", "functions_test", "calls_test"):
        native = run(f"{name}.native", work / name)
        guest = run(f"{name}.wasm", WASMTIME, "run", work / f"{name}.wasm")
        compare(name, native, guest)
        print(f"C3: {native.decode('ascii').strip()}")
        counts["sharedPrograms"] = counts.get("sharedPrograms", 0) + 1
    for name in ("older_test", "mode_test"):
        native = run(f"{name}.native", work / name, cwd=UPSTREAM / "blocks")
        print(f"C3: {native.decode('ascii').strip()}")

    python_vectors = run("format_hash", sys.executable, "-B", UPSTREAM / "verifier/tests/known_answers/format_hash.py")
    print(f"C3: {python_vectors.decode('ascii').splitlines()[-2]}")
    counts["nativeOnlyPrograms"] = 3

    expected = (UPSTREAM / "verifier/tests/hash_vectors.txt").read_bytes()
    frames = expected.splitlines()
    if len(frames) != 57:
        raise Mismatch(f"expected 57 upstream hash vectors, got {len(frames)}", field="hash vector count")
    inputs = b"\n".join(line.rsplit(b" ", 1)[0] for line in frames) + b"\n"
    native = run("values.native", work / "c3-values", inputs=inputs)
    guest = run("values.wasm", WASMTIME, "run", work / "c3-values.wasm", inputs=inputs)
    compare("native and wasm values", native, guest)
    records = guest.splitlines(keepends=True)
    fields = b"".join(records[:-len(frames)])
    hashes = b"".join(records[-len(frames):])
    check_fields(fields)
    counts["fieldRecords"] = len(fields.splitlines())
    compare("hash vectors", expected, hashes)
    counts["hashVectors"] = len(frames)
    print(f"C3: {len(fields.splitlines())} field records and {len(frames)} hash vectors matched exactly")

    changed = bytearray(expected)
    digit = changed.index(b"\n") - 1
    changed[digit] = ord("0") if changed[digit] != ord("0") else ord("1")
    try:
        compare("changed hash answer", changed, hashes)
    except ValueError as error:
        if not str(error).startswith("changed hash answer line 1:"):
            raise
        print("C3: changed known answer rejected at line 1")
    else:
        raise ValueError("changed hash answer passed")


if __name__ == "__main__":
    try:
        work, *reports = sys.argv[1:]
        with numeric_evidence(reports[0] if reports else None) as counts:
            main(Path(work), counts)
    except ValueError as error:
        (OUT / "failure.txt").write_text(f"{error}\n")
        raise SystemExit("C3: numeric check failed. See build/c3/failure.txt.") from error
