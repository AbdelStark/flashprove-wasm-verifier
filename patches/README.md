# patches

Changes to upstream code. The goal is for this folder to stay empty.

A patch exists only when no shim in `port/` can do the job. Each one changes one thing, is named `NNNN-what-it-does.patch`, and has an ADR in `docs/adr/` that names the upstream lines, why no shim works and which conformance runs cover it (SPEC.md, R-SRC-2).
