# 0010. Keep wide arithmetic opt-in until the product runtimes run it

- Status: Accepted
- Requirements: R-PERF-1, R-PERF-3, R-EQ-1

## Context

The field arithmetic forms 64-by-64-bit products as `unsigned __int128`. On wasm32 the baseline lowers each one to a call into compiler-rt's `__multi3`. The wide-arithmetic proposal adds `i64.mul_wide_u`, which computes the same 128-bit product in one instruction. The candidate adds only `-mwide-arithmetic` (`WASM_CANDIDATE=wide`, `port/candidates.json`). Its single declared inventory change is that the serving units no longer reference `__multi3`. The Goldilocks reduction code is unchanged, so the same source computes the same values.

## Evidence

Protocol: as in ADR 0009, on an Apple M4 Max with macOS, Wasmtime 51.0.0 through the pinned Python embedding, the `full-size` whole call with `-q -j 1`, one warmup and three fresh processes, median of the three. The build has 3,026 `i64.mul_wide_u` instructions. Every call printed the baseline's stdout, apart from the approved stage-heading fields, and ended in `YES`.

| Build | Wasmtime median (s) |
|---|---:|
| Baseline | 24.59 (24.56 / 24.60 / 24.59) |
| `-mwide-arithmetic` | 12.57 (12.59 / 12.57 / 12.56) |

On `accepted-proof` the medians were 2.51 s and 1.90 s. These figures hold only for these builds, this machine and this runtime.

The candidates workflow repeated the protocol on a GitHub-hosted ubuntu-24.04 virtual machine (AMD EPYC 7763, 4 logical CPUs): 69.95 s for the baseline (69.57 / 70.62 / 69.95) against 30.78 s (30.78 / 30.78 / 30.47), 2.27 times faster, with outputs equal to the baseline. On that build the audit, C3, C4, the Wasmtime part calls and every published whole call in Wasmtime matched native.

V8 in the pinned Node 24.22.1 has no wide-arithmetic support, not even behind a flag. The module does not compile there, so Node, Chromium and the library cannot run it. The pinned Wasmtime CLI and embedding run it.

## Decision

Do not promote. RFC-0009 needs full conformance, C5 and support on the product runtimes before a candidate replaces the baseline. C5 and the Node gates cannot run without V8 support. A browser or Node host given this module fails closed: compilation fails and the call ends in `integrity` or `abi`.

Keep the build as an opt-in for embedders that run Wasmtime, where it cut the measured full-size call by about half on both machines. Revisit when V8, SpiderMonkey and JavaScriptCore ship the proposal. Promotion then needs the full gates on each product runtime, and an ADR naming the runtime versions.
