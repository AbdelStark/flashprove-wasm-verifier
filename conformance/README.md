# conformance

The corpora of SPEC.md § 5, run against the native reference built from the same pin.

On x86_64 Linux with g++ 13 or later, `make native-c1` builds the reference and checks the whole call, both part calls and all four planning modes for each published fixture. The build log is in `build/native-build.log`. Each call's stdout and stderr are in `build/native-c1/`.

`make conformance` runs C3 and C4 and compares C1 key and leaf part calls and plans on x86_64 Linux. The upstream field, BLAKE2b and compression-count programs run natively and in Wasmtime. The hash programs that require POSIX child processes also run natively. The C3 probe compares full-width Goldilocks carry cases and all 57 upstream hash vectors through the verifier's own headers. Results are in `build/c3/`.

C4 compares dimensions, every little-endian entry and the digest of all four tables for each published policy. It also sweeps the served RoPE parameter range and checks that a changed policy digest triggers a refusal. The versioned dumps are in `build/c4/`. [Table parity decision](../docs/adr/0005-public-table-parity.md)

The Wasmtime C1 gate compares the exact part-call closing records and both complete planning streams. It saves both streams and a redacted case record in `build/wasmtime-c1/`. The record reports safety violations independently of equality differences. It records the first differing line and byte within the comparison scope. Standalone transport tests cover fresh memory, short reads, EOF, signal status and replay mismatch.

- `excluded-fields.txt` lists the approved timing and thread-count anchors and their reasons. `make comparator-test` checks those boundaries without building the verifier.
- `regressions/` (from M2): every input that once broke R-EQ-1 or R-EQ-2, with its provenance, kept forever

Fixtures are not stored here. `make upstream` fetches them and checks them against upstream's `SHA256SUMS`.
