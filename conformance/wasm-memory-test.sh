#!/usr/bin/env bash
source "$(dirname "$0")/../scripts/wasm-toolchain.sh"

# A smaller engine maximum forces memory.grow to fail inside the checked port path.
"$wasm_cxx" "${wasm_flags[@]}" "$ROOT/conformance/wasm-memory-probe.cpp" \
  "$ROOT/port/memory.cpp" "$ROOT/port/process.cpp" "${wasm_link[@]}" "${wasm_memory_link[@]}" \
  -Wl,--max-memory=16777216 -o "$ROOT/build/wasm-memory-probe.wasm"
cd "$ROOT"
node --test conformance/node-limits-test.mjs
