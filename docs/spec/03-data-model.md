# Data model

## Call snapshot

```ts
type Sha256 = string; // exactly 64 lowercase hex characters
type Stage = "key" | "leaf" | "request";
type CallMode = "whole" | "key" | "leaf" | "plan" | "invalid";
type SnapshotEntry = Readonly<{path: string; bytes: Uint8Array; sha256: Sha256}>;
type Snapshot = Readonly<{argv: readonly string[]; files: readonly SnapshotEntry[]}>;
```

**Snapshot identity.** One call owns all captured bytes and the argument vector. Entries have unique canonical paths, and every descriptor is instance-local. The CLI may acquire files on first guest access and seals the observed regular-file bytes, metadata or error for the call. It does not allow later accesses to observe changes. The raw byte encoding is authoritative. The request is an array of little-endian unsigned 32-bit words with `T` tokens followed by `r,e`, where `0 <= r < e <= T`. The token file is one word, zero when `e < T`. Upstream owns binary proof, key, leaf and configuration decoding.

## Call result

```ts
type Verdict =
  | "YES" | "WITHIN LIMITS" | "PART PASSED" | "NO"
  | "NOT CHECKED" | "NOT-A-VERIFICATION" | "PLAN ONLY" | null;
type HostFailure =
  | "input-limit" | "invalid-input" | "busy" | "memory-limit" | "output-limit"
  | "timeout" | "trap" | "runtime-oom" | "replay-mismatch" | "abi"
  | "worker" | "integrity" | "host-io" | "host-internal";
type ResultV1 = Readonly<{
  status: "0" | "14"; claim: "next-token" | "exact-match" | "policy";
  id: Sha256 | "not-shown-without-id"; bits: string;
  work: string; "work-rounds": string; "least-round": string;
  "least-round-without-work": string; "commitment-assumed-rounds": string;
  record: "1"; r: string; e: string; T: string; tokens: string; y: "yes" | "no";
  policy: "exact-match" | "clipped-gap"; C: string; theta: string; cap: string;
  s: string; sh: string; sT: string; F: string; "above-clip": string; leaf: string;
  stages: "key,leaf,request"; dw: "8"; build: Sha256;
}>;
type VerifyResult = Readonly<{
  exitCode: number; stdout: Uint8Array; stderr: Uint8Array;
  stdoutLines: readonly string[]; stderrLines: readonly string[];
  verdict: Verdict; resultV1: ResultV1 | null; failure: HostFailure | null;
}>;
```

**Terminal record.** `resultV1` is available only for a complete four-line whole-call suffix at status 0 or 14. Require field names and order, one occurrence of each, decimal lexemes and pinned field ranges, and agreement with the exit and verdict. Keep decimal strings lossless. A future version word needs an explicit parser version. Split lines on LF, preserve empty interior lines, and omit the final delimiter. Text views decode as UTF-8 with replacement. Comparisons use the original bytes. The last stdout line supplies any rejection, policy or stage suffix. [Pinned field grammar](https://github.com/anthropics/FlashProve/blob/9e2bdd8ff5bf9c62f18263d7dac189b0400b260c/docs/format/FORMAT.md#148-the-line-for-programs)

## Artifact versions

```text
DiagnosticsV1 = {schema: 1, phase, code, stage?, elapsedNs?, peakLinearBytes?}
ConformanceReportV1 = {schema: 1, upstreamCommit, toolchainSha256, moduleSha256,
  runtime, cases: CaseResultV1[], counts, safetyViolations, equalityDifferences}
CaseResultV1 = {caseId, corpus, mode, nativeExit, guestExit, nativeVerdict,
  guestVerdict, firstDifference?, hostFailure?, seed?}
RegressionV1 = {schema: 1, caseId, upstreamCommit, fixtureId, args, generatorVersion,
  operations, seed?, rule, stage, firstDifference, provenance}
ReleaseManifestV1 = {schema: 1, version, sourceCommit, upstreamCommit, abi: 1,
  upstreamLockSha256, toolchainLockSha256, artifacts: [{path, bytes, sha256}]}
```

Artifacts use UTF-8 JSON, decimal strings for counters above the safe integer range, sorted keys for deterministic publication and finite nonnegative numeric counts. A reader rejects unknown schema versions. Optional fields are omitted when absent. Paths in release manifests are unique relative paths. Regression descriptors point at checksum-checked fixtures and contain deterministic mutation instructions. [Reporting and privacy](05-observability.md#conformance-evidence) · [Release artifacts](09-release-and-versioning.md#release-artifacts)
