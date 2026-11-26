# RFC-0007: Provide CLI, library and offline browser verification

- Status: Accepted
- Authors: @AbdelStark
- Created: 2026-11-26
- Target milestone: M2, M3

## Summary

Expose the same host core through the Node CLI and TypeScript library, with supervised worker execution in the browser and a static fixture demo.

## Motivation

A caller needs exact CLI behavior for scripting and a structured library result in browsers. R-API-1 and R-API-2 require both without duplicating the verification logic or blocking the page on guest execution.

## Goals

- Preserve native argument order and byte streams at the CLI.
- Verify from an immutable library byte map through a strict API.
- Complete published fixture checks offline after the demo assets have been loaded from a trusted bundle.

## Non-Goals

- Adding CLI-only verifier flags or using a proof-dependent remote service.
- Distributing a self-contained HTML edition or shipping the fixtures in the package.

## Proposed Design

Use the [public signatures and CLI forms](../spec/02-public-api.md). The Node CLI binds OS paths to the host capabilities in RFC-0003 and waits for the supervised result. Buffer stdout and stderr separately, write unchanged bytes at completion and set the final exit code only after delivery has settled. If a sink fails, use exit 15. Node library and browser entry points use the in-memory map. Choose exports statically for the runtime rather than probing the browser's globals during import. Use the same result decoder for both.

```ts
type WorkerRequestV1 = Readonly<{
  schema: 1; requestId: number; args: readonly string[];
  files: readonly [path: string, buffer: ArrayBuffer][];
}>;
type WorkerReplyV1 = Readonly<{
  schema: 1; requestId: number; result: VerifyResult;
  evidence?: CompletedCallEvidenceV1;
}>;
```

CompletedCallEvidenceV1 carries the validated module hash, call mode, argument facts and consumed request/token digests specified in RFC-0008. Only the trusted worker can supply it. The supervisor sends only copies in the transfer list. It checks schema, request ID and terminal result consistency. Within one supervisor only one call runs by default. The caller's original buffers stay attached. The worker uses the baseline module, validates its hash against release metadata, and instantiates one parent and fresh children. The supervisor owns deadline enforcement and settles the promise exactly once. Discard late messages after teardown. Do not parse stage stdout for an acceptance decision.

The offline demo is an ordinary static bundle containing module, worker, manifest and preloaded or locally selected verified public examples. Generate fixture assets from the pinned source and keep them out of source control. Display verdict, coverage and caller-acceptance outcome separately, with explicit fixture provenance. The loaded bundle runs with network disabled. For local files, document the supported static serving path when browsers restrict workers on file URLs. Keyboard users can select a fixture, trigger verification and reach the result. Expose pending and terminal state to assistive technology.

## Alternatives Considered

- Run guest on the main browser thread. Full-size calls would block the page and prevent independent supervision.
- Offer a CLI JSON mode as the primary interface. That would add a parsing contract to the native-compatible CLI.
- Bundle a single HTML file. Module, worker and manifest can be cached, authenticated and replaced separately in the static bundle.

## Drawbacks

- Workers and transferable snapshots add setup cost.
- Offline verification requires the module, worker and fixture assets to be available locally.

## Migration / Rollout

M2 delivers the CLI and shared host. M3 delivers package exports, worker, structured results and offline demo. Declare stable compatibility at M5 after installing from the packaged archive on supported runtimes.

## Testing Strategy

Compare CLI pipe output bytes and exit codes for successful, malformed and missing-file calls. Interrupt output delivery. Send the browser worker a wrong request ID and kill it before completion. Confirm copied caller buffers stay attached. Verify an official fixture offline, alter the module bytes and assert an integrity refusal. Compile a strict TypeScript consumer against the packed declarations.

## Open Questions

None. The first stable distribution includes the package and the static bundle.

## References

[API](../spec/02-public-api.md) · [Result schema](../spec/03-data-model.md#call-result) · [Release scope](../spec/00-overview.md#release-scope)
