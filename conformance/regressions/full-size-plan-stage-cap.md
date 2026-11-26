# Full-size planning uses the stage page cap

R-EQ-2 regression from the first resource-limit build for issue #26. The smallest pinned reproduction uses the checksum-verified `full-size` configuration and key with no mutations.

- Upstream commit `9e2bdd8ff5bf9c62f18263d7dac189b0400b260c`.
- Arguments `-plan id examples/full-size/config examples/full-size/ivk/key.bin`.
- Stage `cpPlanMain` invokes `runStage` directly.
- First difference was exit 4 from native and exit 5 from Wasmtime. The original cap used 2,048 pages for this stand-alone stage and stopped before `PLAN ONLY: no proof was checked`.

`make conformance` runs this case, the two other affected planning modes and the corresponding clipped-gap cases. `make memory-limit-test` checks that Node can execute a plan past the coordinator limit. Both runners keep the lower limit for positions that coordinate forks. [Failing baseline run](https://github.com/AbdelStark/flashprove-wasm-verifier/actions/runs/45833702718)
