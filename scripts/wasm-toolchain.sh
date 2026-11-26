# Shared by the serving build and the focused probe. Sourced, not run.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

upstream=$ROOT/.upstream/FlashProve
wasm_cxx=$ROOT/.toolchain/wasi-sdk/bin/wasm32-wasip1-clang++
wasm_flags=(-std=c++17 -O2 -fexceptions -fwasm-exceptions -mllvm -wasm-use-legacy-eh=false
  -fno-fast-math -ffp-contract=off
  -mno-relaxed-simd -fstack-protector-strong -ftrivial-auto-var-init=zero
  -D_LIBCPP_HARDENING_MODE=_LIBCPP_HARDENING_MODE_FAST -D_WASI_EMULATED_SIGNAL
  -Wall -Wextra -Wuninitialized -Werror=unused-result -Wno-misleading-indentation
  -DBLK_FIELD=2 -DBLK_COUNT_HASH_CALLS=1 -DSERVING_BUILD=1 -DDIGEST_WORDS=8
  "-ffile-prefix-map=$ROOT=." "-I$ROOT/port/include"
  "-I$upstream/blocks" "-I$upstream/prover" -Wl,-z,stack-size=1048576)
wasm_link=(-lunwind)

prepare_wasm_source() {
  mkdir -p "$1/verifier"
  cp -R "$upstream/verifier/src" "$1/verifier/"
  (cd "$1" && patch -s -f -F 0 -p1 < "$ROOT/patches/0001-wasm32-file-offsets.patch")
}
