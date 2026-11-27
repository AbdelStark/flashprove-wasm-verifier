# 0012. Pin rehearsal at 7f074de: all gates pass, the pin stays

- Status: Accepted
- Requirements: R-SRC-1, R-EQ-1, R-EQ-2

## Context

RFC-0010 asks for one isolated rehearsal of a pin update before release. Upstream `main` has no commit after the pinned `9e2bdd8ff5bf9c62f18263d7dac189b0400b260c`. The only newer candidate is `7f074de634b508f59cd35b2c692ac667fc279182`, the head of upstream pull request #2. It adds `.github/workflows/pages.yml` and changes nothing else. It keeps version `0.16.0`.

## Rehearsal

`make rehearse-pin COMMIT=7f074de634b508f59cd35b2c692ac667fc279182` moved `upstream.lock` in a separate worktree, refetched the candidate, ran `make check`, rebuilt the module and passed the port audit. One upstream path changed, and none that the build or the fixtures read. The source digest stayed `93afdaf592393a54ebd17b681d1c03295eb883f0161ff0e6ab872a3b39939595`.

Draft pull request #80 carried only the lock change and ran every gate in CI on x86_64 Linux:

- `make upstream`: the candidate fetched, and the four examples matched their `SHA256SUMS`.
- `make m1-conformance`: the audit, C1 part calls and plans in Wasmtime, C3 and C4 all passed.
- `make conformance`: 147 cases (C1, C2, C6), 0 equality differences, 0 safety violations. C2 compared all 99 altered-proof rows; every row ended in `NO` in both runtimes, with 0 oracle differences.
- `make test`, `make c7-test`, `verify-test`, `acceptance-test`, the browser and offline demo tests, and the package tests in Node, Deno and Bun all passed.
- `make repro`: identical 7,228,095-byte modules from two clean roots. The port digest differs from the current pin's because it covers `upstream.lock`.
- C5, dispatched with `make fuzz SEEDS=1000` ([run](https://github.com/AbdelStark/flashprove-wasm-verifier/actions/runs/46028699430)): 1,000 of 1,000 seeds executed, 0 equality differences, 0 safety violations. Native and guest exited 1 for all 1,000.

## Decision

Do not move the pin. The candidate passed every gate, so the update workflow works end to end. But the commit is an unmerged pull request head, not a release on upstream `main`, and it changes no verifier input. Pinning it would tie the release to a commit that upstream has not published, for no change in what the verifier checks. Pull request #80 is closed unmerged. Move the pin when upstream releases on `main`, by the same procedure, in one pull request with its ADR and this evidence.
