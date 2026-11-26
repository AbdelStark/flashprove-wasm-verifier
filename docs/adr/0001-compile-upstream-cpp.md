# 0001. Compile upstream's C++, do not rewrite it

Status: accepted, 2026-11-26

## Context

`cp_verify` is about 13,000 lines of C++17 in `verifier/` plus shared headers in `blocks/`. Every line on the verification path is soundness-relevant. A rewrite in Rust, TypeScript or AssemblyScript would be a second verifier, with its own bugs, needing its own conformance work. The Bend verifier shows what that takes.

## Decision

Compile the pinned upstream sources to WebAssembly with clang. Put every platform difference in `port/`. Patch upstream code only when no shim works, one concern per patch, each with an ADR.

## Consequences

- The wasm verifier is the native verifier's code, compiled for another target. Its `build=` line can equal the native one (R-BLD-3), which shows both came from the same sources.
- Risks move from "is the port right" to "does the compiler, the libc and the host behave the same". Differential testing against the native reference covers them (SPEC § 5, § 7).
- Upstream bumps are cheap when the audit holds: refetch, rebuild, rerun.
- Speed is bounded by what clang makes of upstream's code for WebAssembly. Speed work happens in flags, shims and runtime features before it touches upstream code.
