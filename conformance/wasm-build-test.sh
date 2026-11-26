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

for threads in 0 1 256 257; do
  status=0
  "$wasmtime" run --dir "$fixture::/fixture" "$module" -key /fixture/config \
    /fixture/ivk/key.bin -q -j "$threads" > "$work/key.stdout" 2> "$work/key.stderr" || status=$?
  case $threads in
    0|257)
      [[ $status == 2 ]]
      grep -F 'after -j comes a whole number from 1 to 256' "$work/key.stderr" >/dev/null
      ;;
    1|256)
      [[ $status == 5 && $(tail -n 1 "$work/key.stdout") == 'NOT CHECKED: internal-stage' ]]
      ;;
  esac
  printf 'wasm build test: -j %d exit=%d\n' "$threads" "$status"
done

status=0
"$wasmtime" run --dir "$fixture::/fixture" "$module" /fixture/config /fixture/ivk \
  /fixture/example.req /fixture/example.y /fixture/example.proof -id "$(cat "$fixture/ID.txt")" -q \
  > "$work/whole.stdout" || status=$?
[[ $status == 5 && $(tail -n 1 "$work/whole.stdout") == 'NOT CHECKED: internal-stage' ]]
echo 'wasm build test: a published proof reaches the closed stage dispatch'
