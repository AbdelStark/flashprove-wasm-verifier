<div align="center">

# flashprove-wasm-verifier

**A WebAssembly build of the pinned FlashProve verifier.**

[![check](https://img.shields.io/github/actions/workflow/status/AbdelStark/flashprove-wasm-verifier/check.yml?branch=main&style=for-the-badge&label=check)](https://github.com/AbdelStark/flashprove-wasm-verifier/actions/workflows/check.yml)
[![status](https://img.shields.io/badge/status-Node%20CLI-f59e0b?style=for-the-badge)](SPEC.md)
[![FlashProve](https://img.shields.io/badge/FlashProve-0.16.0%20%40%209e2bdd8-0ea5e9?style=for-the-badge)](https://github.com/anthropics/FlashProve/tree/9e2bdd8ff5bf9c62f18263d7dac189b0400b260c)
[![target](https://img.shields.io/badge/target-wasm32--wasip1-654ff0?style=for-the-badge&logo=webassembly&logoColor=white)](docs/adr/0002-wasi-sdk-target.md)
[![license](https://img.shields.io/badge/license-Apache%202.0-blue?style=for-the-badge)](LICENSE)

</div>

---

An AI provider tells you a reply came from the model it committed to. With [FlashProve](https://github.com/anthropics/FlashProve/tree/9e2bdd8ff5bf9c62f18263d7dac189b0400b260c), it can prove it: every covered token is the committed integer model's choice for your prompt, under the policy you accept. The verifier, `cp_verify`, checks that proof on an ordinary CPU, without ever seeing the weights.

Today, running that check means building C++17 with g++ on Linux. So in practice the check happens where the toolchain lives, not where the reply lands.

This project compiles the same verifier to WebAssembly. The Node command runs whole proofs, and Wasmtime checks parts and plans independently against the pinned reference.

> [!NOTE]
> The Node command is available from source. The [v1 specification](SPEC.md) tracks the remaining interfaces, conformance gates and release milestones.

## The one rule

**It never accepts a proof that the native verifier rejects.**

Every design choice serves that rule. The native `cp_verify`, built by upstream's own script from the same pinned commit, runs beside the WebAssembly build on every test. The two must agree on the exit code and on every closing line: `commitment:`, `proof of work:`, `result-v1`, and the verdict. A disagreement is a bug in this project until proven otherwise. Seeded fuzzing hammers the gap between them, and any seed that ever opened it stays in the suite forever. [Conformance](SPEC.md#5-conformance)

## How it works

**Same source.** No rewrite. We compile upstream's C++ at the pinned commit, read-only. Everything a browser or WASI runtime does differently lives in `port/`: shim headers and a small host. Because the sources are untouched, the module prints the same `build=` source digest as the native binary, so you can check that both were built from the same code. [ADR 0001](docs/adr/0001-compile-upstream-cpp.md)

**One instance per stage.** `cp_verify` checks a proof in three stages (`key`, `leaf`, `request`), each in its own forked process. WebAssembly has no `fork()`, so we replay it: the host starts a fresh instance with the same arguments and the same in-memory files, and the instance runs up to the same fork deterministically before taking the child's path. Every stage gets fresh memory, as with a real process, and a crash fails the stage, never the verdict. [ADR 0003](docs/adr/0003-stage-instances-fork-by-replay.md)

```
 files, in memory
        │
        ▼
 parent instance ──┬── fork ──▶ key stage      ──┐
                   ├── fork ──▶ leaf stage     ──┼──▶ stdout, exit status
                   └── fork ──▶ request stage  ──┘           │
                                                             ▼
                 closing lines, exit code ◀── parent merges ─┘
```

**Floating point, checked.** The verifier builds four public tables (SiLU, sigmoid, RoPE, exp) with the platform's math library and binds them by digest. WebAssembly's arithmetic is deterministic, but its math library is not glibc's. We compare all four tables, entry by entry, against the native build before any proof is checked. [R-FP-1](SPEC.md#45-floating-point)

**Hostile files, bounded.** Upstream does not cap input sizes. The host does, and every way a run can go wrong (a trap, running out of memory, a hit limit) ends in `NOT CHECKED`, never in a pass. [R-MEM-2](SPEC.md#47-memory-and-hostile-inputs)

## Run a proof with Node

On x86_64 Linux with procfs and Node 24, build the local command and run the checksum-checked upstream example. The example uses the ID published with that fixture. For other proofs, use a commitment ID from a source you trust.

```sh
make cli
fixture=.upstream/FlashProve/examples/accepted-proof
./bin/fpv "$fixture/config" "$fixture/ivk" "$fixture/example.req" \
  "$fixture/example.y" "$fixture/example.proof" -id "$(cat "$fixture/ID.txt")" -q
```

The call returns exit 0 and ends in `YES`. The CLI uses the same arguments and output streams as `cp_verify`. [CLI contract](docs/spec/02-public-api.md#cli)

## Use the library

In Node, `verify(files, args)` runs the call on an in-memory map in a fresh worker. In a browser, `createVerifier` checks the module against the SHA-256 you trust before compiling it, and runs each call in a dedicated worker.

```ts
import { verify, checkAcceptance } from "flashprove-wasm-verifier";            // Node
// import { createVerifier, checkAcceptance } from "flashprove-wasm-verifier/browser";
// const { verify } = createVerifier({ moduleUrl, moduleSha256 });              // browser

const result = await verify(files, [
  "config", "ivk", "example.req", "example.y", "example.proof", "-id", trustedId,
]);
result.verdict;   // "YES"
result.resultV1;  // { status: "0", claim: "exact-match", id: "...", bits: "128", ... }

// A YES is not acceptance. This applies upstream's acceptance rule, point by point,
// to facts only you have: the ID from a source you trust, your tokens, your policy.
const decision = checkAcceptance(result, expected); // { accepted: true } or the failed rules
```

`files` maps canonical absolute paths such as `/config/policy.txt` to bytes. Relative arguments resolve from `/`. [Host and library](host/README.md) · [Offline demo](demo/README.md)

## Roadmap

| | Milestone | Done when |
|---|---|---|
| ☑ | **M0** Ground | pins fetched and verified; native reference built and run in CI |
| ☑ | **M1** One stage | port audit as a test, field and hash known answers, tables equal, `-key` and `-leaf` part-calls pass in Wasmtime |
| ☑ | **M2** Whole call | fork by replay, `fpv` on Node, published and altered proofs match the native verdicts, 1,000 fuzz seeds clean |
| ☑ | **M3** Browser | TypeScript package, Web Worker, `checkAcceptance`, an offline demo page |
| ☐ | **M4** Speed | evaluate threads, SIMD and wide multiplication; measure whole calls against native and Bend |
| ☐ | **M5** Release | reproducible builds, fuzzing in CI, signed releases with published hashes |

No speed numbers until M4, and then only with their protocol: runtime, CPU, fixture, runs, statistic.

## Get started

You need Git, make, curl, Python 3 and a POSIX shell, on macOS or Linux.

```sh
git clone https://github.com/AbdelStark/flashprove-wasm-verifier
cd flashprove-wasm-verifier
make bootstrap upstream check
```

`bootstrap` fetches wasi-sdk 34 and Wasmtime 51 and checks them against [toolchain.lock](toolchain.lock). `upstream` fetches FlashProve at [the pinned commit](upstream.lock) and checks its four published examples against their own `SHA256SUMS`. `make help` lists the rest; targets from later milestones say which milestone brings them.

Working with a coding agent? [AGENTS.md](AGENTS.md) is written for it, and for you.

## What a YES means

Exactly what it means from the native verifier, and no more. The protocol, its assumptions and its security accounting are FlashProve's: read [what is proved](https://github.com/anthropics/FlashProve/blob/9e2bdd8ff5bf9c62f18263d7dac189b0400b260c/guide/what-is-proved.md) and [the acceptance rule](https://github.com/anthropics/FlashProve/blob/9e2bdd8ff5bf9c62f18263d7dac189b0400b260c/docs/verifying.md#when-to-accept) before you rely on one. `cp_verify` is tested, not verified, and so is this build of it.

## Related

- [FlashProve](https://github.com/anthropics/FlashProve): the protocol, the prover, the native verifier and the Lean verifier
- [flashprove-bend-verifier](https://github.com/AbdelStark/flashprove-bend-verifier): an independent verifier written in Bend 2, checked against the same native reference

---

<div align="center">

[Spec](SPEC.md) · [Decisions](docs/adr/) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Apache 2.0](LICENSE) · [Notice](NOTICE)

</div>
