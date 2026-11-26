# Stage imports

The M1 adapter implements the v1-shaped signatures from [RFC-0004](../docs/rfcs/RFC-0004-stage-replay.md#proposed-design). ABI freeze is an M2 gate.

| `fpv_port` import | Wasm signature | Result |
|---|---|---|
| `abi_version` | `() -> i32` | `1` |
| `pipe` | `(i32) -> i32` | `0`. Writes two little-endian descriptors. |
| `fork` | `() -> i32` | Positive pid in the parent, `0` after matching child replay. |
| `dup2` | `(i32, i32) -> i32` | The new descriptor. The adapter supports the child pipe redirect to stdout. |
| `waitpid` | `(i32, i32, i32) -> i32` | The requested pid. Writes one little-endian wait word. |

Negative returns carry WASI errno values. The guest shims translate them to POSIX `-1` and `errno`. WASI and stage calls share the same descriptor table. `waitpid` consumes one status for a known pid and flags zero. Normal termination uses `status << 8`. A trap produces signal 6 and marks the call failed. The signal shim accepts only `signal(SIGCHLD, SIG_DFL)`.

The independent adapter handles one fork per key or leaf call. It compares the argument, file-view and observation digests before entering the child branch. The prefix uses recorded time values. Child stdout enters the pipe after redirect, and the parent reads it through EOF. The parent keeps sole responsibility for interpreting stage status and stdout. The [audit](audit.json) checks the binary import signatures.

The runner calls the `fpv_set_memory_limit(i32) -> i32` export once per instance before `_start`. It returns zero after setting the page cap. The `fpv_memory_failure() -> i32` export describes a trap with zero for no memory marker, one for a denied page limit, or two for failed growth or allocation. The runner uses the marker only after a runtime trap.
