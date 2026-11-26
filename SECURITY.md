# Security

This project's first promise: the WebAssembly verifier never accepts a proof that the native `cp_verify` rejects (SPEC.md, R-EQ-1). If you find an input that breaks it, that is a security bug. Please report it privately.

**Report privately** through GitHub's [private vulnerability reporting](https://github.com/AbdelStark/flashprove-wasm-verifier/security/advisories/new) for this repository. Include the files, the argument vector, both outputs (native and wasm) and the upstream and toolchain pins you used. Do not open a public issue for an acceptance bug.

Also report privately:

- a host bug that turns a trap, an out-of-memory condition or a limit into anything but `NOT CHECKED`
- a build that is not reproducible from the pins
- a way to make the browser package load a module other than the published one

**Bugs in FlashProve itself** (the protocol, the native verifier, the prover) belong upstream: follow FlashProve's [SECURITY.md](https://github.com/anthropics/FlashProve/blob/9e2bdd8ff5bf9c62f18263d7dac189b0400b260c/SECURITY.md). If a finding affects both, tell us which upstream report it belongs to, and we will coordinate.

Fixes to acceptance bugs ship with a regression case in `conformance/regressions/`.
