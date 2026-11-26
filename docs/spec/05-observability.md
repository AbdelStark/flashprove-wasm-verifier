# Observability

## Runtime diagnostics

The default CLI emits guest stdout and stderr and no additional progress stream. Returned guest output can contain proof-controlled values, particularly under `-show-stages`. Do not forward it to automatic logs. Internal diagnostics use `DiagnosticsV1` records, finite phase and reason names, optional elapsed nanoseconds from a monotonic clock and peak size in bytes. Events cover build provenance, input refusal, instance start and end, replay mismatch and final host failure. Record `port=<sha256>` in provenance diagnostics. A failed diagnostic sink cannot promote a result.

Report durations for setup, parent replay, stage execution and complete calls. Metrics aggregate by runtime, corpus, stage and failure class. Exclude paths, tokens, commitment IDs, raw guest output and proof contents from runtime metrics and traces. Keep no live stage state for diagnostics after a call. Transmission is out of scope.

The Node supervisor delivers opted-in `DiagnosticsV1` records after it has decided the terminal result. Worker records have schema 1, a fixed phase, a fixed code and a fixed stage name where applicable. The worker batch is capped at 16 records. Durations are integer nanoseconds capped at the 600-second baseline deadline. Instance end reports the peak Wasm linear memory in bytes. The stage labels are `parent`, `plan`, `key`, `leaf` and `request`. A worker batch that fails validation is discarded. Sink exceptions and rejected promises leave the result intact.

Provenance records carry `build` and `port` as lowercase SHA-256 strings from the module's `fpv.provenance` custom section. The pinned SDK's `llvm-objcopy` writes the section before the final module audit. These fields identify the build. Release integrity uses separate artifact hashes. [Wasm custom sections](https://webassembly.github.io/spec/core/binary/modules.html#custom-section)

## Conformance evidence

Write versioned reports under `build/`. Each report records pin, module, runtime, corpus, count and first differing field or line. A differential run also records generator version, seed range, executed seeds, counts of both kinds of discrepancy and gaps caused by unavailable runs. Default CI output contains summaries and case IDs. Detailed diffs are local unless the maintainer confirms that all data is public and safe to publish. A potential R-EQ-1 regression follows [private disclosure](../../SECURITY.md) before sharing a reproducer. [Artifact schemas](03-data-model.md#artifact-versions)
