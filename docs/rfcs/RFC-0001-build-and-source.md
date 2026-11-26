# RFC-0001: Build the pinned verifier and audit the port

- Status: Accepted
- Authors: @AbdelStark
- Created: 2026-11-26
- Target milestone: M0, M1

## Summary

Build the native oracle through the pinned upstream script and build the guest from the same verified source tree. Audit platform differences at both the source and binary boundaries.

## Motivation

A toolchain change can alter a check without changing the verifier's source. R-SRC-1 through R-SRC-3 and R-BLD-1 through R-BLD-3 require provenance and a reviewable boundary.

## Goals

- Build the x86_64 Linux oracle without writing to the upstream checkout.
- Emit the same upstream source digest for the reference and guest.
- Fail on dependency or import drift before running the guest.

## Non-Goals

- Reimplementing verifier algorithms or changing default compiler optimizations.
- Establishing bit reproducibility across compiler versions or target architectures.

## Proposed Design

`make reference` invokes pinned `verifier/build.sh - <absolute-build-dir>` with g++ on x86_64 Linux and installs `build/native/cp_verify`. A failed build leaves no new executable eligible for conformance. Record exit, source digest, compiler and libc versions. Run the four published example calls and their documented alternate forms at this milestone. Run native output as the oracle in later differential jobs.

`make build` selects the pinned compiler and sysroot. Compile `verifier/src/cp_verify.cpp` with C++17, exceptions, `-O2`, strict floating point and macros `BLK_FIELD=2`, `DIGEST_WORDS=8`, `SERVING_BUILD=1`, `BLK_COUNT_HASH_CALLS=1`. Place `port/include/` ahead of system headers. Start with compatible hardening, including supported library bounds checks, and inventory each native flag considered. Document substitutions and omissions by native flag and wasm rationale. Thread and mutex shims implement R-THR-1. Build to a temporary output and install `build/wasm/cp_verify.wasm` only on clean audit.

For `VF_SOURCE_DIGEST`, hash the bytes of the upstream script's `sha256sum` stream under `LC_ALL=C`: the verifier source glob, plan-round headers, hiding token-plan header and sorted non-test block headers. Preserve upstream path spelling and grouping. Compute a separate port SHA-256 over a path-sorted framed list of port, host ABI and build configuration inputs. Each entry is a UTF-8 relative path and its file hash, with explicit length framing. Print `port=<digest>` through diagnostics. A patch, if necessary, applies to a copy under `build/` and is represented in the port digest. Compute the upstream digest from the untouched tree.

Maintain a checked inventory of dependency files, platform headers and symbols and final imports. Snapshot compiler-generated dependency paths, port source dependency classifications and module import tuples `(module, field, type)`. Fail on an unknown platform dependency and require human classification of changed preprocessor branches or transitive inputs on a pin change. Fail on test-only flags in the serving build. The audit records a disposition per row and a test that checks it.

## Alternatives Considered

- Rewrite in another language for portability. That would introduce a second verifier and sever source parity.
- Use runtime-specific glue from a browser-first compiler. It would add a second ABI where the stage protocol needs a small controlled boundary.
- Audit module imports alone. Headers, inline code and statically linked math can change without adding imports.

## Drawbacks

- Native CI requires a separate Linux machine or runner.
- A platform dependency review is still needed when upstream code changes its call path.

## Migration / Rollout

Land the oracle and native C1 in M0. Add the guest and fail-closed audit in M1. Keep release eligibility off until the clean-build gate in RFC-0010.

## Testing Strategy

Verify a mismatched pin and dirty source fail before compilation. Build the oracle via the upstream script, compare its digest with a guest source digest, and make the audit reject one new import and one unaudited dependency. Run baseline worker fallback with `-j 1` and `-j 256`. Verify that `make reference` cannot modify the pinned tree.

## Open Questions

None. The audit records the resolved binary imports for the exact pinned build.

## References

[Requirements](../../SPEC.md#42-source) · [Build flags](../../SPEC.md#49-build) · [Platform audit](../spec/01-architecture.md#port-audit) · [Source ADR](../adr/0001-compile-upstream-cpp.md) · [Target ADR](../adr/0002-wasi-sdk-target.md)
