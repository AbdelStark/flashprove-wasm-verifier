# Restricted Wasmtime I/O

The independent fixture adapter uses the Bytecode Alliance's Python embedding of Wasmtime. `make wasm-io-test` installs the wheel matching the Wasmtime pin in a local environment under `.toolchain/`. The [wheel hashes](requirements.txt) cover supported macOS and glibc Linux builds. The serving module and its TypeScript host have no Python runtime dependency.

The adapter binds WASI Preview 1 functions with the exact signatures in the [port audit](../../port/audit.json). It implements the following boundary for each instance.

| Surface | Guest contract |
|---|---|
| Arguments | Byte strings in their original order, with a little-endian pointer table and one NUL per argument. The adapter admits at most 4,096 arguments and 1 MiB of packed argument bytes. |
| Descriptors | 0 is EOF. 1 and 2 capture stdout and stderr. 3 is the virtual root. Each regular-file open has its own cursor. The table has 1,024 slots including the reserved descriptors. |
| Paths | A snapshot of explicitly supplied regular files and derived directories. Lookups resolve each component in order inside a directory capability. No operation accesses the host filesystem or follows a symlink. Paths are at most 4,096 bytes. |
| I/O | Read-only file rights. A vectored operation validates the result pointer, all spans and the aggregate length before using any bytes. The adapter admits at most 1,024 vectors per operation. The standalone I/O fixture has an 8 MiB output budget. |
| Environment and randomness | Empty environment. Random requests return a capability error without writing bytes. |
| Clock | `CLOCKID_MONOTONIC` returns nanoseconds. Other clocks return an unsupported-operation error. In `runStage` and `cpStagesRun`, the clock values feed progress and stage-duration text. |
| Exit | Capture the verifier's status. Invalid guest ranges and exhausted output raise a host fault. |

The tests use actual Wasm calls for bounds, overflow, denied capabilities, and descriptor lifetimes. They also run the serving module with two clock schedules and compare both streams and status for a plan and a table-digest refusal.
