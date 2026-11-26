#!/usr/bin/env bash
source "$(dirname "$0")/../scripts/wasm-toolchain.sh"

build=$ROOT/build
module=$build/wasm/cp_verify.wasm
read -r digest < "$build/wasm/source.sha256"
native=$build/native-build.log
if [[ ! -f $native ]]; then
  echo 'wasm build test: needs build/native-build.log from make reference on x86_64 Linux' >&2
  exit 2
fi
if ! grep -Fx "reference: upstream=$(lock upstream.lock FLASHPROVE_COMMIT)" "$native" >/dev/null ||
   ! grep -Fx "build=$digest dw=8" "$native" >/dev/null ||
   ! grep -Fx 'reference: upstream checkout is clean at the verified pin' "$native" >/dev/null; then
  echo 'wasm build test: native build log does not match the guest pin or digest' >&2
  exit 1
fi
python3 - "$module" "$digest" <<'PY'
from pathlib import Path
import sys

if bytes(sys.argv[2], "ascii") + b"\0" not in Path(sys.argv[1]).read_bytes():
    raise SystemExit("wasm build test: source digest missing from linked module")
PY
printf 'wasm build test: native and guest source digest %s\n' "$digest"

wasmtime=$ROOT/.toolchain/wasmtime/wasmtime
fixture=$upstream/examples/accepted-proof
work=$(mktemp -d "$build/.wasm-probe.XXXXXX")
trap 'rm -r -- "$work"' EXIT
prepare_wasm_source "$work"
"$wasm_cxx" "${wasm_flags[@]}" "-I$work/verifier/src" "-DVF_SOURCE_DIGEST=\"$digest\"" \
  "$ROOT/conformance/wasm-build-probe.cpp" "$ROOT/port/baseline.cpp" "${wasm_link[@]}" \
  -Wl,--wrap=pipe,--wrap=fork,--wrap=waitpid,--wrap=ftello -o "$work/probe.wasm"

status=0
printf 'NO: fpv-probe-reader\n' | "$wasmtime" run --dir "$fixture::/fixture" \
  "$work/probe.wasm" /fixture/example.y > "$work/probe.stdout" || status=$?
grep -Fx 'probe: file offset and parFor checks passed' "$work/probe.stdout"
[[ $status == 1 && $(tail -n 1 "$work/probe.stdout") == 'NO: fpv-probe-reader' ]]
echo 'wasm build test: parent reader drained the rejected child'

"$ROOT/scripts/bootstrap-wasmtime-python.sh"
cd "$ROOT"
"$ROOT/.toolchain/wasmtime-python/bin/python" -B -m conformance.wasmtime_c1 --thread-boundaries
