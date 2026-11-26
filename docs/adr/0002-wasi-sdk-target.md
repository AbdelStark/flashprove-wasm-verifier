# 0002. Target wasm32-wasip1 with wasi-sdk

Status: accepted, 2026-11-26

## Context

Two toolchains compile C++ to WebAssembly: wasi-sdk (clang, wasi-libc, libc++; output runs in any WASI host) and Emscripten (clang, a JavaScript runtime layer, browser first). The verifier needs a filesystem view of a few input files, standard output, and, for the stages, a way to run code in a fresh memory. It needs no graphics, no network and no browser API.

## Decision

Build for `wasm32-wasip1` with the wasi-sdk version in `toolchain.lock`. Write our own small host in TypeScript that implements the WASI preview 1 calls the module uses, plus the `fpv_port` imports. Use Wasmtime to run part-calls in M1, and as a candidate second host.

## Consequences

- One module runs in Wasmtime, Node, Deno, Bun and browsers. CI can test it without a browser.
- We own the host. It is small, and it is where stage instances, in-memory files and limits live, so we want to own it anyway.
- Threads come later through `wasm32-wasip1-threads` (R-THR-2). If that proves impractical in browsers, Emscripten's pthreads are the fallback, by a new ADR.
- wasi-libc's `libm` is not glibc's. R-FP-1 tests the consequence.
