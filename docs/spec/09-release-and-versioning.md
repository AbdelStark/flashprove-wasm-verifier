# Release and versioning

## Compatibility policy

The first stable package and release tag are `1.0.0` and `v1.0.0`. Before stable, use SemVer prerelease identifiers on the intended version. Following stable, patch releases fix compatible behavior, minor releases add compatible surfaces, and major releases can break public contracts. A pin update that intentionally changes acceptance or call compatibility needs a major release after v1. Security fixes that restore the existing contract qualify for a patch. Publish a migration note naming the affected upstream formats and call behaviors whenever they change.

Use a minor release to mark a surface deprecated. Carry it through the next minor release and remove it only in a major release. Security revocations can remove affected artifacts from supported status with an advisory and replacement release. ABI, worker protocol and report schemas version independently. An older runtime rejects unsupported major versions.

## Release artifacts

Release the baseline module, checksum and signed manifest, both lockfiles, package archive with TypeScript declarations, offline demo bundle, conformance summary, performance report, license and notices. Changelog entries name requirement IDs, compatibility impact, pins, safety fixes and migration instructions. Distribute the project's Apache-2.0 license and the pinned upstream notice and third-party notices with binary artifacts. Inspect the extracted archives and test an install and offline verification before signing. [Notice](../../NOTICE)

A deterministic rebuild uses different absolute clean roots and the same pinned inputs. Compare the module bytes, not release timestamps. The manifest ties artifacts to a commit and verified hash. Authenticate its signature independently of the download. Publication uses an immutable version, verifies the artifacts after upload and records any partial publication. A retry compares existing asset hashes. Any differing published asset requires a new release version.

## Pin updates

One PR changes the relevant locks, adds an ADR, updates the platform audit and runs the full conformance and fuzz gates. Recompute native output only through the new pinned oracle and explain observable differences against the prior pin. Exercise this workflow in M5 in an isolated rehearsal before release. A pin need not move in the v1 tag if the rehearsal finds incompatibilities.

## Dependency policy

| Dependency | Constraint | Reason |
|---|---|---|
| FlashProve | Version and exact commit in `upstream.lock` | Oracle, proof format and fixture identity |
| wasi-sdk and its bundled LLVM, libc, libc++ and compiler-rt | Exact archives in `toolchain.lock` | Compilation and numerical repeatability |
| Wasmtime | Version and per-platform archives in `toolchain.lock` | Independent runtime for parts and benchmark host |
| Native reference | g++ 13 or later on x86_64 Linux, GNU coreutils/findutils | Upstream build contract. CI records exact compiler, libc and runner image. |
| Node | Supported major pinned in `toolchain.lock` | CLI, test harness and server library |
| TypeScript compiler | Exact dev dependency in the package lock when introduced | Strict API declarations. No verifier runtime dependency. |
| Playwright (dev only) | Exact dev dependency `1.65.0` in the package lock, npm registry, lockfile integrity hash, Apache-2.0 | Drives the pinned Chromium build in browser integration tests. Not shipped. |
| Browser engines, Deno, Bun and Bend verifier | Exact tested versions or revision in release evidence | Capability matrix and scoped comparisons |
| Build utilities | Git, Make, curl, tar, Bash and Python 3 with standard library | Existing bootstrap and repository checks. Record versions for release jobs. |

New dependencies state their source, pin, verification method and license. [Build design](../rfcs/RFC-0001-build-and-source.md#proposed-design) · [Publication design](../rfcs/RFC-0010-release.md#proposed-design)
