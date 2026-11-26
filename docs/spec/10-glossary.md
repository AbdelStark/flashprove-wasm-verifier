# Glossary

| Term | Meaning |
|---|---|
| Acceptance | A caller's decision after checking the verified result and independently held facts against the upstream rule |
| Baseline | Single-threaded `wasm32-wasip1` release build |
| Call | One argument vector and its files, run as a whole, part or planning invocation |
| Closing lines | The final commitment, proof-of-work, result and verdict lines of a native whole call at exit 0 or 14 |
| Commitment ID | Identifier for the model commitment from a source the caller already trusts |
| Conformance | Differential evidence from pinned native and guest executions or explicit host failure tests |
| Guest | The compiled WebAssembly verifier module or an instance of it |
| Host | Runtime adapter and supervisor providing the guest's restricted capabilities |
| Native reference | `cp_verify` built with upstream's own script from the pinned sources on x86_64 Linux |
| Part-call | An invocation checking the key or leaf stage only |
| Planning call | One of the four `-plan` invocations, which does no proof verification |
| Snapshot | Per-call immutable argument and file view observed by all guest instances |
| Stage | Upstream key, leaf or request check. The request depends on the other two for a whole-call pass. |
| Stage instance | Fresh WebAssembly instance used to run a single stage after replay |
| Verdict | The terminal classification carried by the upstream final line or a host refusal |
| Whole call | Upstream parent verification involving all three stages |
