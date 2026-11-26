#!/usr/bin/env bash
source "$(dirname "$0")/wasm-toolchain.sh"

export LC_ALL=C
sum=(sha256sum)
if ! command -v sha256sum >/dev/null; then sum=(shasum -a 256); fi
digest=$(
  cd "$upstream/verifier/src" || exit 1
  {
    "${sum[@]}" * ../../prover/*/plan_rounds.h ../../prover/hiding/token_plan.h &&
      cd ../../blocks && find . -type f -name '*.h' ! -path '*/tests/*' | sort | xargs "${sum[@]}"
  } | "${sum[@]}" | cut -c1-64
)
port=$(python3 "$ROOT/scripts/port-digest.py")

out=$ROOT/build/wasm
mkdir -p "$out"
work=$(mktemp -d "$out/.building.XXXXXX")
trap 'rm -r -- "$work"' EXIT
prepare_wasm_source "$work"
cd "$work/verifier/src"
compile=("${wasm_flags[@]}" "-ffile-prefix-map=$work=." "-DVF_SOURCE_DIGEST=\"$digest\"")
sources=(cp_verify.cpp "$ROOT/port/baseline.cpp")
for src in "${sources[@]}"; do
  name=${src##*/}
  name=${name%.cpp}
  "$wasm_cxx" "${compile[@]}" -MD -MT "$name" -MF "$work/$name.d" \
    -MJ "$work/$name.command.json" -c "$src" -o "$work/$name.o"
done
"$wasm_cxx" -fwasm-exceptions "$work/cp_verify.o" "$work/baseline.o" \
  "${wasm_link[@]}" -o "$work/cp_verify.wasm"
python3 "$ROOT/scripts/audit_wasm.py" "$work" "$digest" "$out/audit-observed.json" \
  -fwasm-exceptions "${wasm_link[@]}"
printf '%s\n' "$digest" > "$work/source.sha256"
printf '%s\n' "$port" > "$work/port.sha256"
mv "$work/source.sha256" "$work/port.sha256" "$work/cp_verify.wasm" "$out/"
printf 'build=%s dw=8\nport=%s\n' "$digest" "$port"
