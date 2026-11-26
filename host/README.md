# host

The [independent Wasmtime adapter](wasmtime/README.md) implements the restricted I/O contract for M1 fixtures.

The TypeScript namespace snapshots caller-owned bytes and the complete guest argument vector synchronously. It derives read-only directories from canonical file paths. The Preview 1 adapter gives each instance its own bounded descriptor table, offsets and captured streams. `make test` type-checks the host on Node 24 and checks the audited imports, path and descriptor behavior, and mutation after admission.

The CLI acquisition adapter admits explicit file operands and the allowed configuration and public-key descendants on first guest access. It anchors files and directories on Linux x64 and arm64 with procfs. `make scoped-disk-test` checks native read order with the pinned guest and oracle on x86_64 Linux. [Disk capability decision](../docs/adr/0007-cli-disk-capabilities.md)

The Node runner starts a fresh WebAssembly instance for the parent and each serial child. It checks ordered argument, file and descriptor observations before entering a child branch, then delivers pipe bytes and wait words to the upstream parent. `make replay-test` exercises the transport and compares all published whole calls against the pinned native verifier on x86_64 Linux.

Two front ends share it:

- `fpv`, a Node command with `cp_verify`'s arguments, output and exit codes (R-API-1)
- `verify(files, args)` for browsers and servers, run in a Web Worker in the browser (R-API-2), with `checkAcceptance()` beside it (R-API-3)
