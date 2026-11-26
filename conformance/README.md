# conformance

The corpora of SPEC.md § 5, run against the native reference built from the same pin.

On x86_64 Linux with g++ 13 or later, `make native-c1` builds the reference and checks the whole call, both part calls and all four planning modes for each published fixture. The build log is in `build/native-build.log`. Each call's stdout and stderr are in `build/native-c1/`.

`make conformance` currently runs C3 on x86_64 Linux. The upstream field, BLAKE2b and compression-count programs run natively and in Wasmtime. The hash programs that require POSIX child processes also run natively. The differential probe compares full-width Goldilocks carry cases and all 57 upstream hash vectors through the verifier's own headers. Results are in `build/c3/`.

- `excluded-fields.txt`: the only output fields a comparison may skip, each with its reason (R-EQ-3)
- `regressions/` (from M2): every input that once broke R-EQ-1 or R-EQ-2, with its provenance, kept forever

Fixtures are not stored here. `make upstream` fetches them and checks them against upstream's `SHA256SUMS`.
