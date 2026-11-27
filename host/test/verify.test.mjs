import assert from "node:assert/strict";
import { test } from "node:test";
import { BASELINE_LIMITS } from "../../build/ts/host/limits.js";
import { verify } from "../../build/ts/host/verify.js";

const internalStage = "NOT CHECKED: internal-stage\n";

async function refused(files, args, failure) {
  const result = await verify(files, args);
  assert.equal(result.exitCode, 5);
  assert.equal(result.failure, failure);
  assert.equal(new TextDecoder().decode(result.stdout), internalStage);
  assert.equal(result.verdict, "NOT CHECKED");
  assert.equal(result.resultV1, null);
}

test("invalid public arguments resolve to a typed host failure", async () => {
  await refused(new Map([["relative/path", new Uint8Array(1)]]), ["-plan", "id"], "invalid-input");
  await refused(new Map([["/a", new Uint8Array(1)], ["/a/b", new Uint8Array(1)]]), [], "invalid-input");
  await refused(new Map([["/a", new SharedArrayBuffer(1)]]), [], "invalid-input");
  await refused({ "/a": new Uint8Array(1) }, [], "invalid-input");
  await refused(new Map(), "config", "invalid-input");
  await refused(new Map(), ["a\0b"], "invalid-input");
  await refused(new Map([["/big", new Uint8Array(BASELINE_LIMITS.fileBytes + 1)]]), [], "input-limit");
});

test("verify copies inputs synchronously and leaves the caller's buffers attached", async () => {
  const bytes = new Uint8Array(BASELINE_LIMITS.fileBytes + 1);
  const files = new Map([["/big", bytes]]);
  const pending = verify(files, []);
  files.clear();
  await refused(new Map([["/big", bytes]]), [], "input-limit");
  assert.equal((await pending).failure, "input-limit");
  assert.equal(bytes.byteLength, BASELINE_LIMITS.fileBytes + 1);
});
