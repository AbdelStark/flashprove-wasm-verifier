import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BASELINE_LIMITS, PAGE_BYTES } from "../build/ts/host/limits.js";
import { captureCall, ownedFile } from "../build/ts/host/namespace.js";
import { runNodeGuest } from "../build/ts/host/node-replay.js";

const probe = new WebAssembly.Module(readFileSync("build/wasm-memory-probe.wasm"));
const pipeProbe = new WebAssembly.Module(readFileSync("build/node-replay-test.wasm"));
const stub = {};
for (const { module, name } of WebAssembly.Module.imports(probe)) (stub[module] ??= {})[name] = () => 0;
const pages = new WebAssembly.Instance(probe, stub).exports.memory.buffer.byteLength / PAGE_BYTES;
const decoder = new TextDecoder();
const files = new Map();
const capture = (mode, flag = "-plan", extra = []) => () => captureCall(files, ["cp_verify", flag, mode, ...extra]);

function expectFailure(result, failure) {
  assert.equal(result.status, 5);
  assert.equal(result.failure, failure);
  assert.equal(decoder.decode(result.stdout), "NOT CHECKED: internal-stage\n");
  assert.equal(result.stderr.length, 0);
}

test("planning runs with the stage cap and successful growth reaches the cap exactly", () => {
  assert.equal(runNodeGuest(probe, capture("zero"), { childPages: pages }).status, 0);
  expectFailure(runNodeGuest(probe, capture("zero"), { childPages: pages - 1 }), "memory-limit");
  const accepted = runNodeGuest(probe, capture("grow"), { parentPages: pages, childPages: pages + 1 });
  assert.equal(accepted.status, 0);
  assert.equal(decoder.decode(accepted.stdout), "YES\n");
  expectFailure(runNodeGuest(probe, capture("grow"), { childPages: pages }), "memory-limit");
});

test("engine-denied growth and failed nonzero allocation erase pass-like output", () => {
  expectFailure(runNodeGuest(probe, capture("engine-grow")), "runtime-oom");
  const allowed = runNodeGuest(probe, capture("allocate", "-plan", ["16"]));
  assert.equal(allowed.status, 0);
  expectFailure(runNodeGuest(probe, capture("allocate", "-plan", ["4294967295"])), "runtime-oom");
});

test("a child memory limit latches through a native parent refusal", () => {
  const limits = { parentPages: pages, childPages: pages + 1 };
  assert.equal(runNodeGuest(probe, capture("child", "-key"), limits).status, 3);
  expectFailure(runNodeGuest(probe, capture("child", "-key"), { ...limits, parentPages: pages - 1 }), "memory-limit");
  expectFailure(runNodeGuest(probe, capture("child", "-key"), { childPages: pages }), "memory-limit");
});

test("one output budget covers the parent, unread child pipes and stderr", () => {
  const byte = ownedFile(Uint8Array.of(65));
  const snapshot = () => ({ argv: ["cp_verify", "config"], namespace: { lookup: () => byte } });
  const accepted = runNodeGuest(pipeProbe, snapshot, { outputBytes: 7 });
  assert.equal(accepted.status, 0);
  assert.equal(decoder.decode(accepted.stdout), "PZ");
  assert.equal(decoder.decode(accepted.stderr), "abc");
  expectFailure(runNodeGuest(pipeProbe, snapshot, { outputBytes: 6 }), "output-limit");
});

test("one admitted call blocks reentrant capture and frees the slot on every result", () => {
  let nestedCaptured = false;
  const first = runNodeGuest(probe, () => {
    expectFailure(runNodeGuest(probe, () => {
      nestedCaptured = true;
      return capture("zero")();
    }), "busy");
    return capture("zero")();
  });
  assert.equal(first.status, 0);
  assert.equal(nestedCaptured, false);
  expectFailure(runNodeGuest(probe, capture("grow"), { childPages: pages }), "memory-limit");
  assert.equal(runNodeGuest(probe, capture("zero")).status, 0);
});

test("the per-file and aggregate input caps admit equality and reject one extra byte", () => {
  const file = new Uint8Array(BASELINE_LIMITS.fileBytes);
  const pair = new Map([["/a", file], ["/b", file]]);
  const exact = () => captureCall(pair, ["cp_verify", "-plan", "zero"]);
  assert.equal(runNodeGuest(probe, exact).status, 0);
  pair.set("/c", Uint8Array.of(0));
  expectFailure(runNodeGuest(probe, exact), "input-limit");
  expectFailure(runNodeGuest(probe, () => captureCall(new Map([["/a", new Uint8Array(file.length + 1)]]),
    ["cp_verify", "-plan", "zero"])), "input-limit");
});

test("an error releasing the call's input suppresses an otherwise complete result", () => {
  expectFailure(runNodeGuest(probe, () => ({
    argv: ["cp_verify", "-plan", "grow"],
    namespace: { lookup: () => { throw new Error("unexpected open"); }, close() { throw new Error("close failed"); } },
  })), "host-internal");
});
