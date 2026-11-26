# Public API

## CLI

```text
fpv CONFIG_DIR PUBLIC_KEY_DIR REQUEST_FILE TOKEN_FILE PROOF_FILE -id ID [options]
fpv -key CONFIG_DIR KEY_FILE [options]
fpv -leaf CONFIG_DIR KEY_FILE LEAF_FILE [options]
fpv -plan {accounting|request|arrays|id} ...
```

`fpv` receives the native argument vector excluding argv[0]. It passes the same ordered arguments to upstream with literal `cp_verify` as the guest argv[0]. Native parsing decides suffix options, including `-policy`, `-j`, `-q`, `-show-stages`, `-next-token`, `-no-proof-of-work` and `-bits`. The CLI carries stdout and stderr as bytes, sets the process exit code after writes settle and leaves host provenance diagnostics out of those streams. [Native call forms](https://github.com/anthropics/FlashProve/blob/9e2bdd8ff5bf9c62f18263d7dac189b0400b260c/verifier/README.md#the-call)

## Library

```ts
type Files = ReadonlyMap<string, Uint8Array>;
declare function verify(files: Files, args: readonly string[]): Promise<VerifyResult>;
declare function checkAcceptance(
  result: VerifyResult,
  expected: AcceptanceExpectations
): AcceptanceDecision;
```

Paths in `Files` are canonical absolute virtual paths. Relative argv paths resolve from virtual `/`. Inputs are copied before the first asynchronous boundary and never detached. The promise resolves once, including ordinary refusals and recoverable errors. Browser execution happens in a dedicated worker. It accepts transferable copies owned by the supervisor. Imports do not touch the network in response to proof data. `VerifyResult` carries bytes, lines and a typed record when present. [Schemas](03-data-model.md#call-result) · [Worker protocol](../rfcs/RFC-0007-public-interfaces.md#proposed-design)

## Acceptance interface

Expectations come from caller-held facts and include complete request and token bytes, their expected coverage, a prior trusted commitment ID, policy, proof-of-work decision, build trust and reply completion policy. The helper checks result provenance within the library, evaluates the eight upstream points and returns typed failure reasons. A stage pass or planning result cannot reach the accepted branch. [Typed expectations and decision table](../rfcs/RFC-0008-caller-acceptance.md#proposed-design)

## Compatibility

Package SemVer covers the CLI behavior, TypeScript exports and result types. The upstream argument and proof formats are identified by the published upstream pin. ABI, worker messages and artifacts carry independent schema versions. [Release compatibility](09-release-and-versioning.md#compatibility-policy)
