#!/usr/bin/env bash
source "$(dirname "$0")/../scripts/wasm-toolchain.sh"

if [[ $(uname -s) != Linux || $(uname -m) != x86_64 ]]; then
  echo 'C3: requires x86_64 Linux with g++ 13 or later for the native run' >&2
  exit 2
fi
version=$(g++ -dumpfullversion)
if [[ ! $version =~ ^[0-9]+(\.[0-9]+)*$ || ${version%%.*} -lt 13 ]]; then
  echo 'C3: requires g++ 13 or later' >&2
  exit 2
fi

export LC_ALL=C
out=$ROOT/build/c3
mkdir -p "$out"
work=$(mktemp -d "$out/.building.XXXXXX")
trap 'rm -r -- "$work"' EXIT
prepare_wasm_source "$work"

native_flags=(-std=c++17 -O2 -fno-ipa-modref -pthread -fno-fast-math -ffp-contract=off
  -DBLK_FIELD=2 -DDIGEST_WORDS=8 -DBLK_COUNT_HASH_CALLS=1
  "-I$upstream/verifier/src" "-I$upstream/blocks" "-I$upstream/prover")
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
