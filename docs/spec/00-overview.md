# Overview

## Users and claim

A recipient of a public FlashProve proof needs to check it where the reply arrives. A server can build the native verifier, but browsers cannot run that executable. Maintainers need one reference for deciding whether a platform difference changes the verdict.

The verifier checks the committed integer model's choices for the covered tokens under a stated policy, without model weights. The v1 claim is equivalence to the pinned native verifier for the same call, subject to documented host refusal boundaries. The caller still establishes which model, response and policy it trusts. Conformance tests record finite evidence for that claim. The [upstream protocol and assumptions](https://github.com/anthropics/FlashProve/blob/9e2bdd8ff5bf9c62f18263d7dac189b0400b260c/docs/limits.md) remain in force.

## Release scope

| Surface | v1 commitment |
|---|---|
| Baseline | One single-threaded `wasm32-wasip1` module carrying upstream's stage checks |
| Product | Node 24 CLI, TypeScript library for Node and browsers, browser worker, offline fixture demo and acceptance helper |
| Compatibility | Deno and Bun library smoke cases at recorded versions. Wasmtime runs independent part-calls and full-size whole-call benchmarks. |
| Evidence | C1 through C7, source and import audit, signed release, repeatable build and benchmark reports |
| Speed work | Separate candidates for threads, SIMD and wide multiplication with promotion gates |

Scope excludes proving, protocol or proof-format changes, reimplementing the verifier, private inputs, and safety or soundness claims beyond the pinned verifier. The demo verifies only fixtures it already holds. Distribution includes a package and an offline static bundle. A single-file HTML edition is future work. Full differential CI uses Node, with independent Wasmtime checks as listed above.

## Release evidence

Each [milestone](../../SPEC.md#8-milestones) has a separate gate. Stable v1 requires all baseline gates, tagged release evidence, and explicit disposition of each performance candidate. A milestone cannot close on a part-call result for a whole-call contract. Builds can fail during bring-up and gated features can remain unpublished. The release instructions identify the exact tested surfaces and pins. [Testing strategy](07-testing-strategy.md#merge-gates) · [Release contract](09-release-and-versioning.md#release-artifacts)
