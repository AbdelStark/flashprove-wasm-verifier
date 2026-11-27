# host

The [independent Wasmtime adapter](wasmtime/README.md) implements the restricted I/O contract for M1 fixtures.

The TypeScript namespace snapshots caller-owned bytes and the complete guest argument vector synchronously. It derives read-only directories from canonical file paths. The Preview 1 adapter gives each instance its own bounded descriptor table, offsets and captured streams. `make test` type-checks the host on Node 24 and checks the audited imports, path and descriptor behavior, and mutation after admission.

The CLI acquisition adapter admits explicit file operands and the allowed configuration and public-key descendants on first guest access. It anchors files and directories on Linux x64 and arm64 with procfs. `make scoped-disk-test` checks native read order with the pinned guest and oracle on x86_64 Linux. [Disk capability decision](../docs/adr/0007-cli-disk-capabilities.md)

The Node runner starts a fresh WebAssembly instance for the parent and each serial child. It checks ordered argument, file and descriptor observations before entering a child branch, then delivers pipe bytes and wait words to the upstream parent. `make replay-test` exercises the transport and compares all published whole calls against the pinned native verifier on x86_64 Linux.

The Node supervisor runs the guest in a fresh worker and owns the 600-second deadline on the calling thread. It checks the versioned reply and waits for clean worker exit before releasing a completed result. A timeout or delivery failure discards any proposed result. After a timeout the admission slot stays held until the worker stops. [Node worker event order](https://nodejs.org/docs/latest-v24.x/api/worker_threads.html#event-message-1)

Pass a `diagnostics` callback in the supervisor options to receive bounded provenance, timing, lifecycle and failure records. The callback receives records after the terminal decision. Guest output remains available through the original byte streams. [Diagnostics schema](../docs/spec/05-observability.md#runtime-diagnostics)

Run `make cli` to build the local `./bin/fpv` command. `make replay-test` invokes that executable against the pinned native oracle. `make scoped-disk-test` checks byte delivery, broken pipes and module integrity. [CLI contract](../docs/spec/02-public-api.md#cli)

`verify(files, args)` in `host/verify.ts` is the Node library entry (R-API-2). It copies the map and arguments before its first await, moves the copies to a fresh worker and leaves the caller's buffers attached. Paths are canonical absolute virtual paths; relative arguments resolve from `/`. The promise always resolves to a `VerifyResult` with both raw streams, LF-split text lines, the verdict that the exit code and last line agree on, and a lossless `result-v1` record. `host/result.ts` decodes that record only from the four closing lines of a whole call at exit 0 or 14, with the pinned field order and forms, the request range and the verdict in agreement. A whole call that claims exit 0 or 14 without such a record latches `host-internal` before anything is published. `make test` checks the decoder and a strict consumer compiled against the emitted declarations. `make verify-test` compares `verify()` with native on published calls. [Result schema](../docs/spec/03-data-model.md#call-result)

`checkAcceptance()` (R-API-3) and the browser worker come next, on the same decoder.
