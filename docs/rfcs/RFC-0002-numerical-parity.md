# RFC-0002: Establish numeric parity before running proofs

- Status: Accepted
- Authors: @AbdelStark
- Created: 2026-11-26
- Target milestone: M1

## Summary

Use the native oracle for field and table values. Keep the upstream digest checks running and the baseline floating-point compilation strict.

## Motivation

The pinned verifier's four public tables bind generated numerical values. A change in the last bit of a library result can move a quantized table entry. Field arithmetic uses wide unsigned integers with a different lowering in wasm.

## Goals

- Match all upstream field and hash known answers.
- Compare every table entry for all four published parameter files.
- Report the first differing table, index, inputs and values.

## Non-Goals

- Approximating verification tolerances or retraining a model.
- General portability claims about the math library beyond the evidence.

## Proposed Design

Baseline uses compiler-rt for `unsigned __int128` arithmetic modulo `2^64 - 2^32 + 1`. Link exact upstream field implementations and hash tests into test-only programs. Compile the native and guest dump probes against the same constructors, with the same relevant flags as their serving builds. Keep probes out of the release artifact. Record field and digest words at full width.

```text
TableDumpV1 = {schema: 1, policySha256, table: silu|sigmoid|rope|exp,
  dimensions: u32[], elementBytes: u32, elements: hex[]}
```

Dump elements in constructor iteration order with fixed-width little-endian encodings. If an element is floating point, serialize its bit representation. Compare shape, length, exact bytes and final digest. When a mismatch appears, capture constructor parameters and input bit patterns. A replacement library must match the reference over the full input set relevant to the table construction, with evidence identifying the covered variants. If that cannot be established, a narrow patch needs its own ADR. Keep unsupported parameter combinations fail-closed if parity is unproven and the mitigation would otherwise create a risk of acceptance. Document the equality impact. Keep the original in-program table digest checks and never ship a dump as a table input.

Use no fast-math, floating-point contraction or relaxed SIMD. Audit the flags and generated instruction set. Displayed work and accounting fields remain within the exact output contract even though the four-table test does not cover their arithmetic. C1 and C6 exercise the closing-line formatting.

## Alternatives Considered

- Allow one-unit tolerances. Table digests and R-EQ-2 require exact answers.
- Store native table dumps. Tables would stop being independently constructed for each policy and add a second input format.
- Use JS numbers for the field. Its full 64-bit width and products cannot be represented exactly.

## Drawbacks

- Probe builds add CI work.
- Fixing a library discrepancy may require provenance and licensing review.

## Migration / Rollout

Run C3 and C4 before enabling the whole-call suite. Land the numerical ADR even when no change to the math routines is needed.

## Testing Strategy

Run upstream Goldilocks vectors and exact hash answers, including high operands and carry boundaries. Dump each table for each C1 policy. Show that one changed entry produces an index and a failed gate. Run the serving module against C1 and verify that the table digest checks are present and still reject mismatched inputs.

## Open Questions

- The M1 table comparison and math decision are recorded in [ADR 0005](../adr/0005-public-table-parity.md).

## References

[Integer requirements](../../SPEC.md#46-integers) · [Floating-point requirements](../../SPEC.md#45-floating-point) · [Corpus matrix](../spec/07-testing-strategy.md#corpus-matrix)
