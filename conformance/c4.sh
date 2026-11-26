#!/usr/bin/env bash
source "$(dirname "$0")/numeric-toolchain.sh"

out=$ROOT/build/c4
mkdir -p "$out"
work=$(mktemp -d "$out/.building.XXXXXX")
trap 'rm -r -- "$work"' EXIT
prepare_wasm_source "$work"
read -r digest < "$ROOT/build/wasm/source.sha256"
define="-DVF_SOURCE_DIGEST=\"$digest\""
src=$ROOT/conformance/c4-tables.cpp

g++ "${native_flags[@]}" -DSERVING_BUILD=1 "$define" "$src" -o "$work/tables"
"$wasm_cxx" "${wasm_flags[@]}" "-I$work/verifier/src" -Wno-unused-function "$define" "$src" \
  "${wasm_link[@]}" -o "$work/tables.wasm"

(cd "$ROOT" && python3 -B -m conformance.c4 "$work" "$@")
