# A key at the file cap fits the parent

R-EQ-2 regression from the C7 native cases in pull request #70. The smallest reproduction uses the checksum-verified `accepted-proof` configuration and a zero-filled key of exactly 64 MiB.

- Upstream commit `9e2bdd8ff5bf9c62f18263d7dac189b0400b260c`.
- Arguments `-key config sparse.key -q`, with `sparse.key` holding 67,108,864 zero bytes.
- Stage: the parent reads `key.bin` with `readWholeFile` before it forks.
- First difference was exit 1 with `NO: cp-key-head` from native and exit 5 with `NOT CHECKED: internal-stage` from the guest. The parent needed 2,066 pages under a 2,048-page cap.

`conformance/cli-input-test.mjs` runs this case against native through `make c7-test`. [ADR 0008](../../docs/adr/0008-parent-holds-capped-inputs.md) · [Failing run](https://github.com/AbdelStark/flashprove-wasm-verifier/actions/runs/45965552864)
