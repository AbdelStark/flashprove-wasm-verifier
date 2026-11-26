# Guest ABI v1

The baseline guest uses wasm32, one unshared linear memory and the typed imports below. The build checks this table against the reviewed inventory and the linked module. Any change to a frozen tuple or its meaning requires an ABI version change. [Stage replay](../docs/rfcs/RFC-0004-stage-replay.md) · [Build audit](audit.json)

## Imports

| Qualified name | Wasm signature |
|---|---|
| `fpv_port.abi_version` | `()->(i32)` |
| `fpv_port.dup2` | `(i32,i32)->(i32)` |
| `fpv_port.fork` | `()->(i32)` |
| `fpv_port.pipe` | `(i32)->(i32)` |
| `fpv_port.waitpid` | `(i32,i32,i32)->(i32)` |
| `wasi_snapshot_preview1.args_get` | `(i32,i32)->(i32)` |
| `wasi_snapshot_preview1.args_sizes_get` | `(i32,i32)->(i32)` |
| `wasi_snapshot_preview1.clock_time_get` | `(i32,i64,i32)->(i32)` |
| `wasi_snapshot_preview1.environ_get` | `(i32,i32)->(i32)` |
| `wasi_snapshot_preview1.environ_sizes_get` | `(i32,i32)->(i32)` |
| `wasi_snapshot_preview1.fd_close` | `(i32)->(i32)` |
| `wasi_snapshot_preview1.fd_fdstat_get` | `(i32,i32)->(i32)` |
| `wasi_snapshot_preview1.fd_fdstat_set_flags` | `(i32,i32)->(i32)` |
| `wasi_snapshot_preview1.fd_filestat_get` | `(i32,i32)->(i32)` |
| `wasi_snapshot_preview1.fd_pread` | `(i32,i32,i32,i64,i32)->(i32)` |
| `wasi_snapshot_preview1.fd_prestat_dir_name` | `(i32,i32,i32)->(i32)` |
| `wasi_snapshot_preview1.fd_prestat_get` | `(i32,i32)->(i32)` |
| `wasi_snapshot_preview1.fd_read` | `(i32,i32,i32,i32)->(i32)` |
| `wasi_snapshot_preview1.fd_seek` | `(i32,i64,i32,i32)->(i32)` |
| `wasi_snapshot_preview1.fd_write` | `(i32,i32,i32,i32)->(i32)` |
| `wasi_snapshot_preview1.path_filestat_get` | `(i32,i32,i32,i32,i32)->(i32)` |
| `wasi_snapshot_preview1.path_open` | `(i32,i32,i32,i32,i32,i64,i64,i32,i32)->(i32)` |
| `wasi_snapshot_preview1.proc_exit` | `(i32)->()` |
| `wasi_snapshot_preview1.random_get` | `(i32,i32)->(i32)` |

## Values and layouts

Memory pointers are unsigned 32-bit byte offsets in the current instance. All memory values are little-endian. Range checks cover each whole span, including tables and out parameters. A pointer outside the current memory fails the call.

| Value | Memory layout |
|---|---|
| Argument sizes | Two separate `u32` outputs for argument count and bytes including NUL terminators. |
| Argument values | A table of `u32` pointers and UTF-8 bytes in argument order. Each argument ends with NUL. |
| Iovec | Eight bytes with a `u32` buffer pointer at offset 0 and a `u32` length at offset 4. |
| Read and write counts | One `u32` output. |
| Preopen record | Eight bytes. Directory tag at offset 0 and `u32` name length at offset 4. |
| Descriptor status | 24 bytes. Type at offset 0, `u16` flags at 2 and `u64` base and inheriting rights at 8 and 16. |
| File status | 64 bytes. Device and inode are zero, type is at offset 16, link count is one at 24 and size is at 32. Times are zero. The link count, size and times are `u64`. |
| Seek position and clock | One `u64` output. Seek takes a signed `i64` displacement. Positioned reads take a nonnegative offset within the signed `i64` range. |
| Open descriptor | One `u32` output. |
| Pipe descriptors | Two `u32` outputs in one eight-byte span. Read end first. |
| Wait word | One `u32` output. Normal termination uses `exitStatus << 8`. A host trap uses signal 6 and latches a host failure. |

WASI errors are positive Preview 1 errno values. The adapters use values including `ACCES=2`, `BADF=8`, `INVAL=28`, `IO=29`, `ISDIR=31`, `LOOP=32`, `MFILE=33`, `NOENT=44`, `NOTDIR=54`, `NOTSUP=58`, `SPIPE=70` and `NOTCAPABLE=76`. The stage shims convert negative errno returns from `fpv_port` to POSIX `-1` with `errno` set. An invalid pointer, unknown import, ABI mismatch or impossible process transition fails closed.

Clock ID 1 is monotonic. The clock output counts nanoseconds and the precision argument is a hint. Fork replay uses the original prefix clock values. The environment is empty, and `random_get` returns `NOTCAPABLE`. The guest has no network imports.

## Descriptors and stages

Each instance owns its descriptor table. Descriptor 0 is empty input, 1 and 2 are captured streams, and 3 is the read-only root preopen named `/`. Opens allocate the lowest free descriptor from 4 through 1,023. Regular files open at offset zero. Reads advance that descriptor by bytes returned, and positioned reads preserve its cursor. Path and descriptor rights control access.

`abi_version()` returns 1. The port checks that value before opening a stage pipe. A mismatch traps before the pipe import runs. The signal shim accepts `signal(SIGCHLD, SIG_DFL)`. Thread creation and stage replay follow the baseline rules in the [port audit](../docs/spec/01-architecture.md#port-audit).

The parent consumes each pipe in fork order as directed by upstream. A fork returns a positive pid in the parent and zero only at the matched replay target in a fresh child. Only the child's own pipe writer may be duplicated to stdout. Replay-prefix output is discarded. After the child finishes, the parent reads its pipe through EOF. `waitpid(pid, pointer, 0)` returns that pid and consumes its wait word once. The upstream parent interprets stage stdout and the wait word.

The runner invokes the `fpv_set_memory_limit(i32) -> i32` export once before `_start` in each serving instance. It returns zero after setting the cap. The `fpv_memory_failure() -> i32` export provides a marker after a runtime trap. Zero means no memory marker, one means a denied page limit and two means failed growth or allocation.
