# RFC-0004: Replay each verifier stage in fresh memory

- Status: Accepted
- Authors: @AbdelStark
- Created: 2026-11-26
- Target milestone: M1, M2

## Summary

Implement the small process surface used by `cpStagesRun` with fresh instances and a deterministic replay of the parent's pre-fork observations. Leave merging to upstream.

## Motivation

The native stage entry writes file-scope state and can exit through a refusal. Reusing an instance would share state that native fork isolates. The upstream stage-transport contract couples output and termination.

## Goals

- Replay key and leaf part-calls in Wasmtime and whole calls in the product host.
- Detect divergent fork observations before entering the child path.
- Freeze the checked v1 import and termination contracts by M2.

## Non-Goals

- General process creation, arbitrary nested fork or shared live stage memory.
- A replacement for the upstream stage-output parser.

## Proposed Design

`fpv_port` uses checked i32 WebAssembly arguments. Stable v1 signatures follow. The C shims own translation to POSIX conventions and `errno`. Negative port returns encode errno. All memory outputs are little-endian in guest memory.

```text
abi_version() -> i32                          # 1
pipe(outFds: i32) -> i32                      # two 32-bit descriptors
fork() -> i32                                 # parent pid > 0, child 0
dup2(oldFd: i32, newFd: i32) -> i32           # newFd or negative errno
waitpid(pid: i32, statusOut: i32, flags: i32) -> i32
```

Port descriptors live in the same instance table as the WASI descriptor subset. `fd_read`, `fd_write` and `fd_close` service pipes and inherited descriptors. The shim only supports the SIGCHLD default disposition and waiting for a known positive pid with flags zero. A normal exit encodes `status << 8`. A trap receives signal 6 in the wait word and also latches a host fault. Invalid pointers, unexpected flags or impossible sequencing fail closed. The audit records exact imports, WASI call layouts and ownership in `port/ABI.md`.

Number forks from zero. Parent `fork()` seals its replay record and starts a fresh instance with the same immutable namespace and argv. For earlier ordinals the replay child receives the already issued parent pids and reproduces the descriptor operations without launching any extra stages. At the target ordinal compare digest and ordinal, then return zero. A replay that reaches another termination or asks for a new file or parent event fails the call. Fresh stdout and stderr sinks discard replay-prefix output. After the target fork, child stdout enters the pipe once upstream calls `dup2`. Keep child stderr for the call according to guest stream routing. The host releases the child instance after exit and retains only its bounded pipe bytes and status. The parent reads partial chunks through EOF and consumes status once.

```text
ForkRecordV1 = {ordinal: u32, argvDigest: sha256, fileViewDigest: sha256,
  observationDigest: sha256}
```

Hash ordered, typed length-prefixed fields in UTF-8 and fixed-width little-endian integers. The file view includes identity, exact bytes and errors observed before the fork. The observation stream includes file operations, replies, offsets, fd/pid transitions and returned byte ranges. Replay time uses recorded values where an earlier read must be replayed. Audit that elapsed time and addresses do not affect the stage path. The digest witnesses observed inputs and order. Source review still establishes determinism up to that fork.

If a child traps, a port limit fires or replay diverges, retain a terminal host failure even if the native parent prints a different ending. The baseline schedules one child at a time and drops child references before advancing the parent. Wasmtime part-call and benchmark adapters follow the same ABI.

## Alternatives Considered

- Export stages and reimplement dispatch in TypeScript. This would duplicate argument checking and merge behavior.
- Snapshot guest memory and registers at fork. Stack, runtime and host state would need a runtime-specific checkpoint contract.
- Replay only argv. That misses a changed file, failed open or different observation order.

## Drawbacks

- Prefix parsing and hashing run again for each child.
- Each host has to preserve the descriptor and replay ABI exactly.

## Migration / Rollout

Land part-call replay in the M1 Wasmtime adapter. Add multi-fork Node replay and ABI conformance in M2. Changing the frozen contract requires a separate ABI version and compatibility tests.

## Testing Strategy

Test parent and child fd rules, short reads, EOF, close, wrong pid, exited and signaled wait words, replay suppression and two earlier fork ordinals. Reject one changed event and one altered file before a child branch. Use both native part-calls, then C1 whole calls with and without stage output. Inject a host trap alongside a native rejection and assert a single host refusal.

## Open Questions

None. The full binary import inventory is recorded in the ABI document at M2.

## References

[Stage requirements](../../SPEC.md#43-stages-and-isolation) · [Replay ADR](../adr/0003-stage-instances-fork-by-replay.md) · [Failure handling](RFC-0005-failure-boundary.md#proposed-design)
