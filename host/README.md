# host

The [independent Wasmtime adapter](wasmtime/README.md) implements the restricted I/O contract for M1 fixtures.

The TypeScript namespace snapshots caller-owned bytes and the complete guest argument vector synchronously. It derives read-only directories from canonical file paths. The Preview 1 adapter gives each instance its own bounded descriptor table, offsets and captured streams. `make test` type-checks the host on Node 24 and checks the audited imports, path and descriptor behavior, and mutation after admission.

The CLI acquisition adapter admits explicit file operands and the allowed configuration and public-key descendants on first guest access. It anchors files and directories on Linux x64 and arm64 with procfs. `make scoped-disk-test` checks native read order with the pinned guest and oracle on x86_64 Linux. [Disk capability decision](../docs/adr/0007-cli-disk-capabilities.md)

The TypeScript host (M2): it loads the module, serves the call's files from memory (R-SYS-1), runs one instance per stage with fork by replay (R-STG-2), enforces size and memory limits (R-MEM-2) and maps every abnormal ending to `NOT CHECKED` (R-EQ-4).

Two front ends share it:

- `fpv`, a Node command with `cp_verify`'s arguments, output and exit codes (R-API-1)
- `verify(files, args)` for browsers and servers, run in a Web Worker in the browser (R-API-2), with `checkAcceptance()` beside it (R-API-3)
