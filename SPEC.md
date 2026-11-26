# flashprove-wasm-verifier v1

Normative specification for the first stable release. [Upstream pin](upstream.lock) and [toolchain pin](toolchain.lock) identify the build inputs. The implementation starts at M0. A milestone is complete only when its gate has evidence.

The project compiles FlashProve's read-only `cp_verify` to WebAssembly for public proofs. The native reference built by upstream's own script decides comparison results. A WebAssembly pass must match the native verdict on the same inputs and arguments. Host failures end in `NOT CHECKED`. Caller acceptance also requires trusted context.

## Specification corpus

| Document | Contract |
|---|---|
| [Overview](docs/spec/00-overview.md) | Users, scope and release evidence |
| [Architecture](docs/spec/01-architecture.md) | Ownership, platform audit and call lifecycle |
| [Public API](docs/spec/02-public-api.md) | Command, library and acceptance interface |
| [Data model](docs/spec/03-data-model.md) | Input snapshots, output and artifact schemas |
| [Error model](docs/spec/04-error-model.md) | Exit codes, failure boundaries and recovery |
| [Observability](docs/spec/05-observability.md) | Diagnostics, reports and redaction |
| [Security](docs/spec/06-security.md) | Trust boundaries, provenance and limits |
| [Testing strategy](docs/spec/07-testing-strategy.md) | Native oracle, comparison and gates |
| [Performance budget](docs/spec/08-performance-budget.md) | Resource envelope and measurement protocol |
| [Release and versioning](docs/spec/09-release-and-versioning.md) | Compatibility, release and pin updates |
| [Glossary](docs/spec/10-glossary.md) | Terms shared across the corpus |

## Decisions

| RFC | Decision |
|---|---|
| [RFC-0001](docs/rfcs/RFC-0001-build-and-source.md) | Native reference, source parity and audited builds |
| [RFC-0002](docs/rfcs/RFC-0002-numerical-parity.md) | Integer and floating-point parity |
| [RFC-0003](docs/rfcs/RFC-0003-input-host.md) | Immutable input and restricted host I/O |
| [RFC-0004](docs/rfcs/RFC-0004-stage-replay.md) | Fresh instances, replay and stage ABI |
| [RFC-0005](docs/rfcs/RFC-0005-failure-boundary.md) | Limits and fail-closed call completion |
| [RFC-0006](docs/rfcs/RFC-0006-conformance.md) | Differential conformance, fuzzing and regressions |
| [RFC-0007](docs/rfcs/RFC-0007-public-interfaces.md) | CLI, library, workers and offline demo |
| [RFC-0008](docs/rfcs/RFC-0008-caller-acceptance.md) | Trusted context and eight acceptance checks |
| [RFC-0009](docs/rfcs/RFC-0009-performance.md) | Runtime matrix and optimization gates |
| [RFC-0010](docs/rfcs/RFC-0010-release.md) | Reproducibility, packaging and publication |

[Accepted ADRs](docs/adr/) record the original build, target and replay decisions. New ADRs record measured decisions and identify what they supersede.

## 4. Requirements

### 4.1 Equivalence

- **R-EQ-1**. Every `YES`, `WITHIN LIMITS` or `PART PASSED` has the same native verdict, including any policy or stage suffix. This rule has no exceptions.
- **R-EQ-2**. Match native exit code, final verdict and closing bytes, and full planning output. Record differences. An explicit ADR must account for a platform difference.
- **R-EQ-3**. Only wall time and thread count fields can be excluded, by name and reason. Acceptance fields remain byte-compared.
- **R-EQ-4**. A trap, out-of-memory condition or host failure ends the call in `NOT CHECKED: internal-stage` with a nonzero exit code.

### 4.2 Source

- **R-SRC-1**. Build upstream verifier sources and their dependencies from the verified read-only pin.
- **R-SRC-2**. Keep platform code in `port/` and host adapters in `host/`. An upstream source change needs a single-concern patch and ADR documenting why shims are insufficient and which conformance covers it.
- **R-SRC-3**. Fail builds when a new platform dependency has no audited treatment.

### 4.3 Stages and isolation

- **R-STG-1**. Each stage starts with fresh instance state and memory. It shares only immutable call inputs and arguments.
- **R-STG-2**. Replay to the same fork and compare the argument and file digests at that point. A mismatch fails closed.
- **R-STG-3**. Carry child stdout and termination through the parent pipe and wait status.
- **R-STG-4**. In the baseline, run children serially to completion. Upstream merges their results.

### 4.4 Threads

- **R-THR-1**. Baseline thread creation throws `std::system_error`. Mutexes are no-ops. Upstream's worker and reader fallbacks must complete every job.
- **R-THR-2**. A separate threaded candidate uses shared memory within each stage and meets equivalence at every supported `-j`. Document browser isolation for that build.
- **R-THR-3**. Preserve upstream `-j` parsing. In the baseline the value has no effect on the verdict.

### 4.5 Floating point

- **R-FP-1**. Compare every entry of SiLU, sigmoid, RoPE and exponential tables on all C1 parameter files before whole-call testing.
- **R-FP-2**. Resolve discrepancies by ADR with exhaustive input-sweep evidence for a math replacement or a narrow patch. Keep digest checks and in-program table generation.
- **R-FP-3**. Forbid fast-math, relaxed SIMD and floating-point contraction.

### 4.6 Integers

- **R-INT-1**. Use compiler-rt wide arithmetic on the Goldilocks field and run upstream field known answers before whole-call tests.
- **R-INT-2**. Gate candidate wide multiplication behind a build flag and require field tests and full equivalence before changing the default.

### 4.7 Memory and hostile inputs

- **R-MEM-1**. Measure native peak RSS at `-j 1` and peak WebAssembly linear memory per full-size stage. Keep margin below 4 GiB in the baseline. An ADR decides the mitigation if request does not fit.
- **R-MEM-2**. Enforce and publish file and instance limits. A hit limit ends in `NOT CHECKED`.
- **R-MEM-3**. Support public files only. Release instance references at stage completion. Browser hosts cannot promise core-dump protection.
- **R-MEM-4**. Keep stage output interpretation in upstream's parent. Treat values from rejected file data as untrusted.

### 4.8 System calls

- **R-SYS-1**. Expose only the supplied, read-only regular files under the call's virtual paths.
- **R-SYS-2**. Resolve `<sys/mman.h>` and omit unsupported `MADV_POPULATE_WRITE`.
- **R-SYS-3**. Supply a monotonic clock for diagnostics. Timing cannot affect a verdict.
- **R-SYS-4**. Shim `signal()` and `SIGCHLD`. Encode guest traps as abnormal child termination.
- **R-SYS-5**. Expose no ambient network, randomness or environment to the module.

### 4.9 Build

- **R-BLD-1**. Build from the pins with one command. Compare module bytes from two clean-root builds in CI.
- **R-BLD-2**. Match upstream build macros and `-O2` with C++17 and exceptions. Record hardening flag substitutions or omissions.
- **R-BLD-3**. Compute `VF_SOURCE_DIGEST` as upstream does and compare `build=`. Publish the separate port digest as `port=` in host diagnostics.
- **R-BLD-4**. Publish each release's module SHA-256 and both build locks.

### 4.10 Interfaces

- **R-API-1**. Node `fpv` preserves argument vectors, output streams and exit status within the host boundary.
- **R-API-2**. TypeScript `verify(files, args)` returns exit code, both output streams, parsed record and verdict. Browsers run verification in a worker.
- **R-API-3**. `checkAcceptance(result, expected)` evaluates the pinned caller acceptance rule with independently trusted facts.
- **R-API-4**. Declare the WASI Preview 1 import subset and freeze the `fpv_port` stage ABI at v1 by M2.

### 4.11 Performance

- **R-PERF-1**. Report protocol, runtime version, CPU, memory, fixture, raw samples and median of three after one warmup.
- **R-PERF-2**. Compare the native reference and Bend verifier against full-size whole calls in Wasmtime, Node, Chrome, Firefox and Safari on a common measurement machine.
- **R-PERF-3**. Require full-corpus equivalence before merging a speed change.

## 5. Conformance

The [corpus matrix and CI gates](docs/spec/07-testing-strategy.md#corpus-matrix) define C1 through C7. The [comparison RFC](docs/rfcs/RFC-0006-conformance.md#proposed-design) specifies which exit and output differences to report.

## 6. Port audit

The [platform inventory](docs/spec/01-architecture.md#port-audit) is normative. The build checks source dependencies against it.

## 7. Threat model

The [security contract](docs/spec/06-security.md#trust-boundaries) defines trust boundaries, failure evidence and disclosure.

## 8. Milestones

The [implementation tracker](docs/roadmap/IMPLEMENTATION.md) links the work and its dependencies.

| Stage | Release gate |
|---|---|
| M0 Ground | Build native reference in CI and run native C1. Verified bootstrap and source fetch already exist. |
| M1 One stage | Enforce the audit, pass C3, C4 and Wasmtime C1 part-calls, and record the table and memory ADRs. |
| M2 Whole call | Node passes C1, C2, C6, C7 and the 1,000-seed C5 gate. Freeze ABI v1. |
| M3 Browser | Publishable TypeScript package, worker, caller acceptance and a static offline fixture demo pass their gates. |
| M4 Speed | Measure the runtime matrix. Evaluate the threaded, SIMD and wide arithmetic candidates under equivalence gates. |
| M5 Release | Require reproducibility and differential CI, exercise a pin-update rehearsal, sign release artifacts and publish v1.0.0. |

## 9. Open questions

- [Floating-point parity](docs/rfcs/RFC-0002-numerical-parity.md#open-questions) and [per-stage memory](docs/rfcs/RFC-0005-failure-boundary.md#open-questions) are M1 measurement decisions.
- [Threaded candidate feasibility](docs/rfcs/RFC-0009-performance.md#open-questions) is an M4 measurement decision.

## 10. Changing this spec

Change requirements or their normative details in a dedicated pull request. A weaker requirement needs an ADR naming the lost guarantee and the evidence for the decision. No ADR can waive R-EQ-1. Keep requirement IDs stable and update affected tests and issue references together.
