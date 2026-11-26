# flashprove-wasm-verifier: technical specification

Status: **draft v0.1**, before any implementation. Upstream pin: [`upstream.lock`](upstream.lock). Toolchain pin: [`toolchain.lock`](toolchain.lock).

This document defines what the WebAssembly verifier must do, how it is built, and how we know it does it. Requirements carry stable IDs (`R-…`). A change to a requirement is a change to this file, in its own pull request, with an ADR when it changes a decision.

Upstream links below point at the pinned commit `9e2bdd8f`. Where this spec and upstream disagree on what a proof means, upstream wins: this project ports a verifier, it does not define one.

---

## 1. Goal

Run FlashProve's verifier, `cp_verify`, as WebAssembly: in a browser tab, in Node, Deno or Bun, and in a server-side runtime such as Wasmtime. Same files in, same verdict out, on any machine, with nothing to install.

A FlashProve proof states that every covered token of a request is the committed integer model's choice, under a stated acceptance policy. `cp_verify` checks that statement on a CPU, without the weights. Today that means building C++17 with a pinned compiler on Linux. This project removes that step without changing what is checked.

### 1.1 Non-goals

- A new verifier. We compile the upstream C++ source. A from-scratch port is a different project (the [Bend 2 verifier](https://github.com/AbdelStark/flashprove-bend-verifier) is one).
- Proving. `cp_commit` and `cp_prove` stay native.
- Changing the protocol, the file formats, the acceptance rule or the security accounting.
- Checking files that are not yet public. Upstream's prover-side use of `cp_verify` on unpublished responses relies on process protections (no core dumps) that a WebAssembly host cannot promise. See R-MEM-3.

## 2. Terms

| Term | Meaning |
|---|---|
| **native reference** | `cp_verify` built by upstream's [`verifier/build.sh`](https://github.com/anthropics/FlashProve/blob/9e2bdd8ff5bf9c62f18263d7dac189b0400b260c/verifier/build.sh) at the pinned commit, with g++ on x86_64 Linux. The oracle for every comparison. |
| **wasm verifier** | this project's build of the same sources for `wasm32-wasip1`, plus its host. |
| **host** | the JavaScript or TypeScript program that loads the module, supplies files from memory, runs stages and collects output. |
| **stage** | one of upstream's three checks: `key` (the committer's proofs in `key.bin`), `leaf` (ties the leaf file to `key.bin`), `request` (the proof). Upstream runs each in a forked child process. |
| **stage instance** | a fresh WebAssembly instance with its own linear memory, running one stage. |
| **closing lines** | the last four lines of a whole call that exits 0 or 14: `commitment:`, `proof of work:`, `result-v1 …` and the verdict. [Reference](https://github.com/anthropics/FlashProve/blob/9e2bdd8ff5bf9c62f18263d7dac189b0400b260c/verifier/docs/output.md). |
| **call** | one run with an argument vector, as upstream defines it: a whole call, a part-call (`-key`, `-leaf`) or a planning call (`-plan …`). |

## 3. What a verification is (unchanged from upstream)

Inputs, as in [the upstream call](https://github.com/anthropics/FlashProve/blob/9e2bdd8ff5bf9c62f18263d7dac189b0400b260c/verifier/README.md#the-call):

```
cp_verify CONFIG_DIR PUBLIC_KEY_DIR REQUEST_FILE TOKEN_FILE PROOF_FILE -id COMMITMENT_ID [options]
```

- `CONFIG_DIR`: `policy.txt`, `KL.bin`, `layout.txt`
- `PUBLIC_KEY_DIR`: `key.bin`, `leaf/<k>.bin`
- `REQUEST_FILE`: T tokens, then the words r and e
- `TOKEN_FILE`: one 32-bit little-endian word
- `PROOF_FILE`: the provider's proof
- options: `-id`, `-policy`, `-j`, `-q`, `-show-stages`, `-next-token`, `-no-proof-of-work`, `-bits`, `-plan`, `-key`, `-leaf`

Output: progress lines, then the closing lines; an exit code from [the upstream table](https://github.com/anthropics/FlashProve/blob/9e2bdd8ff5bf9c62f18263d7dac189b0400b260c/verifier/docs/output.md#exit-codes). Whether to accept is decided by [the acceptance rule](https://github.com/anthropics/FlashProve/blob/9e2bdd8ff5bf9c62f18263d7dac189b0400b260c/docs/verifying.md#when-to-accept). A `YES` alone is not acceptance, and exit code 0 alone is not a `YES`.

Sizes, from upstream's [full-size example](https://github.com/anthropics/FlashProve/tree/9e2bdd8ff5bf9c62f18263d7dac189b0400b260c/examples/full-size): an 18 MB proof, a 3.1 MB `key.bin`, a 2.8 MB leaf file, 228 KB of configuration.

## 4. Requirements

### 4.1 Equivalence

- **R-EQ-1 (safety).** For every input and argument vector, the wasm verifier never ends in `YES`, `WITHIN LIMITS` or `PART PASSED` unless the native reference ends in the same verdict on the same input. No exception, no tolerance.
- **R-EQ-2 (equality).** For every input and argument vector, the wasm verifier produces the native reference's exit code and the same bytes in its closing lines. For planning calls, the same full output. A difference is a bug until an ADR explains it.
- **R-EQ-3 (excluded fields).** Comparisons exclude only fields that measure the run: wall times and thread counts. The list of excluded fields lives in `conformance/excluded-fields.txt`, each entry with its reason. Nothing that a client reads under the acceptance rule may be on it.
- **R-EQ-4 (crashes).** A trap, an out-of-memory condition or a host failure in any stage ends the call as upstream ends a stage killed by a signal: `NOT CHECKED: internal-stage`, a nonzero exit code, never a pass.

### 4.2 Source

- **R-SRC-1.** The verifier is compiled from upstream's `verifier/src/` and `blocks/` at the pinned commit, read only. The fetch script verifies the commit hash before any build.
- **R-SRC-2.** Everything that differs from the native build lives in this repository's `port/`: shim headers placed ahead of the system headers on the include path, the host, and build flags. A change to upstream code itself is a last resort: a file in `patches/`, one concern per patch, with an ADR naming the upstream lines, why no shim works, and the conformance run that covers it.
- **R-SRC-3.** The port audit (§6) lists every operating-system and platform dependency of the sources, with the shim or patch that handles each. A dependency that appears after an upstream bump fails the build until the audit is updated.

### 4.3 Stages and isolation

Upstream's `runStage()` runs once per process, keeps its state in file-scope variables, and exits through `refuse()`. `cpStagesRun()` forks one child per stage, reads each child's output through a pipe, and merges the results ([source](https://github.com/anthropics/FlashProve/blob/9e2bdd8ff5bf9c62f18263d7dac189b0400b260c/verifier/src/cp_verify.cpp)).

- **R-STG-1.** Each stage runs in a fresh stage instance: new linear memory, file-scope variables at their initial values, nothing shared with the parent or the other stages except the input bytes and the argument vector.
- **R-STG-2 (fork by replay).** The port implements `fork()` for `cpStagesRun()` by deterministic replay. The host starts a new instance of the same module with the same argument vector and the same in-memory files, and tells it which child it is. The child instance runs `main()` again up to the same `fork()` call, where `fork()` returns 0, and continues down the child's path. Everything before the fork depends only on the arguments and the files, so the child's state equals the state a real fork would have copied. The replay rule is checked, not assumed: the host compares a digest of the parent's state at the fork point (the call's argument vector and file digests, which the port records) in both instances, and a mismatch ends the call in `NOT CHECKED`.
- **R-STG-3.** A child's standard output goes to the host. The parent reads it through the pipe file descriptor that `pipe()` and `dup2()` set up, served by the host from that buffer. `waitpid()` returns the child's exit status, or a signal status after a trap (R-EQ-4).
- **R-STG-4.** In the single-threaded build, the host runs each child to completion when the parent forks it. Children run one after another. The verdict does not depend on stage order: upstream merges after all children end.

### 4.4 Threads

Upstream uses threads in two places: `parFor()` in `vf_common.h`, a work loop over an atomic counter, and the reader threads of `cpStagesRun()`. `parFor()` already handles a thread that cannot start: the remaining workers, including the calling thread, take every job.

- **R-THR-1 (single-threaded build).** The port's `<thread>` shim makes `std::thread` construction throw `std::system_error`, and its `<mutex>` shim makes locks no-ops. Both thread sites already handle that: `parFor()` runs every job on the calling thread, and `cpStagesRun()` reads a child whose reader thread could not start on its own thread. No patch is needed for this build. A `std::system_error` thrown anywhere else reaches `main()`, which ends the call in `NOT CHECKED`: safe, and caught by C1 if it ever happens.
- **R-THR-2 (threaded build, later).** A second build targets `wasm32-wasip1-threads` with real threads over shared memory. It must meet R-EQ-1 and R-EQ-2 at every `-j` value that the native reference accepts. Browsers then need cross-origin isolation (COOP and COEP headers) for `SharedArrayBuffer`; the package documents it.
- **R-THR-3.** `-j N` keeps upstream's meaning. In the single-threaded build it is accepted and has no effect on the result.

### 4.5 Floating point

`cp_verify` computes four public tables (SiLU, sigmoid, RoPE, exponential) with the platform's `exp`, `sin`, `cos` and `pow`, then binds them by digest. Upstream warns that on a platform whose library rounds differently, an honest proof ends in `NO: table-digest-<name>`. WebAssembly's `f64` arithmetic is IEEE 754 and deterministic, but its `libm` is wasi-libc's, not glibc's.

- **R-FP-1.** The four tables computed by the wasm verifier equal the native reference's, entry for entry, for every parameter file in the conformance corpus. A test dumps both and compares them before any whole-call test runs.
- **R-FP-2.** If they differ, the fix is chosen by ADR, from: linking implementations that reproduce the reference platform's results on the table inputs, proved by an exhaustive sweep of those inputs; or a narrower patch. The fix never loosens a digest check, and never loads a table from outside the program.
- **R-FP-3.** The build uses no fast-math flag, no fused multiply-add contraction that the native build does not use, and no relaxed-SIMD instruction on any floating-point path.

### 4.6 Integers

- **R-INT-1.** `unsigned __int128` compiles through compiler-rt (`__multi3` and related). Field arithmetic is over p = 2^64 − 2^32 + 1. The field's known-answer tests (upstream `blocks/field/tests/`) run on the wasm build before any whole-call test.
- **R-INT-2.** Faster wide multiplication (WebAssembly's wide-arithmetic proposal, where a runtime ships it, or a hand-written 64×64 path) is an optimization behind a build flag. It must pass the field tests and R-EQ-1 and R-EQ-2 on the full corpus before it is on by default.

### 4.7 Memory and hostile inputs

- **R-MEM-1.** Each stage instance fits in `wasm32`'s 4 GiB address space with margin. M1 measures the native reference's peak resident memory per stage at `-j 1` on the full-size fixtures, and the wasm verifier's peak linear memory per stage. If the request stage does not fit, an ADR chooses between `memory64` and a patch that lowers peak memory.
- **R-MEM-2.** Upstream does not cap input sizes. The host does: a maximum size per input file and a maximum memory per instance, both set below what the host can survive, both documented, both reported as `NOT CHECKED` when hit. A limit is never a pass.
- **R-MEM-3.** No core-dump protection exists in a WebAssembly host. Upstream's `prctl(PR_SET_DUMPABLE, 0)` is compiled only under `__linux__`, so the wasm build does not run it, and the documentation says what that means: the wasm verifier is for public files. A host drops each stage instance's memory when the stage ends.
- **R-MEM-4.** The host never interprets stage output beyond what upstream's parent does with it. After a rejection, values printed by a stage come from rejected files and are not trusted (upstream's rule).

### 4.8 System calls

- **R-SYS-1.** Files come from memory. The host exposes the call's five paths and the files under the two directories through a read-only in-memory filesystem. Only regular files exist; upstream's `pathIsRegularFile()` and `openFileIsRegular()` checks then pass for exactly the files supplied.
- **R-SYS-2.** Upstream calls `madvise(MADV_POPULATE_WRITE)` only where that flag is defined; WASI does not define it, so the call compiles out. `<sys/mman.h>` must still resolve: wasi-libc's emulated header or a shim.
- **R-SYS-3.** Clocks: a monotonic clock for upstream's timings. Time never affects a verdict.
- **R-SYS-4.** Signals: `signal()` and `SIGCHLD` handling are shimmed; the only "signal" is a trap, mapped as in R-EQ-4.
- **R-SYS-5.** No network, no randomness source, no environment variables reach the module. Upstream's verifier needs none.

### 4.9 Build

- **R-BLD-1.** One command builds the module from the pinned sources with the pinned toolchain. CI builds it twice in clean environments and compares the bytes; a difference fails the build.
- **R-BLD-2.** Flags: upstream's macros (`BLK_FIELD=2`, `DIGEST_WORDS=8`, `SERVING_BUILD=1`, `BLK_COUNT_HASH_CALLS=1`), `-O2`, C++17, no exceptions disabled (upstream relies on them), no fast-math. Hardening flags that have no WebAssembly meaning are listed with the reason they are dropped.
- **R-BLD-3.** `VF_SOURCE_DIGEST` is computed exactly as upstream's `build.sh` computes it, over the same upstream files. The wasm verifier's `build=` line then equals the native reference's: a check that both were built from the same upstream sources. The port's own files get a second digest, printed by the host as `port=`.
- **R-BLD-4.** Every release publishes the module's SHA-256, the toolchain lock and the upstream lock.

### 4.10 Interfaces

- **R-API-1 (command line).** `fpv` runs on Node with the same argument vector as `cp_verify` and the same output and exit code. It reads the named files from disk into memory, then behaves as the in-memory host.
- **R-API-2 (library).** A TypeScript package exposes `verify(files, args)`. It returns the exit code, every output line, the parsed `result-v1` fields and the verdict. It runs in a Web Worker in browsers and never blocks the page.
- **R-API-3 (acceptance).** The library does not answer "accepted" by itself, because acceptance needs facts only the caller has: a commitment ID from a trusted source, the tokens sent and received, the policy the caller accepts. A separate `checkAcceptance(result, expected)` implements upstream's acceptance rule point by point, with each point's test taken from upstream's own examples.
- **R-API-4 (host ABI).** The module imports the WASI preview 1 functions it uses and one small module of its own, `fpv_port`, for the stage protocol (R-STG-2, R-STG-3). The ABI is versioned and documented in `port/ABI.md` before M2 ends.

### 4.11 Performance

- **R-PERF-1.** No speed figure without its protocol: fixture, runtime and version, CPU, memory, number of runs, statistic. As in the Bend verifier: median of three after one warmup.
- **R-PERF-2.** Report against the native reference and the Bend verifier on the same machine, on the full-size fixture, for Wasmtime, Node, Chrome, Firefox and Safari.
- **R-PERF-3.** A speed change is merged only with verdicts unchanged on the full corpus.

## 5. Conformance

The native reference is built in CI from the same pin and runs beside the wasm verifier on every corpus. Fixtures are fetched from upstream and checked against upstream's `SHA256SUMS`, never committed here.

| Corpus | What | Requirement |
|---|---|---|
| **C1 published** | upstream `examples/accepted-proof`, `accepted-proof-clipped-gap`, `full-size`, `full-size-clipped-gap`, with their IDs and policies | R-EQ-2 on whole calls, part-calls and the four planning calls |
| **C2 altered** | upstream `examples/rejected-proofs/` (`altered_copies.tsv`, `altered_copies_clipped_gap.tsv`, `every_kind_of_item.tsv`) | R-EQ-2: same rejection name, same exit code |
| **C3 known answers** | upstream `verifier/tests/hash_vectors.txt`, `verifier/tests/known_answers/`, `blocks/field/tests/` | unit-level equality, run first |
| **C4 tables** | the four public tables for every C1 parameter file | R-FP-1 |
| **C5 differential fuzz** | seeded byte mutations of C1 inputs: proof, key, leaf, request, token, configuration | R-EQ-1 always; R-EQ-2 reported. A seed that breaks R-EQ-1 becomes a permanent regression case |
| **C6 arguments** | argument vectors: missing `-id`, wrong `-policy`, `-next-token`, `-no-proof-of-work`, `-bits` values, options before paths | R-EQ-2 |
| **C7 limits** | oversized and truncated files against the host limits | R-MEM-2, R-EQ-4 |

`make conformance` runs C1 to C4 and C6. `make fuzz SEEDS=N` runs C5. A merge needs C1 to C4 and C6 green and a C5 run of at least 1,000 seeds without an R-EQ-1 break.

## 6. Port audit (initial reading)

From a reading of the pinned sources. M1 turns this table into a test that fails when the sources change.

| Dependency | Where | Plan |
|---|---|---|
| `fork`, `pipe`, `dup2`, `waitpid`, `exit`, `_exit` | `cpStagesRun()`, `cp_verify.cpp` | fork by replay (R-STG-2, R-STG-3) |
| `std::thread`, `std::mutex`, atomics | `parFor()` in `vf_common.h`; reader threads in `cpStagesRun()`; both fall back when a thread cannot start | R-THR-1, R-THR-2 |
| `prctl` | `main()`, `cp_verify.cpp`, under `#ifdef __linux__` | compiles out; documented (R-MEM-3) |
| `madvise`, `sysconf`, `<sys/mman.h>` | `makePagesResident()` in `vf_common.h`, under `#ifdef MADV_POPULATE_WRITE` | compiles out (R-SYS-2) |
| `stat`, `fstat`, `fopen`, `fcntl(F_GETFD)` | `vf_common.h` file reading; `main()` | in-memory filesystem (R-SYS-1) |
| `signal`, `SIGCHLD` | `cpStagesRun()` | shim (R-SYS-4) |
| `exp`, `sin`, `cos`, `pow`, `round`, `nearbyint`, `ldexp` | table construction in `cp_verify.cpp`, `vf_attention_shape.h` | R-FP-1, R-FP-2 |
| `unsigned __int128` | `blocks/base.h`, `vf_common.h`, `vf_smallness_packing.h` | compiler-rt (R-INT-1) |
| `steady_clock` | `now()` in `vf_common.h` | R-SYS-3 |

## 7. Threat model

What the wasm verifier adds to the native verifier's risks, and what covers each:

| Risk | Cover |
|---|---|
| The WebAssembly compiler miscompiles a check, and the module accepts a bad proof | R-EQ-1 on C2 and C5; the same source checked on two compilers and two targets |
| `libm` differences reject honest proofs | R-FP-1, C4 |
| Fork by replay diverges from a real fork | R-STG-2's state digest; C1 whole calls compared with part-calls |
| A host bug turns a failure into a pass | R-EQ-4; the host maps every non-normal ending to `NOT CHECKED`; C7 |
| A tampered module is served to a browser | R-BLD-1, R-BLD-4: reproducible builds and published hashes; the page pins the module by hash (Subresource Integrity) |
| A caller treats `YES` as acceptance | R-API-3 |

What it does not change: the protocol's soundness, its assumptions and its accounting are upstream's ([what is proved](https://github.com/anthropics/FlashProve/blob/9e2bdd8ff5bf9c62f18263d7dac189b0400b260c/guide/what-is-proved.md), [limits](https://github.com/anthropics/FlashProve/blob/9e2bdd8ff5bf9c62f18263d7dac189b0400b260c/docs/limits.md)). `cp_verify` itself is tested, not verified; so is this build of it.

## 8. Milestones

| | Milestone | Done when |
|---|---|---|
| **M0** | Ground | `make bootstrap upstream reference` fetches the pinned toolchain and sources, checks every hash, builds the native reference in CI and runs it on C1 |
| **M1** | One stage in WebAssembly | the port audit is a test; C3 and C4 pass; `-key` and `-leaf` part-calls pass C1 in Wasmtime; per-stage memory measured (R-MEM-1); ADRs for tables and memory |
| **M2** | Whole call | fork by replay; `fpv` on Node passes C1, C2, C6, C7 and 1,000 C5 seeds; `port/ABI.md` frozen at v1 |
| **M3** | Browser | the TypeScript package, a Web Worker host, `checkAcceptance`, a static demo page that verifies the published fixtures offline |
| **M4** | Speed | threaded build (R-THR-2), SIMD where it helps, wide multiplication (R-INT-2); a performance report under R-PERF |
| **M5** | Release | reproducible builds checked in CI, fuzzing in CI, signed release with hashes, an upstream bump done end to end by the documented procedure |

## 9. Open questions

1. Does wasi-libc's `libm` reproduce the reference tables? (M1, R-FP)
2. Does the request stage fit in 4 GiB at full size? (M1, R-MEM-1)
3. Wasmtime as a second, independent host for conformance, or Node only? Two hosts would catch host bugs that one host shares with itself.
4. Distribution: npm only, or also a single self-contained HTML file that verifies offline?

## 10. Changing this spec

Requirements change by pull request against this file, never in passing. Raise a requirement's strength freely. Lower one only with an ADR in `docs/adr/` that names what is lost and why it is worth it.
