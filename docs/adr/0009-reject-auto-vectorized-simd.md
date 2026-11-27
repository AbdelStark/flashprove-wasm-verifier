# 0009. Reject the auto-vectorized SIMD candidate

- Status: Accepted
- Requirements: R-PERF-1, R-PERF-3, R-FP-3

## Context

RFC-0009 asks whether portable integer SIMD helps while it keeps the exact scalar results. The candidate adds only `-msimd128` to the serving flags (`WASM_CANDIDATE=simd`, `port/candidates.json`). The compiler then auto-vectorizes loops it can prove equivalent. `-mno-relaxed-simd`, `-fno-fast-math` and `-ffp-contract=off` stay, so no relaxed opcode or reassociation is allowed. The port audit accepts no other flag and the instruction check still refuses relaxed SIMD.

## Evidence

Protocol: `python -m conformance.candidates` on an Apple M4 Max with macOS. Wasmtime 51.0.0 through the pinned Python embedding, and Node v24.22.1 through the in-process replay host. The fixture is `full-size` with `-q -j 1`, as a whole call. Each build gets one warmup and three fresh processes, timed from launch to exit, and the statistic is the median. Every call printed the same stdout as the baseline on the same runtime, apart from the approved stage-heading fields, and ended in `YES`.

| Build | SIMD instructions | Wasmtime median (s) | Node median (s) |
|---|---:|---:|---:|
| Baseline | 0 | 24.59 (24.56 / 24.60 / 24.59) | 22.67 (22.69 / 22.65 / 22.67) |
| `-msimd128` | 44,421 | 38.50 (38.51 / 38.50 / 38.41) | 33.51 (33.51 / 33.48 / 33.56) |

The small `accepted-proof` call showed the same direction: 2.51 s against 3.10 s in Wasmtime, and 2.01 s against 2.48 s in Node. These figures hold only for these builds, this machine and these runtimes.

The candidates workflow repeated the protocol on a GitHub-hosted ubuntu-24.04 virtual machine (AMD EPYC 7763, 4 logical CPUs; Node v24.22.3), with outputs equal to the baseline: Wasmtime 69.95 s against 79.82 s, and Node 54.67 s against 62.98 s, about 14 to 15 percent slower. On that build the audit, C3, C4, the Wasmtime part calls, every published whole call in Wasmtime and Node C1, C2 and C6 (147 cases) all matched native, with no difference and no safety violation.

## Decision

Keep the scalar baseline. The vectorized build is slower on the full-size call in every runtime and machine measured, by 14 to 57 percent, so it fails RFC-0009's measured-effect gate on both machines before promotion would need the full corpus and C5. The flag stays available as an opt-in candidate for later measurements. A hand-written SIMD kernel would be an upstream source change and needs its own patch, ADR and gates.
