# 0006. Full-size memory envelope

- Status: Accepted. The parent cap is superseded by [ADR 0008](0008-parent-holds-capped-inputs.md).
- Requirements: R-MEM-1, R-MEM-2, R-PERF-1

## Context

A whole call retains its parent instance while each stage runs in a fresh child instance. The request stage receives the same proof, statement and setup as a call to native `cp_verify`. A standalone planning call does not exercise that memory path.

## Protocol

Run `make check memory-probe` on x86_64 Linux with the pinned native and Wasm inputs. Use both checksum-verified full-size fixtures. The probe uses upstream arguments with `-j 1`. For each fixture and runtime, run one warmup and three fresh processes. Compare the exact four-line closing record and exit status for every paired call. The wall clock covers launch through exit, including file acquisition and, for Wasmtime, compilation and replay. Report the median of the three measured samples.

The Linux native adapter loads a measurement library around `waitpid`. It calls `wait4` with the original arguments and records each child's kernel peak RSS on a separate file descriptor. The native parent records its own peak RSS with `getrusage`. The verifier binary comes from the pinned upstream build. Per-process peaks can include shared pages and cannot be added to obtain a resident-set peak for the whole tree.

The Wasmtime adapter samples the memory size before releasing each store. Linear memory cannot shrink during the call, so the final size is its peak. The probe records process virtual size immediately before and after each instantiation and the host process's peak virtual size and peak RSS. Virtual mappings include guards and runtime mappings. They count toward the address-space reservation.

Each fixture also runs with a child cap of 8,192 pages. The parent and the first two stages must reach the request stage, and the call must return exactly exit 5 with `NOT CHECKED: internal-stage`.

## Evidence

The Ubuntu 24.04 x86_64 runner reported four logical CPUs on an AMD EPYC 9V74 and 16,760,348,672 bytes of RAM. It used Linux 7.0.0-1017-azure, glibc 2.39, g++ 13.3.0 and Wasmtime 51.0.0. FlashProve was pinned to `9e2bdd8ff5bf9c62f18263d7dac189b0400b260c`. The module SHA-256 was `c8d829523792653528753b5645f4168e938a4e90f5924977f7540b8044056b2d`. The report retains unrounded sample times and both fixture manifest digests. [GitHub Actions measurement and report](https://github.com/AbdelStark/flashprove-wasm-verifier/actions/runs/45818350194)

Every baseline pair exited 0 with identical closing bytes. The default fixture ended in `YES`. The clipped-gap fixture ended in `WITHIN LIMITS: clipped-gap C=25856 theta=512 cap=1 s=15 sh=8`. Both constrained requests reached 7,966 linear pages and returned the expected refusal.

| Fixture | Runtime | Three wall time samples (ms) | Median (ms) |
|---|---|---:|---:|
| Full-size | Native | 20,016 / 20,013 / 19,963 | 20,013 |
| Full-size | Wasmtime | 52,691 / 53,040 / 53,499 | 53,040 |
| Full-size clipped-gap | Native | 19,967 / 19,960 / 19,965 | 19,965 |
| Full-size clipped-gap | Wasmtime | 52,845 / 53,246 / 52,741 | 52,845 |

| Fixture | Stage | Three native peak RSS samples (KiB) | Wasmtime peak linear pages in each sample |
|---|---|---:|---:|
| Full-size | Parent | 41,344 / 41,368 / 41,356 | 1,142 |
| Full-size | Key | 268,936 / 268,844 / 268,880 | 4,319 |
| Full-size | Leaf | 206,036 / 205,944 / 206,152 | 3,135 |
| Full-size | Request | 3,446,880 / 3,446,712 / 3,447,064 | 53,657 |
| Full-size clipped-gap | Parent | 41,412 / 41,484 / 41,404 | 1,142 |
| Full-size clipped-gap | Key | 269,556 / 269,484 / 269,576 | 4,319 |
| Full-size clipped-gap | Leaf | 205,888 / 205,932 / 206,076 | 3,135 |
| Full-size clipped-gap | Request | 3,446,708 / 3,446,892 / 3,446,956 | 53,656 |

The Wasmtime process mapped an additional 8,724,152,320 virtual bytes at each instantiation in every sample. Its highest process-wide virtual peak was 17,926,828,032 bytes. Its highest resident peak was 3,834,073,088 bytes. The input snapshots held 25,247,476 and 25,234,694 bytes. The report records all three host peaks per fixture.

## Decision

Use 2,048 pages for the parent and 57,344 pages for the active child as proposed limits for the baseline host. This bounds the two live linear memories to 3.625 GiB. Start with a 64 MiB file cap, 128 MiB of retained inputs, 8 MiB of captured output and one active call. A supervisor should reserve for snapshots, pipe storage and transient copies in addition to both linear memories. The probe uses a 600-second outer deadline.

The largest observed child used 53,657 pages. It had 3,687 pages of headroom at the proposed child cap and 11,879 pages below the wasm32 address-space ceiling. Keep wasm32 for the baseline. Reopen the memory mitigation decision if a required runtime cannot verify these fixtures with the measured envelope.

Apply these as product defaults after the Node host enforces the memory and allocation failure boundary. Validate the limits on each browser before including it in the supported runtime matrix.
