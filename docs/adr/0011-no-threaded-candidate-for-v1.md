# 0011. Do not build a threaded candidate for v1

- Status: Accepted
- Requirements: R-PERF-1, R-PERF-3, R-THR-1, R-THR-2, R-THR-3

## Context

RFC-0009 lists an opt-in threaded build: wasi-threads with one shared memory per stage, workers that only that stage's threads share, and upstream's serial fallback when a thread cannot start. The baseline makes `pthread_create` return `ENOSYS` (`port/baseline.cpp`), so upstream's `parFor` runs serially at every `-j`. A threaded build needs `wasm32-wasip1-threads`, an imported shared memory for each stage instance, a `thread-spawn` host in Node and in the browser worker that instantiates the module on that memory, cross-origin isolation for `SharedArrayBuffer` in browsers, and new failure paths for spawn, wait and teardown. Each new path must fail closed.

A threaded wasm build cannot run faster than the native verifier gains from its own threads on the same call.

## Evidence

Protocol: native `cp_verify` from the pinned source, compiled locally with Apple clang and upstream's serving defines, used only for this measurement; the pinned reference is a g++ build on Linux. Apple M4 Max with macOS, 16 logical CPUs. Fixture `full-size`, whole call with `-q`. One warmup and three fresh processes per `-j`, timed launch to exit; the statistic is the median. Every call exited 0 with `YES`.

| `-j` | Median (s) | Samples (s) |
|---:|---:|---|
| 1 | 7.88 | 7.85 / 7.95 / 7.88 |
| 4 | 6.43 | 6.41 / 6.43 / 6.43 |
| 16 | 6.29 | 6.28 / 6.30 / 6.29 |

Threads save at most 20% of the native call here, a factor of 1.25, and almost all of it by `-j 4`. The candidates workflow measures the pinned g++ reference at `-j 1`, `2`, `4` and the runner's CPU count on x86_64 Linux and keeps the report. By comparison, the wide-arithmetic build halves the Wasmtime call with no new host surface (ADR 0010).

## Decision

Do not build the threaded candidate for v1. Its ceiling is about 1.25 times on the full-size call, before thread start-up and the cost of atomics in Wasm, and it adds a shared-memory host, cross-origin isolation and new failure modes on the verification path. The baseline stays single-threaded. It accepts every `-j` from 1 to 256 and runs serially through upstream's own fallback, which C6 compares with native at the `-j` boundaries.

Reopen this decision if upstream parallelizes more of the call, so that the native `-j` scaling on the measurement host exceeds 2 times, or if wide arithmetic ships in the browser engines and threads become the largest remaining factor. That issue then needs the full `-j 1..256` sweep, spawn-failure and missing-shared-memory tests, C3, C4, full conformance and C5 on the candidate.
