"""Hash sorted repository paths and their SHA-256 values for port provenance."""

from hashlib import sha256
from pathlib import Path

root = Path(__file__).resolve().parents[1]
paths = [root / name for name in (
    "Makefile", "toolchain.lock", "upstream.lock", "scripts/build-wasm.sh",
    "scripts/wasm-toolchain.sh", "scripts/port-digest.py", "scripts/lib.sh",
    "scripts/audit_wasm.py",
    "scripts/bootstrap-wasmtime-python.sh", "host/wasmtime/requirements.txt", "host/wasmtime/wasi.py",
)]
for directory in ("port", "patches"):
    paths.extend(path for path in (root / directory).rglob("*") if path.is_file())

digest = sha256()
for path in sorted(paths):
    name = path.relative_to(root).as_posix().encode("utf-8")
    value = sha256(path.read_bytes()).digest()
    for field in (name, value):
        digest.update(len(field).to_bytes(4, "big"))
        digest.update(field)
print(digest.hexdigest())
