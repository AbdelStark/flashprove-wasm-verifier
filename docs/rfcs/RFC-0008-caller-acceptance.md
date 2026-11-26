# RFC-0008: Check caller acceptance against independent expectations

- Status: Accepted
- Authors: @AbdelStark
- Created: 2026-11-26
- Target milestone: M3

## Summary

Evaluate the pinned upstream acceptance rule against a completed whole-call result and facts the caller already holds. Each missed condition yields a named failure.

## Motivation

A valid proof can belong to another commitment or a shorter response, or use work assumptions the caller rejects. R-API-3 requires the helper to distinguish a verification verdict from the caller's acceptance decision.

## Goals

- Cover all eight upstream acceptance points through explicit inputs or checked observations.
- Reject forged, partial, wrong-build and wrong-policy records.
- Check request and token bytes used by the call against caller-held bytes.

## Non-Goals

- Establishing social trust or the source of a caller's prior ID.
- Verifying newly supplied raw stdout or accepting a part-call.

## Proposed Design

```ts
type AcceptanceRule = "verifier" | "files" | "id" | "verdict"
  | "coverage" | "work" | "commitment" | "completion";
type AcceptanceExpectations = Readonly<{
  verifier: Readonly<{moduleSha256: Sha256; build: Sha256}>;
  files: Readonly<{request: Uint8Array; token: Uint8Array}>;
  id: Sha256;
  coverage: Readonly<{r: number; e: number; T: number; requireY: boolean}>;
  policy:
    | Readonly<{kind: "exact-match"}>
    | Readonly<{kind: "clipped-gap"; C: string; theta: string; cap: string; s: string; sh: "8"}>;
  allowProofOfWork: boolean;
  acceptTheoremOnCodes: boolean;
  completion: {kind: "partial"} | {kind: "complete"; endTokenIds: readonly number[]};
}>;
type AcceptanceDecision =
  | Readonly<{accepted: true}>
  | Readonly<{accepted: false; failed: readonly AcceptanceRule[]}>;
```

The caller supplies expectations from an independent record. It asserts trust in the module, provenance and prior timing of the ID, and construction of the request/token files and the values the application actually uses. The helper cannot observe those actions.

Keep private evidence keyed to the exact `VerifyResult` object created by `verify`. Evidence includes the verified module hash, call mode, argument facts, hashes of the consumed request and token byte ranges, and the validated terminal record and lines. Worker replies produce this evidence only after protocol validation. Store it separately from mutable returned byte arrays. An externally assembled result, transferred object or result from another package instance has no evidence and fails `verifier`. Reject ill-typed runtime expectations.

| Upstream point | Check |
|---|---|
| verifier | Authentic local evidence, trusted module hash and matching `build` |
| files | SHA-256 equality of both consumed files and the caller's copies. Validate bindings against expected T, r, e and y. |
| id | Supplied `-id`, canonical 64-hex equality and equal printed ID |
| verdict | Whole call, exit and record status 0, no host fault or `-bits`, and exact appropriate final line. A clipped-gap y-only call expects `YES`. |
| coverage | Check `r,e,T`, range `r+1..min(e,T-1)` or `none`, y, claim and policy. Require `sh=8`, `sT=4`, `F=24` and `dw=8`. For clipped gap compare all five named policy values and matching suffix. |
| work | Require the work line and consistency with the recorded work fields. If disallowed require `proof of work: none counted`, `work=0` and `work-rounds=0`. |
| commitment | Require the exact pinned theorem statement in the commitment line, `record=1`, and caller approval of that assumption. Check the round count against the record. |
| completion | When complete is requested, derive checked reply tokens from caller bytes and checked y from the token file. Exactly the last checked token is an end token. |

Check consistency between `covered:` and the record, with only the pinned native framing. For exact match the fixed `C`, `theta` and `cap` do not require caller-supplied values. Never treat printed work estimates as proof of a security level. Return failed rule names in the table's order and handle dependent checks without guessing missing data.

## Alternatives Considered

- Accept exit zero and a final `YES`. A valid but unrelated or incomplete proof could pass.
- Accept caller-supplied output text as evidence. A provider could generate a transcript without running this verifier.
- Re-run the verification against expectations. That doubles cost and would still require provenance for the expectations.

## Drawbacks

- Callers must keep trusted bytes and policy expectations.
- Verified result objects are local to the package instance. Serialize evidence reports separately from the acceptance input.

## Migration / Rollout

Introduce this helper with the M3 library. Document the pinned upstream acceptance rule and publish examples for exact match and clipped gap.

## Testing Strategy

Use the upstream exact-match and clipped-gap examples, plus y-only coverage. Vary one trusted fact at a time: ID, bytes, range, work, theorem approval, policy, final token, module and build. Reject fabricated results, bad status, missing or duplicate terminal record, and a native `-bits` pass-like result. Mutating exposed buffers must not change the private decision.

## Open Questions

None. The caller remains responsible for facts that cannot be inferred from a verifier run.

## References

[Upstream acceptance rule](https://github.com/anthropics/FlashProve/blob/9e2bdd8ff5bf9c62f18263d7dac189b0400b260c/docs/verifying.md#when-to-accept) · [Acceptance API](../spec/02-public-api.md#acceptance-interface) · [Trust boundaries](../spec/06-security.md#trust-boundaries)
