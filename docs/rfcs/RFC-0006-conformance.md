# RFC-0006: Compare native and guest calls with replayable evidence

- Status: Accepted
- Authors: @AbdelStark
- Created: 2026-11-26
- Target milestone: M1, M2, M5

## Summary

Run checksum-checked fixtures and seeded mutations through both executions. Classify safety and equality independently, and keep minimal fixture-derived regressions.

## Motivation

Runtime-specific errors can preserve a rejection while changing a name, or turn a rejected input into a pass. R-EQ-1 through R-EQ-3 need distinct comparison rules and reproducible diagnostics.

## Goals

- Run the C1 to C7 matrix with per-case provenance.
- Detect any native/guest pass verdict mismatch before evaluating allowlisted timing fields.
- Reproduce a seed with the same bytes, arguments and fixture pin.

## Non-Goals

- Using corpus coverage as a proof of verifier soundness.
- Storing proof files or generated binary cases in Git.

## Proposed Design

```text
CaseV1 = {schema: 1, id, corpus, fixtureId, argv, operations: OperationV1[]}
OperationV1 = {target: fixtureRelativePath, kind: flip|truncate|append,
  offset: u64, value?: u8}
compare(native: RunResult, guest: RunResult, case: CaseV1) -> CaseResultV1
```

Use a per-case working directory under `build/`, the pinned fixture bytes and the same logical relative argv for both runners. No expected result is rewritten to fit the guest. A passing terminal classification must match the native final verdict byte for byte, including suffix. Compare exits and the final verdict for all modes. For whole calls at 0 and 14 compare the final four stdout lines byte for byte. For part and rejection cases compare the pinned closing status and rejection name, also comparing the part's closing output where upstream defines it. For plans compare both full streams. C1 keeps expected upstream example outcomes as an oracle sanity check. A wrong or unavailable oracle run invalidates evidence.

`conformance/excluded-fields.txt` lists any timing and thread-count fields by anchored location and reason. The comparator rejects an entry targeting acceptance or unmatched fields. An empty file means exact comparisons. Classify a host refusal as a failure category and keep its equality difference visible. C7 fault injections assert exit 5 and exact host output rather than demanding native equality where no native input represents the injected fault. R-EQ-2 deviations need an ADR naming the input boundary and exact comparison impact.

C2 uses the upstream mutation tables and their checked generation semantics in temporary directories. Never discard rows just because a guest run differs. C5 uses a fixed documented PRNG, explicit integer widths and case seed index, independent of execution order. Seed-to-case mapping selects an input class then a registered fixture and deterministic mutation. Use a mix of single-bit changes, truncation and append operations, with coverage counts per class. Preserve both original and minimized operation lists when failures are triaged. A minimized case must still reproduce the same comparison failure against both pins. Confirm discoveries privately when they could affect acceptance.

Enforce the C3 and C4 prerequisite gate before whole-call comparisons. Shard by stable case ID or seed range. Merging shards rejects duplicate or missing IDs and pin disagreement. Produce a `ConformanceReportV1` and concise CI counts. Runtime caps and errors stay visible in the record. Unknown errors fail the gate.

## Alternatives Considered

- Compare only final exit. Exit 0 covers two verification verdicts and omits coverage and policy.
- Store checked output snapshots. Those snapshots would displace the actual reference.
- Seed a global RNG shared across workers. Sequence depends on scheduling and shard count.

## Drawbacks

- Whole-call differential runs are slower than guest-only tests.
- The corpus is bounded to available fixtures, mutations and test schedules.

## Migration / Rollout

M1 introduces the comparator and part-calls. M2 adds whole calls, argument cases, seeded fuzz and permanent regressions. M5 requires the differential jobs and preserves evidence alongside release artifacts.

## Testing Strategy

Demonstrate that an altered policy suffix is a safety failure, a changed accounting field is an equality difference, and a changed allowed wall-time field is ignored only at its anchored position. Check identical seed cases with one and several workers. Run all C2 rows, C6 precedence cases and `make fuzz SEEDS=1000`. Test missing shard detection and a duplicate seed index.

## Open Questions

None. Seed and mutation versions enter the report schema when the runner lands.

## References

[Corpus matrix](../spec/07-testing-strategy.md#corpus-matrix) · [Equivalence requirements](../../SPEC.md#41-equivalence) · [Artifact schemas](../spec/03-data-model.md#artifact-versions)
