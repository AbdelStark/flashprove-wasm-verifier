# port

Everything that makes upstream's `cp_verify` sources build and run as WebAssembly, without editing them (SPEC.md, R-SRC-2).

- `include/`: shim headers, placed ahead of wasi-libc and libc++ on the include path. First residents (M1): `<thread>` whose constructor throws `std::system_error` (R-THR-1), no-op `<mutex>`, and the process calls that `cpStagesRun()` uses (`fork`, `pipe`, `dup2`, `waitpid`), implemented over the `fpv_port` imports (R-STG-2, R-STG-3).
- `ABI.md` (M2): the `fpv_port` import module, versioned (R-API-4).

Every shim answers one row of the port audit in SPEC.md § 6. A shim without a row, or a row without a shim, fails the audit test.
