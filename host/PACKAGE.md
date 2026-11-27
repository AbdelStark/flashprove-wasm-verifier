# flashprove-wasm-verifier

FlashProve's verifier, `cp_verify`, compiled to WebAssembly without changing what it checks. The module is built from the FlashProve commit named in `notices/FlashProve` and checked against its audited SHA-256 before every use.

This is a prerelease. The stable contract starts at 1.0.0.

## CLI

`fpv` takes the native argument vector and returns the native byte streams and exit codes.

```sh
npx fpv CONFIG_DIR PUBLIC_KEY_DIR REQUEST_FILE TOKEN_FILE PROOF_FILE -id ID
```

Exit 5 with `NOT CHECKED: internal-stage` is a host refusal (a limit, a trap, an unreadable or changed module). Exit 15 means an output stream could not be written. Disk access needs Linux x64 or arm64 with procfs.

## Node

```js
import { verify, checkAcceptance } from "flashprove-wasm-verifier";

const result = await verify(files, ["config", "ivk", "example.req", "example.y", "example.proof", "-id", id]);
// result.exitCode, result.verdict, result.resultV1, result.stdout, result.stderr, result.failure
const decision = checkAcceptance(result, expectations); // { accepted: true } or { accepted: false, failed: [...] }
```

`files` is a `Map` from canonical absolute paths such as `/config/policy.txt` to `Uint8Array`. Relative arguments resolve from `/`. The call copies its inputs before it awaits anything and leaves your buffers attached. The promise always resolves. A verdict is not an acceptance: `checkAcceptance` evaluates upstream's eight points against values you held before the reply, and only for a result that `verify` returned.

## Browser

```js
import { createVerifier, checkAcceptance } from "flashprove-wasm-verifier/browser";

const verifier = createVerifier({ moduleUrl, moduleSha256 });
const result = await verifier.verify(files, args);
```

Serve `flashprove-wasm-verifier/cp_verify.wasm` and the `./worker` entry from your origin. `moduleSha256` must be the value you trust from release metadata; other bytes are never compiled. Each call runs in a fresh dedicated worker, so the page stays responsive.

## Notices

Apache-2.0. The module contains FlashProve (Apache-2.0) and parts of wasi-libc and LLVM's runtimes. Their notices and licenses are in `NOTICE` and `notices/`.
