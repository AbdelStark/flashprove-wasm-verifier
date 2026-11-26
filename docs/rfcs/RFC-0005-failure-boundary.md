# RFC-0005: Enforce resource limits and fail closed

- Status: Accepted
- Authors: @AbdelStark
- Created: 2026-11-26
- Target milestone: M1, M2

## Summary

Supervise calls outside the guest, cap every retained allocation class and publish success only after confirming that no host error occurred.

## Motivation

A prefix of stdout or a stage status can look successful before a trap, a failed write or a memory limit. R-EQ-4 and R-MEM-2 require an unambiguous application result.

## Goals

- Produce exactly one terminal result per supervised call.
- Enforce documented memory and input limits on all execution paths.
- Preserve upstream normal refusal semantics on under-limit inputs.

## Non-Goals

- Guaranteeing delivery after process or page loss.
- Supporting secrets or promising deterministic wall time.

## Proposed Design

```text
admit -> snapshot -> run -> validate -> publish
any host fault before publish -> latch -> teardown -> publish refusal
```

The supervisor reserves a slot before copying files or starting a worker. Validate sizes without overflowing and cap both individual files and total retained input. Also account for argument bytes and path metadata within admission. A call has an output budget shared by guest stdout, stderr and unread child pipe bytes. Check a write before buffering it. On failure discard captured guest output. The guest has a declared maximum linear memory, enforced at instantiation and growth. A denied grow is fatal even if the guest could attempt to recover. Route guest growth through a checked trap-on-failure port path. If the runtime cannot observe failed growth, enforce it in the module and audit the resulting instruction sites. Treat allocation failure at the guest allocator boundary as fatal for nonzero allocations. Preserve zero-size and successful allocation semantics. Keep the latch outside the guest. A successful instance cannot clear it.

The elapsed-time supervisor runs separately from guest execution. It terminates the execution worker or interrupts the standalone runtime after a deadline. A fresh worker cannot inherit a previous call's state. Attach worker error and exit handlers before posting input. Validate completion messages before accepting them. Reject busy calls with the standard host result. In a user-visible CLI sink error return 15 and never report success. Use the upstream failure result for native guest exits. A detected host failure takes precedence over every guest exit and suppresses misleading partial output.

C7 runs both sides of each configured limit. It includes files one byte above the per-file limit, many files above the aggregate, output exhaustion, denied growth, worker disappearance, a near-deadline completion and a deadline that wins the race. Truncation under the cap is a native case. Resource accounting also bounds diagnostic capture, and labels memory types separately.

## Alternatives Considered

- Trust the final printed word. A host can lose the wait status or fail after the last buffered write.
- Use only a linear memory cap. Snapshot copies, pipes and concurrent calls use host resources.
- Retry a failed run automatically. It would change the evidence and obscure the observed fault.

## Drawbacks

- Healthy large calls can be refused when the configured budget is exceeded.
- Buffered output adds bounded memory and delays display until completion.

## Migration / Rollout

M1 establishes measured memory defaults and a bounded Wasmtime part runner. Use M2 C7 to verify defaults across the shared host and CLI. Carry the same terminal format into the browser worker.

## Testing Strategy

Measure native RSS per stage and guest linear memory on both full-size fixtures using isolated measurements. Exercise the request stage through its whole-call context even before product whole-call support. Test the parent and child memory maxima. Inject a failed grow after a pass-like line and a host trap beside a native rejection. Both must return exit 5 with a null record.

## Open Questions

- OPEN QUESTION: Does the full-size request stage fit with host margin under wasm32? The M1 limits owner resolves this at the M1 gate with per-stage data and a memory ADR. If any required runtime fails the envelope, keep the release gate closed while the ADR chooses memory64 or a narrower peak-memory patch and reruns parity.

## References

[Error model](../spec/04-error-model.md#host-failures) · [Resource envelope](../spec/08-performance-budget.md#resource-envelope) · [Failure requirements](../../SPEC.md#47-memory-and-hostile-inputs)
