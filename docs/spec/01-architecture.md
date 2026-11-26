# Architecture

## Boundaries and call flow

| Owner | Boundary | Responsibility |
|---|---|---|
| `scripts/`, `Makefile` | `make bootstrap upstream reference build` | Verify pins, produce native reference and guest module |
| `port/`, `patches/` | WASI Preview 1 plus `fpv_port` v1 | Build flags, platform shims and reviewed patches |
| `host/` | `verify(files, args)` and internal runtime adapters | Freeze input, cap resources, run parent and stages, deliver streams |
| CLI and worker entry points | OS argument vector and worker messages | Acquire explicit input, supervise runs and publish one terminal result |
| Acceptance | `checkAcceptance(result, expected)` | Check the caller's facts against the completed call |
| `conformance/` | corpus case and report v1 | Run pinned native and guest, compare exact output, record provenance |
| Release pipeline | release manifest v1 | Rebuild, package, attest and publish |

The entry point supervises a call. The host owns the call's byte snapshot and per-instance imports. The parent guest runs upstream argument parsing and dispatch. At a fork, the host starts a fresh child guest, checks replay, carries its stdout through the parent pipe and returns its termination status. Upstream merges the results. The host publishes a completed result only after the parent has ended and host failures have been checked. Acceptance runs separately and needs trusted expectations. [Stage ABI](../rfcs/RFC-0004-stage-replay.md#proposed-design)

Baseline children run serially. Calls share only the validated compiled module, never a live instance, descriptor table or mutable input buffer. Browser and Node supervisors reserve a bounded call slot before snapshotting, with one active call per supervisor by default. CLI has one call per process. A busy call resolves with a host refusal.

## Port audit

Build checks track the transitive compilation inputs, platform dependencies and linked module imports. Audit rows identify the location, disposition and check. A change to the upstream pin reruns this inventory.

| Dependency | Upstream site | Disposition and check |
|---|---|---|
| `fork`, `pipe`, `dup2`, `read`, `close`, `waitpid`, `exit`, `_exit` | `cpStagesRun` in `cp_verify.cpp` | [Port ABI](../../port/ABI.md) and WASI process exit. The Wasmtime transport tests assert pid, descriptor, replay and termination behavior. |
| `std::thread`, `std::mutex`, atomics | `parFor` and parent reader threads | The `pthread_create`, `pthread_mutex_lock` and `pthread_mutex_unlock` shims select the upstream single-thread fallback. The Wasm build probe exercises both sites. Real shared atomics only on the threaded candidate. |
| `prctl`, `PR_SET_DUMPABLE` | `main` on Linux | Excluded by the platform guard. Public-only host contract. |
| `madvise`, `sysconf`, `<sys/mman.h>` | `makePagesResident` in `vf_common.h` | Resolve the header. Keep `MADV_POPULATE_WRITE` undefined. |
| `stat`, `fstat`, `fopen`, `fcntl(F_GETFD)` | `vf_common.h` file access and `main` | Read-only namespace and descriptor status shim. |
| `fseeko`, `ftello`, `off_t`, `PTRDIFF_MAX` | `readWords` in `vf_common.h` | Use wasi-libc's 64-bit offsets. Reject lengths beyond the guest buffer range before resizing. The Wasm build probe tests both representable and oversized lengths. [ADR 0004](../adr/0004-wasm32-file-offsets.md) |
| `<sys/resource.h>` | `cp_verify.cpp` | Unused on WASI. The port supplies an empty header. The pinned build checks this assumption. |
| `signal`, `SIGCHLD` | `cpStagesRun` | Checked shim only for the observed default disposition. |
| `exp`, `sin`, `cos`, `pow`, `round`, `nearbyint`, `ldexp` | verifier tables and shape helpers | Entry-by-entry parity and strict compiler flags. Audit actual link symbols. |
| `unsigned __int128`, compiler runtime helpers | `blocks/base.h`, `vf_common.h`, `vf_smallness_packing.h` | compiler-rt and field vectors. |
| `steady_clock` | `now()` in `vf_common.h` | Monotonic time only. Source review verifies that values have no decision use. |
| WASI arguments, environment and startup randomness | wasi-libc startup and stack protector | Pass the supplied argument vector, an empty environment and no ambient randomness. The typed import inventory and host tests cover these calls. |
| WASI descriptor and path calls | wasi-libc stdio, file metadata and input reads | Supply read-only virtual files and bounded output. The [restricted adapter contract](../../host/wasmtime/README.md) and `make wasm-io-test` cover layout, denied capabilities and pointer checks. |
| WASI process exit | wasi-libc termination | The host captures status and preserves the failure boundary. |

The build checks every resolved dependency and the actual ABI subset against the reviewed [port inventory](../../port/audit.json). [Build evidence](../rfcs/RFC-0001-build-and-source.md#testing-strategy)
