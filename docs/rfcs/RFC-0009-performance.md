# RFC-0009: Measure full calls and gate faster builds

- Status: Accepted
- Authors: @AbdelStark
- Created: 2026-11-26
- Target milestone: M4

## Summary

Use a common whole-call measurement protocol, preserve the baseline and evaluate threaded, SIMD and wide arithmetic candidates independently.

## Motivation

A fast part-call does not describe the browser experience or the cost of replay. R-PERF-1 through R-PERF-3 require comparable evidence before any verification-path optimization ships.

## Goals

- Publish whole-call measurements and verdicts for the full runtime matrix.
- Verify candidate flags independently before measuring a combined build.
- Preserve the single-thread baseline for users without candidate features.

## Non-Goals

- A release threshold stated as an unmeasured speedup.
- Relaxed SIMD, fast-math or changes to verification arithmetic.

## Proposed Design

`make bench` writes `BenchmarkV1` records under `build/` with the measurement boundaries in the [performance budget](../spec/08-performance-budget.md#measurement-protocol). Use an x86_64 measurement host capable of the browser matrix and run native in its identified Linux environment when necessary. Pin and build the Bend reference for the same fixture and policy. Compare semantics and report any unavailable equivalent measurement as a gate blocker. A planning or part-call result cannot fill a whole-call row. Record one-time setup separately if the timing boundary excludes it. Include observed exit and verdict in each sample group.

Extend the independent Wasmtime adapter to run full calls and measure memory and replay. Use the C interface from the exact Wasmtime release with a verified archive during the build. Invoke the pinned guest through the same ABI, with declared fixture files, memory limit and a run deadline. This runner is a test and benchmark executable.

Emit separate opt-in builds for each candidate. For threads target shared-memory WASI Preview 1 threads. Give each stage its own shared memory, isolated from parent and other stages. Only workers of that stage share it. Pass a checked thread-creation result to upstream and preserve its fallback when workers cannot start. Validate the complete `-j 1..256` range, including thread-creation failures, results and exit statuses. Browser threading needs cross-origin isolation and `SharedArrayBuffer`. Explicitly requesting a candidate on an incompatible runtime returns a host refusal. The default uses the baseline.

Evaluate portable integer SIMD where it preserves the exact scalar operations. Reject relaxed SIMD opcodes. Evaluate a 64-by-64 implementation under a build flag with full-width products and identical field reduction. Select candidates using full conformance, field and table parity, measured effect and supported runtime coverage. If a candidate fails its gate, document the result and keep using the baseline. Changes to core code need the normal patch and ADR review.

## Alternatives Considered

- Benchmark only the request kernel. That omits port overhead and part stages.
- Ship threads by default. Some runtimes cannot provide shared memory under their deployment policies.
- Replace exact arithmetic with faster approximate operations. That changes the decision contract.

## Drawbacks

- Whole-call comparisons cost more to produce and can involve multiple OS environments.
- Opt-in builds enlarge the support and test matrix.

## Migration / Rollout

Measure the baseline first. Keep candidates behind options during evaluation, and record each disposition before M5. Promote a candidate only through a separate default change with complete comparison evidence.

## Testing Strategy

Run baseline and candidates on identical fixtures and argument vectors and check their final lines and exits. Compare all field and table values and execute the full applicable corpora before reporting gains. Exercise unavailable shared memory, forced thread creation failure, and the low and high `-j` edges. Fail the report check if a runtime row is missing or a run lacks a verdict.

## Open Questions

- OPEN QUESTION: Can the pinned shared-memory target support the required start, fallback and isolation behavior across the matrix? The M4 performance owner resolves it at the M4 gate with capability probes, the `-j` sweep and a disposition ADR. Failed targets keep the baseline.

## References

[Performance budget](../spec/08-performance-budget.md) · [Threads](../../SPEC.md#44-threads) · [Integer requirements](../../SPEC.md#46-integers) · [Performance requirements](../../SPEC.md#411-performance)
