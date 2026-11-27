# conformance

The corpora of SPEC.md § 5, run against the native reference built from the same pin.

On x86_64 Linux with g++ 13 or later, `make native-c1` builds the reference and checks the whole call, both part calls and all four planning modes for each published fixture. The build log is in `build/native-build.log`. Each call's stdout and stderr are in `build/native-c1/`.

`make m1-conformance` requires the audited build, C3 and C4 before comparing C1 key and leaf part calls and plans on x86_64 Linux. The upstream field, BLAKE2b and compression-count programs run natively and in Wasmtime. The hash programs that require POSIX child processes also run natively. The C3 probe compares full-width Goldilocks carry cases and all 57 upstream hash vectors through the verifier's own headers. Results are in `build/c3/`.

C4 compares dimensions, every little-endian entry and the digest of all four tables for each published policy. It also sweeps the served RoPE parameter range and checks that a changed policy digest triggers a refusal. The versioned dumps are in `build/c4/`. [Table parity decision](../docs/adr/0005-public-table-parity.md)

The Wasmtime C1 gate compares the exact part-call closing records and both complete planning streams. It saves both streams and a redacted case record in `build/wasmtime-c1/`. The record reports safety violations independently of equality differences. It records the first differing line and byte within the comparison scope. Standalone transport tests cover fresh memory, short reads, EOF, signal status and replay mismatch.

`make conformance` runs the M1 gate afresh, then compares the full C1 matrix and the C6 argument matrix through `bin/fpv` on Node 24. Each pair uses the same argument vector and a case directory linked to the verified examples. C6 covers IDs, policies, work, next token, bits and thread bounds, and argument order. The representative whole call at `-j 1` compares both streams with the approved stage wall time exclusion.

C2 uses the pinned upstream generator for all three altered-proof tables. It copies the two small fixtures into per-case scratch directories and checks the exact exit and rejection line. A complete run has 10 default-policy rows, 10 clipped-gap rows and 79 item rows. Each C2 case records its fixture, table and table hash, physical row number, target and known rejection names. Missing rows and a native result that disagrees with the pinned table both fail the gate.

C5 runs with `make fuzz SEEDS=1000` on x86_64 Linux and requires fresh C3 and C4 evidence. Set `FUZZ_JOBS` to run independent pairs concurrently. Generator version 1 initializes SplitMix64 with the unsigned seed index, then consumes words for input class, fixture, target and operation in that order. Each choice is unsigned modulo the number of alternatives. A flip picks a byte and a bit, truncation picks a shorter length, and append uses the original length and one random byte. The classes and order are defined in `fuzz_cases.py`. Both runners receive the same mutated copy and argument vector.

Reports are written to `build/fuzz/seeds-N-INDEX-of-COUNT.json`. The default shard is `0/1`. Set `FUZZ_SHARD=I/K` to run the seed indices congruent to `I` modulo `K`. Merge reports with `python3 -B -m conformance.fuzz merge --seeds N --output build/conformance-c5.json REPORT ...`. A merge checks the pins, runtime, fixture manifests and full seed coverage.

Confirmed mismatches keep the original and reduced operation lists under `build/fuzz/private/`. Replay a descriptor with `python3 -B -m conformance.fuzz replay DESCRIPTOR`. Replay returns 1 when a mismatch remains. Keep failing evidence local and follow the private disclosure process for safety issues. [Security reporting](../SECURITY.md)

CI retains `build/conformance-m1.json` and `build/conformance-node.json` even when a gate fails. Reports include pins, runtime, module digest, mode and verdict counts, first difference locations and gate status. Raw streams and numeric dumps stay in their local build directories.

On x86_64 Linux, `make memory-probe` measures both full-size published whole calls at `-j 1`. The bounded Wasmtime measurement adapter compares each call's closing record against native and checks refusal under a smaller request cap. The report separates per-process native RSS, guest linear pages and Wasmtime host mappings. [Memory measurement protocol](../docs/adr/0006-full-size-memory-envelope.md)

`make test` runs the host contracts and C7 failure injections. The tests use the real supervisor, process shims and guest memory. They cover input and output caps, failed growth and allocation, deadline completion, worker loss and trap precedence. The scoped aggregate check runs on supported Linux hosts. Run `make c7-test` on x86_64 Linux for the full suite, including native comparison of a truncated proof, a malformed key exactly at the file limit and ordinary input precedence. A key one byte above the limit returns the exact host refusal.

- `excluded-fields.txt` lists the approved timing and thread-count anchors and their reasons. `make comparator-test` checks those boundaries without building the verifier.
- `regressions/` (from M2): every input that once broke R-EQ-1 or R-EQ-2, with its provenance, kept forever

Fixtures are not stored here. `make upstream` fetches them and checks them against upstream's `SHA256SUMS`.

`make bench` measures the full-size whole call (R-PERF-1, R-PERF-2) in the native reference, the Bend verifier at the `bench.lock` commit, the Wasmtime host, the Node CLI, and Chromium, Firefox and WebKit through Playwright, all on one machine. Each runtime gets one warmup and three measured calls. Process runtimes are timed from launch to exit with inputs on disk, with peak RSS from `wait4`. Browser rows are timed inside the page, from `verify()` through the decoded verdict in a fresh worker, with inputs already in page memory and the module compiled once at setup. The two scopes carry different labels and are not comparable as one number. `build/bench/benchmark-<fixture>.json` holds `BenchmarkV1` rows with raw samples, the median, exit, verdict, fixture digest, runtime version, CPU, OS, RAM and virtualization. The gate fails on a missing runtime, a wrong sample count, an undeclared scope, a verdict that differs from native, a different CPU or an unknown fixture digest. `make bench-test` checks the gate. WebKit stands in for Safari's engine; it is not Safari.

`WASM_CANDIDATE=simd` or `WASM_CANDIDATE=wide` builds an opt-in candidate with only the flags reviewed in `port/candidates.json`. The audit removes exactly those flags before it compares the build with the baseline inventory, and applies only the inventory changes the candidate declares. The candidate name enters the port digest, so a candidate module never carries the baseline's provenance. `make candidates` builds the baseline and both candidates and times the full-size call in every runtime that can run each build, with one warmup and three fresh processes. It requires every candidate's stdout to equal the baseline's. The decisions are ADR 0009 (SIMD rejected) and ADR 0010 (wide arithmetic stays opt-in).
