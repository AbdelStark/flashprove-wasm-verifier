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
  "-I$upstream/blocks" "-I$upstream/prover")
# An opt-in candidate adds only its reviewed flags (port/candidates.json). Empty is the baseline.
case "${WASM_CANDIDATE:-}" in
  "") ;;
  simd) wasm_flags+=(-msimd128) ;;
  wide) wasm_flags+=(-mwide-arithmetic) ;;
  *) echo "wasm build: unknown WASM_CANDIDATE '${WASM_CANDIDATE}'" >&2; exit 2 ;;
esac
wasm_link=(-Wl,-z,stack-size=1048576 -lunwind)
wasm_memory_link=(-Wl,--max-memory=3758096384,--wrap=malloc,--wrap=calloc,--wrap=realloc,--wrap=aligned_alloc)

prepare_wasm_source() {
  mkdir -p "$1/verifier"
  cp -R "$upstream/verifier/src" "$1/verifier/"
  (cd "$1" && patch -s -f -F 0 -p1 < "$ROOT/patches/0001-wasm32-file-offsets.patch")
}
