#!/usr/bin/env python3
"""Compare two serving builds byte for byte and write the reproducibility record (#45).

Usage: compare_builds.py ROOT_A ROOT_B OUTPUT_JSON
Exits 1 when the modules, their checksums or their source and port digests differ."""
import hashlib
import json
import pathlib
import sys

FILES = ("cp_verify.wasm", "cp_verify.wasm.sha256", "source.sha256", "port.sha256")


def first_difference(left, right):
    for offset, (a, b) in enumerate(zip(left, right)):
        if a != b:
            return offset
    return None if len(left) == len(right) else min(len(left), len(right))


def compare(root_a, root_b):
    """Return (record, problems) for build/wasm under two roots."""
    builds, problems = [], []
    for root in (pathlib.Path(root_a), pathlib.Path(root_b)):
        wasm = root / "build" / "wasm"
        missing = [name for name in FILES if not (wasm / name).is_file()]
        if missing:
            problems.append(f"{root}: missing {', '.join(missing)}")
            builds.append(None)
            continue
        module = (wasm / "cp_verify.wasm").read_bytes()
        digest = hashlib.sha256(module).hexdigest()
        recorded = (wasm / "cp_verify.wasm.sha256").read_text().strip()
        if recorded != digest:
            problems.append(f"{root}: cp_verify.wasm.sha256 says {recorded}, bytes hash to {digest}")
        builds.append({"root": str(root), "bytes": len(module), "moduleSha256": digest,
                       "source": (wasm / "source.sha256").read_text().strip(),
                       "port": (wasm / "port.sha256").read_text().strip(), "module": module})
    record = {"schema": 1, "identical": False, "builds": []}
    if None in builds:
        return record, problems
    a, b = builds
    offset = first_difference(a["module"], b["module"])
    if offset is not None:
        problems.append(f"modules differ: {a['bytes']} and {b['bytes']} bytes, first difference at byte {offset}")
    for key in ("source", "port"):
        if a[key] != b[key]:
            problems.append(f"{key} digests differ: {a[key]} and {b[key]}")
    record["builds"] = [{k: v for k, v in build.items() if k != "module"} for build in builds]
    record["identical"] = not problems
    if not problems:
        record.update(moduleSha256=a["moduleSha256"], source=a["source"], port=a["port"])
    return record, problems


def main(argv):
    if len(argv) != 4:
        print(__doc__, file=sys.stderr)
        return 2
    record, problems = compare(argv[1], argv[2])
    pathlib.Path(argv[3]).write_text(json.dumps(record, indent=2, sort_keys=True) + "\n")
    for problem in problems:
        print(f"repro: {problem}", file=sys.stderr)
    if not problems:
        print(f"repro: identical {record['builds'][0]['bytes']}-byte modules, sha256 {record['moduleSha256']}, "
              f"source {record['source'][:12]}, port {record['port'][:12]}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
