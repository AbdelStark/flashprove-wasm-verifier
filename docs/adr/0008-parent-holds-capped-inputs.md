# 0008. The parent holds every input the caps admit

- Status: Accepted. Supersedes the parent cap of [ADR 0006](0006-full-size-memory-envelope.md).
- Requirements: R-EQ-2, R-EQ-4, R-MEM-1, R-MEM-2, R-PERF-1

## Context

ADR 0006 set the parent cap to 2,048 pages from the full-size fixtures, which retain about 25 MiB of input. The same ADR admits a 64 MiB file and 128 MiB of retained input. Upstream reads the configuration, key, request, reply, proof and selected leaf in the parent before it forks a stage. `readWholeFile` appends 64 KiB blocks to a `std::string`, so the string's capacity can reach twice the file size, and growth briefly holds both the old and new buffers.

A key of exactly 64 MiB made the parent exceed 2,048 pages. Native returned exit 1 with `NO: cp-key-head`. The guest returned exit 5 with `NOT CHECKED: internal-stage`. That is safe under R-EQ-1 but breaks R-EQ-2 for an input that the caps admit. [Regression](../../conformance/regressions/key-at-file-cap-parent.md)

## Bound

Each string's allocations over its whole growth sum to less than 4 times its final size. `readWords` reserves the exact size. So all file buffers that the parent allocates stay below 4 times the 128 MiB retained input, which is 8,192 pages, whatever the allocator reuses. The bound does not cover state that the parent derives from parsed inputs. The 1,024 extra pages cover that state. ADR 0006 measured 1,142 parent pages for the full-size fixtures, which retain about 25 MiB of input. This check does not prove that a parsed input of a different shape stays within 1,024 pages.

## Evidence

Protocol: Node v24.22.1 on an Apple M4 Max, macOS. The in-memory host ran the module with SHA-256 `201263f212f72673660d72bb5d644bcbd7b7fb14a4af888d8009900527ff157d`, built from upstream `9e2bdd8ff5bf9c62f18263d7dac189b0400b260c`. Files from `examples/accepted-proof` were padded with zeros to the test size and kept their original headers. One run per case; linear memory is deterministic for a given module and input. The statistic is the parent's peak linear pages from the instance diagnostics.

| Case | Parent peak pages | Verdict |
|---|---:|---|
| `-key` with an empty key | 20 | `NO: cp-key-length` |
| `-key` with a 64 MiB key | 2,066 | `NO: cp-key-head` |
| Whole call, 64 MiB key and the rest in the proof | 3,603 | `NO: key-refused` |
| Whole call, 64 MiB KL file | 3,154 | `NO: KL-length` |
| Whole call, key, proof and leaf at 42 MiB each | 4,627 | `NO: key-refused` |

A grid of key, proof and leaf sizes (empty, 1 byte, 16 MiB + 1, 32 MiB + 1, 42 MiB, 48 MiB, 64 MiB - 1 and 64 MiB) within the 128 MiB total gave a highest parent peak of 4,627 pages. The 64 MiB key case reaches the native verdict at the new cap. These numbers hold only for this module and these inputs. The bound above covers the other splits.

## Decision

Set the parent cap to 9,216 pages: 8,192 for the bounded file buffers and 1,024 for the remaining parent state. The child cap stays 57,344 pages. The two live linear memories are now bounded by 66,560 pages, 4.0625 GiB. Normal calls do not use more memory, because linear memory grows only as the guest asks. A host that runs both instances must still reserve that much address space.

A change to the file cap or the retained input cap must recompute this bound. `make test` asserts that the parent cap covers 4 times the retained input. On x86_64 Linux, `make c7-test` compares the 64 MiB key call against native.
