#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"

venv=$ROOT/.toolchain/wasmtime-python
version=$(lock toolchain.lock WASMTIME_VERSION)
if [[ ! -x $venv/bin/python ]]; then python3 -m venv "$venv"; fi
if ! "$venv/bin/python" -c 'from importlib.metadata import version; import sys; sys.exit(version("wasmtime") != sys.argv[1])' \
   "$version" 2>/dev/null; then
  "$venv/bin/python" -m pip install --only-binary=:all: --no-deps --require-hashes \
    -r "$ROOT/host/wasmtime/requirements.txt"
fi
"$venv/bin/python" -c 'from importlib.metadata import version; import sys; sys.exit(version("wasmtime") != sys.argv[1])' "$version"
