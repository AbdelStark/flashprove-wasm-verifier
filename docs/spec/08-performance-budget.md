# Performance budget

## Resource envelope

```ts
type LimitsV1 = Readonly<{
  fileBytes: number; totalInputBytes: number; instancePages: number;
  outputBytes: number; deadlineMs: number; concurrentCalls: number;
}>;
```

All limits are positive safe integers. Instance pages are 64 KiB and strictly below 65,536 for the baseline. Cap parent and child; baseline liveness is at most a parent and one child. Bound combined snapshot, live linear memories, capture buffers and transient copies within each verified runtime configuration. The supervisor enforces call admission and an independent elapsed-time deadline. The build and runtime agree on the maximum page count. A failed grow or allocation latches the call. The exact defaults and headroom are an M1 evidence gate, published in a memory ADR and executable constants. The selected defaults must pass all full-size C1 cases on supported product runtimes. [Limits RFC](../rfcs/RFC-0005-failure-boundary.md#proposed-design)

The Node baseline accepts public input only. It admits one call per host and caps any file at 64 MiB and total retained input at 128 MiB. A call has at most 4,096 arguments and 1 MiB of encoded arguments. In-memory admission allows at most 4,096 files and 1 MiB of encoded path keys. The fork coordinator is limited to 2,048 pages. Each serial child and a standalone plan use the stage cap of 57,344 pages. Guest stdout, stderr and unread child pipes share an 8 MiB retained output budget. Replayed prefix output is discarded. A failure releases the call and returns exit 5 with only the host refusal. [Measured envelope](../adr/0006-full-size-memory-envelope.md) · [Failure model](04-error-model.md#host-failures)

## Measurement protocol

```text
BenchmarkV1 = {schema: 1, machine, os, cpu, ramBytes, candidate, reference,
  runtime, runtimeVersion, fixture, fixtureSha256, args, timer, memoryMethod,
  scope, warmupCount: 1, samplesNs: [u64, u64, u64], medianNs: u64,
  peakBytes?, peakKind?, exitCode, verdict}
```

Use fresh calls with one warmup followed by three measured runs. Report total wall time and optionally setup, replay and stage durations with distinct labels. A whole-call comparison covers input acquisition through completed verdict under the same declared boundary or labels non-equivalent scopes separately. RSS and linear memory are distinct measurements. Record methodology, versions, flags, fixture hashes, hardware and OS for native, Bend, Wasmtime, Node, Chrome, Firefox and Safari. Run them on one machine, using an identified x86_64 Linux guest for the native oracle if the browser matrix requires a different OS. Record virtualization and refuse a bare-metal speedup claim across differing environments.

The spec makes no latency or throughput promise before M4 observations. M4 publishes the measurements, exposes setup costs and evaluates each candidate. No default optimization change ships without complete equivalence evidence. [Performance RFC](../rfcs/RFC-0009-performance.md#proposed-design)
