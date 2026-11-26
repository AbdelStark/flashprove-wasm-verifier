#!/usr/bin/env bash
source "$(dirname "$0")/numeric-toolchain.sh"

out=$ROOT/build/c3
mkdir -p "$out"
work=$(mktemp -d "$out/.building.XXXXXX")
trap 'rm -r -- "$work"' EXIT
prepare_wasm_source "$work"

shared=("$upstream/blocks/field/tests/field_test.cpp" "$upstream/verifier/tests/field_setting_test.cpp"
  "$upstream/blocks/hash/tests/functions_test.cpp" "$upstream/blocks/hash/tests/calls_test.cpp"
  "$ROOT/conformance/c3-values.cpp")

for src in "${shared[@]}" "$upstream/blocks/hash/tests/older_test.cpp" "$upstream/blocks/hash/tests/mode_test.cpp"; do
  name=${src##*/}
  g++ "${native_flags[@]}" "$src" -o "$work/${name%.cpp}"
done
for src in "${shared[@]}"; do
  name=${src##*/}
  "$wasm_cxx" "${wasm_flags[@]}" "-I$work/verifier/src" "$src" "${wasm_link[@]}" -o "$work/${name%.cpp}.wasm"
done

python3 -B "$ROOT/conformance/c3.py" "$work"
