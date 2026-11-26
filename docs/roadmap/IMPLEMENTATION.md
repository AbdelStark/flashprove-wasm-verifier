# Implementation Tracker | 2026-11-26

Generated from the [v1 specification corpus](https://github.com/AbdelStark/flashprove-wasm-verifier/pull/1). This inventory covers 37 implementation issues and 10 subsystem trackers. Status reflects filing day. The linked issues hold current status and acceptance evidence.

## M0 Ground

| Issue | Title | Area | Priority | Effort | RFC | Status |
|---|---|---|---|---|---|---|
| [#12](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/12) | build: run the pinned native reference on C1 | build | P0 | M | [RFC-0001](../rfcs/RFC-0001-build-and-source.md) | Open |

## M1 One stage

| Issue | Title | Area | Priority | Effort | RFC | Status |
|---|---|---|---|---|---|---|
| [#13](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/13) | build: compile the single-threaded WebAssembly module | build | P0 | M | [RFC-0001](../rfcs/RFC-0001-build-and-source.md), [RFC-0002](../rfcs/RFC-0002-numerical-parity.md) | Open |
| [#14](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/14) | build: enforce the source and binary port audit | build | P0 | M | [RFC-0001](../rfcs/RFC-0001-build-and-source.md) | Open |
| [#15](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/15) | numeric: run upstream field and hash known answers | numeric | P0 | M | [RFC-0002](../rfcs/RFC-0002-numerical-parity.md) | Open |
| [#16](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/16) | numeric: compare all four verifier tables against the oracle | numeric | P0 | L | [RFC-0002](../rfcs/RFC-0002-numerical-parity.md) | Open |
| [#17](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/17) | io: audit and implement restricted guest I/O | io | P0 | M | [RFC-0003](../rfcs/RFC-0003-input-host.md), [RFC-0001](../rfcs/RFC-0001-build-and-source.md) | Open |
| [#18](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/18) | stages: run key and leaf part calls in Wasmtime | stages | P0 | L | [RFC-0004](../rfcs/RFC-0004-stage-replay.md) | Open |
| [#19](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/19) | conformance: compare native and guest terminal records | conformance | P0 | M | [RFC-0006](../rfcs/RFC-0006-conformance.md) | Open |
| [#20](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/20) | conformance: require the M1 known-answer and part-call gates | conformance | P0 | S | [RFC-0006](../rfcs/RFC-0006-conformance.md) | Open |
| [#21](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/21) | limits: measure the full-size stage memory envelope | limits | P0 | L | [RFC-0005](../rfcs/RFC-0005-failure-boundary.md), [RFC-0009](../rfcs/RFC-0009-performance.md) | Open |

## M2 Whole call

| Issue | Title | Area | Priority | Effort | RFC | Status |
|---|---|---|---|---|---|---|
| [#22](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/22) | io: implement the TypeScript read-only call namespace | io | P0 | M | [RFC-0003](../rfcs/RFC-0003-input-host.md) | Open |
| [#23](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/23) | io: acquire scoped CLI files in native read order | io | P0 | M | [RFC-0003](../rfcs/RFC-0003-input-host.md) | Open |
| [#24](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/24) | stages: run whole calls with ordinal replay in Node | stages | P0 | L | [RFC-0004](../rfcs/RFC-0004-stage-replay.md) | Open |
| [#25](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/25) | stages: document and freeze the v1 guest ABI | stages | P1 | S | [RFC-0004](../rfcs/RFC-0004-stage-replay.md), [RFC-0003](../rfcs/RFC-0003-input-host.md) | Open |
| [#26](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/26) | limits: latch guest failures before publishing a result | limits | P0 | L | [RFC-0005](../rfcs/RFC-0005-failure-boundary.md) | Open |
| [#27](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/27) | limits: supervise deadlines outside guest execution | limits | P0 | M | [RFC-0005](../rfcs/RFC-0005-failure-boundary.md) | Open |
| [#28](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/28) | limits: emit redacted host diagnostics and provenance | limits | P1 | S | [RFC-0005](../rfcs/RFC-0005-failure-boundary.md), [RFC-0001](../rfcs/RFC-0001-build-and-source.md) | Open |
| [#29](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/29) | cli: expose fpv with native arguments and byte streams | cli | P0 | M | [RFC-0007](../rfcs/RFC-0007-public-interfaces.md) | Open |
| [#30](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/30) | conformance: run whole calls and argument cases against native | conformance | P0 | M | [RFC-0006](../rfcs/RFC-0006-conformance.md), [RFC-0007](../rfcs/RFC-0007-public-interfaces.md) | Open |
| [#31](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/31) | conformance: run all upstream altered-proof tables | conformance | P0 | M | [RFC-0006](../rfcs/RFC-0006-conformance.md) | Open |
| [#32](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/32) | conformance: add deterministic seeds and replayable regressions | conformance | P0 | L | [RFC-0006](../rfcs/RFC-0006-conformance.md) | Open |
| [#33](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/33) | conformance: enforce exact results at host failure boundaries | conformance | P0 | M | [RFC-0005](../rfcs/RFC-0005-failure-boundary.md), [RFC-0006](../rfcs/RFC-0006-conformance.md) | Open |

## M3 Browser

| Issue | Title | Area | Priority | Effort | RFC | Status |
|---|---|---|---|---|---|---|
| [#34](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/34) | library: expose typed verification and parse terminal results | library | P0 | M | [RFC-0007](../rfcs/RFC-0007-public-interfaces.md) | Open |
| [#35](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/35) | browser: supervise verification in a dedicated worker | browser | P0 | M | [RFC-0007](../rfcs/RFC-0007-public-interfaces.md), [RFC-0005](../rfcs/RFC-0005-failure-boundary.md) | Open |
| [#36](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/36) | acceptance: enforce the eight caller checks | acceptance | P0 | L | [RFC-0008](../rfcs/RFC-0008-caller-acceptance.md) | Open |
| [#37](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/37) | browser: verify published fixtures from an offline static bundle | browser | P1 | M | [RFC-0007](../rfcs/RFC-0007-public-interfaces.md), [RFC-0008](../rfcs/RFC-0008-caller-acceptance.md) | Open |
| [#38](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/38) | release: package typed runtime entry points and notices | release | P1 | M | [RFC-0010](../rfcs/RFC-0010-release.md), [RFC-0007](../rfcs/RFC-0007-public-interfaces.md) | Open |

## M4 Speed

| Issue | Title | Area | Priority | Effort | RFC | Status |
|---|---|---|---|---|---|---|
| [#39](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/39) | performance: benchmark whole calls in the independent host | performance | P1 | M | [RFC-0009](../rfcs/RFC-0009-performance.md), [RFC-0004](../rfcs/RFC-0004-stage-replay.md) | Open |
| [#40](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/40) | performance: publish the full-size runtime comparison | performance | P1 | L | [RFC-0009](../rfcs/RFC-0009-performance.md) | Open |
| [#41](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/41) | performance: evaluate isolated shared-memory stage threads | performance | P2 | L | [RFC-0009](../rfcs/RFC-0009-performance.md) | Open |
| [#42](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/42) | performance: evaluate exact integer SIMD kernels | performance | P2 | M | [RFC-0009](../rfcs/RFC-0009-performance.md) | Open |
| [#43](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/43) | performance: evaluate a flagged wide multiplication path | performance | P2 | M | [RFC-0009](../rfcs/RFC-0009-performance.md) | Open |

## M5 Release

| Issue | Title | Area | Priority | Effort | RFC | Status |
|---|---|---|---|---|---|---|
| [#44](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/44) | docs: enforce link, RFC and milestone integrity | docs | P1 | S | [RFC-0010](../rfcs/RFC-0010-release.md) | Open |
| [#45](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/45) | release: require identical module bytes from two clean roots | release | P0 | M | [RFC-0010](../rfcs/RFC-0010-release.md) | Open |
| [#46](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/46) | release: require whole-call conformance and fuzz in CI | release | P0 | M | [RFC-0010](../rfcs/RFC-0010-release.md), [RFC-0006](../rfcs/RFC-0006-conformance.md) | Open |
| [#47](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/47) | release: rehearse an upstream pin update end to end | release | P1 | M | [RFC-0010](../rfcs/RFC-0010-release.md) | Open |
| [#48](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/48) | release: sign, verify and publish v1.0.0 artifacts | release | P0 | L | [RFC-0010](../rfcs/RFC-0010-release.md) | Open |

## Tracking issues

- [#2](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/2) [Tracking] Pinned build and port audit. [RFC-0001](../rfcs/RFC-0001-build-and-source.md)
- [#3](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/3) [Tracking] Numerical parity. [RFC-0002](../rfcs/RFC-0002-numerical-parity.md)
- [#4](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/4) [Tracking] Immutable guest input and restricted I/O. [RFC-0003](../rfcs/RFC-0003-input-host.md)
- [#5](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/5) [Tracking] Stage replay and ABI. [RFC-0004](../rfcs/RFC-0004-stage-replay.md)
- [#6](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/6) [Tracking] Resource limits and host failure handling. [RFC-0005](../rfcs/RFC-0005-failure-boundary.md)
- [#7](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/7) [Tracking] Differential conformance and regression evidence. [RFC-0006](../rfcs/RFC-0006-conformance.md)
- [#8](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/8) [Tracking] CLI, library, worker and offline demo. [RFC-0007](../rfcs/RFC-0007-public-interfaces.md)
- [#9](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/9) [Tracking] Caller acceptance. [RFC-0008](../rfcs/RFC-0008-caller-acceptance.md)
- [#10](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/10) [Tracking] Runtime measurements and optimization candidates. [RFC-0009](../rfcs/RFC-0009-performance.md)
- [#11](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/11) [Tracking] Reproducibility, packaging and release. [RFC-0010](../rfcs/RFC-0010-release.md)

## Cross-cutting dependencies

- [#12](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/12) build: run the pinned native reference on C1
  - Blocks [#13](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/13) because it provides the native source digest and flag baseline.
  - Blocks [#19](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/19) because it provides reference execution and expected outcome sanity checks.
- [#13](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/13) build: compile the single-threaded WebAssembly module
  - Blocks [#14](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/14) because it supplies resolved build inputs and module imports.
  - Blocks [#15](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/15) because it provides the pinned guest compiler and flags.
  - Blocks [#16](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/16) because it provides the precise serving compiler flags.
- [#14](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/14) build: enforce the source and binary port audit
  - Blocks [#17](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/17) because it sets the allowlist and detects import drift.
  - Blocks [#45](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/45) because it defines approved build inputs and flags.
- [#15](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/15) numeric: run upstream field and hash known answers
  - Blocks [#20](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/20) because it provides C3.
  - Blocks [#43](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/43) because it supplies field known-answer coverage.
- [#16](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/16) numeric: compare all four verifier tables against the oracle
  - Blocks [#20](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/20) because it provides C4.
- [#17](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/17) io: audit and implement restricted guest I/O
  - Blocks [#18](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/18) because it defines descriptor ownership and guest import restrictions.
  - Blocks [#22](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/22) because it defines the import boundary.
- [#18](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/18) stages: run key and leaf part calls in Wasmtime
  - Blocks [#20](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/20) because it provides Wasmtime C1 part-calls.
  - Blocks [#21](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/21) because it supplies the bounded guest stage runner.
  - Blocks [#24](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/24) because it provides guest process shims and ABI behavior.
  - Blocks [#39](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/39) because it provides independent part-call execution.
- [#19](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/19) conformance: compare native and guest terminal records
  - Blocks [#20](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/20) because it compares the native and guest results.
- [#20](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/20) conformance: require the M1 known-answer and part-call gates
  - Blocks [#30](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/30) because it supplies the numerical and harness prerequisites.
- [#21](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/21) limits: measure the full-size stage memory envelope
  - Blocks [#23](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/23) because it provides the file envelope.
  - Blocks [#26](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/26) because it identifies executable cap defaults.
  - Blocks [#39](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/39) because it provides the measured guest envelope.
- [#22](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/22) io: implement the TypeScript read-only call namespace
  - Blocks [#23](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/23) because it provides the immutable virtual view.
  - Blocks [#24](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/24) because it provides frozen input and descriptors.
- [#23](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/23) io: acquire scoped CLI files in native read order
  - Blocks [#29](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/29) because it supplies scoped file acquisition.
- [#24](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/24) stages: run whole calls with ordinal replay in Node
  - Blocks [#25](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/25) because it supplies the whole-call ABI implementation.
  - Blocks [#26](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/26) because it provides parent/child execution and cleanup points.
  - Blocks [#28](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/28) because it provides stage lifecycle events.
- [#25](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/25) stages: document and freeze the v1 guest ABI
  - Blocks [#39](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/39) because it defines the frozen interface.
- [#26](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/26) limits: latch guest failures before publishing a result
  - Blocks [#27](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/27) because it provides the fault latch and terminal result.
  - Blocks [#28](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/28) because it provides failure and memory events.
- [#27](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/27) limits: supervise deadlines outside guest execution
  - Blocks [#29](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/29) because it supplies completed call results.
- [#29](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/29) cli: expose fpv with native arguments and byte streams
  - Blocks [#30](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/30) because it provides the production entry point.
  - Blocks [#33](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/33) because it exposes the production host.
  - Blocks [#34](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/34) because it uses the shared host and public stream semantics.
  - Blocks [#38](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/38) because it provides the executable entry point.
- [#30](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/30) conformance: run whole calls and argument cases against native
  - Blocks [#31](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/31) because it provides the whole-call differential harness.
  - Blocks [#32](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/32) because it provides pinned whole-call comparisons and reports.
  - Blocks [#33](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/33) because it provides the native comparison path.
- [#31](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/31) conformance: run all upstream altered-proof tables
  - Blocks [#46](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/46) because it provides the complete C2 matrix.
- [#32](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/32) conformance: add deterministic seeds and replayable regressions
  - Blocks [#46](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/46) because it provides seeded comparisons and shard integrity.
- [#33](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/33) conformance: enforce exact results at host failure boundaries
  - Blocks [#35](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/35) because it provides fail-closed boundary cases.
  - Blocks [#46](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/46) because it provides failure-boundary cases.
- [#34](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/34) library: expose typed verification and parse terminal results
  - Blocks [#35](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/35) because it supplies public result types and behavior.
  - Blocks [#36](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/36) because it supplies authentic result objects and structured output.
  - Blocks [#38](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/38) because it provides strict public types.
- [#35](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/35) browser: supervise verification in a dedicated worker
  - Blocks [#36](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/36) because it provides validated worker evidence.
  - Blocks [#40](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/40) because it adds browser whole calls.
- [#36](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/36) acceptance: enforce the eight caller checks
  - Blocks [#37](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/37) because it exposes separate acceptance decisions.
- [#37](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/37) browser: verify published fixtures from an offline static bundle
  - Blocks [#38](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/38) because it provides the bundled distribution boundary.
- [#38](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/38) release: package typed runtime entry points and notices
  - Blocks [#40](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/40) because it provides the installable runtime entry points.
  - Blocks [#45](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/45) because it defines the artifact being staged.
- [#39](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/39) performance: benchmark whole calls in the independent host
  - Blocks [#40](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/40) because it adds the Wasmtime whole-call row.
- [#40](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/40) performance: publish the full-size runtime comparison
  - Blocks [#41](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/41) because it supplies the comparison protocol and baseline.
  - Blocks [#42](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/42) because it supplies the common protocol.
  - Blocks [#43](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/43) because it supplies the measurement baseline.
- [#41](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/41) performance: evaluate isolated shared-memory stage threads
  - Blocks [#48](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/48) because it records threaded candidate disposition.
- [#42](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/42) performance: evaluate exact integer SIMD kernels
  - Blocks [#48](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/48) because it records SIMD candidate disposition.
- [#43](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/43) performance: evaluate a flagged wide multiplication path
  - Blocks [#48](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/48) because it records wide-multiply candidate disposition.
- [#44](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/44) docs: enforce link, RFC and milestone integrity
  - Blocks [#48](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/48) because it provides clean contributor and release docs.
- [#45](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/45) release: require identical module bytes from two clean roots
  - Blocks [#46](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/46) because it provides reproducibility evidence.
- [#46](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/46) release: require whole-call conformance and fuzz in CI
  - Blocks [#47](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/47) because it provides the full required gates.
- [#47](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/47) release: rehearse an upstream pin update end to end
  - Blocks [#48](https://github.com/AbdelStark/flashprove-wasm-verifier/issues/48) because it provides the upstream update rehearsal.
