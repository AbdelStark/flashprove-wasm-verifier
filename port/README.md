# port

Everything that makes upstream's `cp_verify` sources build and run as WebAssembly, without editing them (SPEC.md, R-SRC-2).

- `include/`: platform headers placed ahead of the SDK headers.
- `baseline.cpp`: single-threaded POSIX shims. libc++ turns `pthread_create`'s `ENOSYS` into `std::system_error`. Mutex lock and unlock return success without changing state.
- `ABI.md` (M2): the `fpv_port` import module, versioned (R-API-4).

Every shim answers one row of the port audit in SPEC.md § 6. A shim without a row, or a row without a shim, fails the audit test.

## Serving build

`make build` emits `build/wasm/cp_verify.wasm` and the upstream and port digests. The baseline returns `NOT CHECKED: internal-stage` if a call reaches stage dispatch while process transport is pending. `pipe` and `dup2` return `ENOSYS` in wasi-libc. The port supplies the same result for `fork` and `waitpid`.

The linked module imports WASI Preview 1 only. The SDK currently links `environ_get`, `environ_sizes_get` and `random_get`. The restricted host will supply an empty environment and deny ambient randomness. The full import audit and host are separate milestone gates.

`make wasm-build-test` uses the log from `make reference` on x86_64 Linux to compare source digests. It checks the accepted and rejected `-j` boundaries and exercises the unmodified worker and reader fallback code in a separate probe.

The serving build uses the upstream macros, C++17, `-O2`, exceptions and the same compiler warnings. It selects standard WebAssembly exception handling and links the SDK's `libunwind`. It forbids fast-math, floating-point contraction and relaxed SIMD.

| Native option | wasm32-wasip1 disposition |
|---|---|
| `-D_GLIBCXX_ASSERTIONS` | libc++ fast hardening checks bounds and library preconditions. |
| `-D_FORTIFY_SOURCE=3` | Omitted because the pinned wasi-libc has no fortify wrappers. |
| `-fstack-protector-strong`, `-ftrivial-auto-var-init=zero` | Kept. |
| `-fstack-clash-protection` | Omitted because WebAssembly has a bounded linear memory, with no OS stack guard for the guest. |
| `-fPIE`, `-pie`, `-z relro`, `-z now`, `-z noexecstack` | Omitted. The module has no ELF dynamic loader, and linear memory is separate from executable code. |
| `-fcf-protection=full` | Omitted. The native option targets x86. WebAssembly validates indirect call types. |
| `-fno-ipa-modref` | Omitted. Clang has no GCC IPA modref pass. |
| `-pthread` | Omitted for the single-threaded target. libc++ uses the local POSIX shims. |
