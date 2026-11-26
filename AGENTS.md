# Working on flashprove-wasm-verifier

This repository compiles FlashProve's verifier, `cp_verify`, to WebAssembly without changing what it checks. It accepts nothing that the native verifier rejects. Every rule below follows from that.

Read [SPEC.md](SPEC.md) before you change anything. It has the requirements (`R-…`), the conformance corpora (`C1` to `C7`), the port audit and the milestones. Decisions and their reasons are in [docs/adr/](docs/adr/).

## The oracle

The native reference is `cp_verify` built by upstream's own `verifier/build.sh` at the commit in [upstream.lock](upstream.lock). It is the only judge of correct output. When the wasm verifier and the native reference disagree, the wasm verifier is wrong until an ADR says otherwise. Never edit an expected output to make a test pass.

## Hard rules

1. **Upstream is read-only.** `.upstream/` is fetched and hash-checked by `make upstream`. Never edit it. Platform differences go in `port/` (shim headers, host, flags). A change to upstream code is a last resort: one concern per file in `patches/`, with an ADR (R-SRC-2).
2. **Safety before equality.** R-EQ-1 has no exceptions: the wasm verifier never ends in `YES`, `WITHIN LIMITS` or `PART PASSED` unless the native reference ends in the same verdict. A fuzz seed that breaks it becomes a permanent regression case in `conformance/`.
3. **Failures are never passes.** A trap, an out-of-memory condition, a host exception or a hit limit ends in `NOT CHECKED`, with a nonzero exit code (R-EQ-4, R-MEM-2).
4. **No loosened checks.** Do not disable a digest check, a size check or a refusal to make something run. Do not add fast-math, relaxed SIMD or FMA contraction to any build (R-FP-3).
5. **Pins move together.** A change to `upstream.lock` or `toolchain.lock` comes with an ADR, a rerun of the port audit and a full conformance run, in one pull request.
6. **Measured claims only.** No speed or memory figure in docs, commits or pull requests without its protocol (R-PERF-1). Say which runtime, CPU, fixture, runs and statistic.
7. **No fixtures in git.** Fixtures come from upstream and are checked against upstream's `SHA256SUMS`. Generated files and outputs go in `build/` (ignored).

## How to work

- Start with `make help`. Then `make bootstrap upstream`. Targets that a milestone has not built yet exit with code 2 and name the milestone.
- Pick the next unchecked item of the current milestone in [SPEC.md § 8](SPEC.md#8-milestones). Name the requirement IDs it serves in your branch, commits and pull request.
- For a change on the verification path: name the stage, the rule, and the input that could otherwise reach acceptance. Run `make conformance` and `make fuzz SEEDS=1000`. Report both.
- When a comparison fails: find the first differing line, then the first differing value inside the stage, and keep the smallest input that reproduces it under `conformance/regressions/` with its provenance.
- For a new platform dependency (a system call, a header, a libm function): add it to the port audit in SPEC.md § 6 and to the audit test, with the shim that covers it.
- For speed work: verdicts first, then the same measurement before and after, on the same machine. Scope the claim to those builds.

## Layout

| Path | What |
|---|---|
| `SPEC.md` | requirements, corpora, audit, milestones |
| `docs/adr/` | decisions, numbered, never rewritten (supersede instead) |
| `port/include/` | shim headers, ahead of wasi-libc on the include path |
| `port/` | the host-facing side of the module: the `fpv_port` imports (R-API-4) |
| `host/` | the TypeScript host: in-memory files, stage instances, `fpv` CLI, `verify()` |
| `patches/` | changes to upstream code, each with its ADR; empty is the goal |
| `conformance/` | corpus runners, excluded fields (R-EQ-3), regression cases |
| `scripts/` | bootstrap, fetch, build and check scripts |
| `upstream.lock`, `toolchain.lock` | the pins |

## Before you hand off

Run `make check`, and `make conformance` if you touched `port/`, `host/`, `patches/`, a lock or a build flag. In the pull request: the requirement IDs, the commands you ran, what they printed (verdict counts, mismatches, seeds), and what you could not run. A whole-call requirement needs a whole-call result.

## Style

Plain, short sentences in docs and comments. Say what a check proves and what it does not. No em dashes or en dashes in prose. C++ follows upstream's style; TypeScript is strict mode, no `any`.
