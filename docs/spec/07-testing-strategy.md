# Testing strategy

## Corpus matrix

| Corpus | Inputs and calls | Oracle and gate |
|---|---|---|
| C1 published | Four hash-checked examples, default and clipped-gap policies, whole and part calls, all four planning modes | Native exit, final line, closing lines and full planning bytes |
| C2 altered | Upstream `altered_copies.tsv`, `altered_copies_clipped_gap.tsv`, `every_kind_of_item.tsv` | Native exit and rejection name. Retain all rows and their source table. |
| C3 known answers | `verifier/tests/hash_vectors.txt`, upstream known-answer programs and `blocks/field/tests/` | Exact value and framing parity before whole calls |
| C4 tables | All C1 policy parameter files, four tables each | Length and exact entries against the reference before whole calls |
| C5 differential fuzz | Seeded public fixture mutations across proof, key, leaf, request, token and configuration | R-EQ-1 every run. Record all R-EQ-2 differences. |
| C6 arguments | Missing or malformed ID, wrong policy, work and next-token flags, bits boundaries, option order, `-j` boundaries, positional paths | Exit and terminal output from unmodified native call |
| C7 limits | Oversize file, aggregate overflow, truncation within limit, memory failure, output exhaustion, timeout, trap, mixed rejection and host fault | Native normal parsing for in-envelope tests. Assert host refusal contract for injected failures. |

Run C3 and C4 before planning and whole-call parity. Test stage memory in M1 with representative call contexts, including the request stage in its upstream whole-call context. A M1 runner may select Wasmtime part-calls while M2 brings up the product runner. The final `make conformance` runs C1 to C4 and C6. `make fuzz SEEDS=N` runs C5. `make test` includes the host contract and C7 fault tests. `make c7-test` adds the native CLI cases on x86_64 Linux.

## Merge gates

- M0 CI builds and invokes the oracle. M1 CI fails on an audit, wide integer, table or part-call mismatch.
- From M2, an acceptance-path change requires green `make check`, `make test`, `make conformance` and `make fuzz SEEDS=1000`. Report verdict counts, discrepancies and executed seeds. M5 makes the differential gate required in CI.
- Unit tests cover virtual path resolution, file descriptor lifetimes, byte framing, token/coverage logic and error mapping. Integration tests use actual modules and the same native cases. Browser tests exercise worker failures and real offline fixtures.
- Release and optimization gates run all applicable corpora in the affected runtime or build mode. Unexpected equality differences on deterministic cases fail the gate. Safety violations fail immediately. Missing evidence fails the gate.
- The release-gates workflow runs on every push to `main`, on `v*` tags and on demand, with read-only privileges. Its jobs run `make conformance` (C1, C2 and C6 with the M1 C3 and C4 gates), `make c7-test`, four C5 shards of `make fuzz SEEDS=1000` and `make repro`. The evidence job merges the shards and runs `python3 -m conformance.release_gate`. It fails on missing or unreadable evidence, any gate not passed, any safety violation or equality difference, fewer than 1,000 executed seeds, an unmerged shard, pins that differ from the locks, or a tested module that is not the reproducible module of the same commit. It keeps `release-evidence.json` with the gate states, counts, pins and module hash for 90 days. A release uses only a commit whose release gates passed.
- Keep a minimal regression for any acceptance divergence and for confirmed equality defects. Record the first differing output and the first differing value within a stage where available before adjusting the port.

`make check` validates local references, requirement IDs, RFC metadata and milestones. The docs gate needs no upstream download. Generated reports and fixtures stay under ignored directories. [Differential design](../rfcs/RFC-0006-conformance.md#proposed-design)
