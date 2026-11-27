import assert from "node:assert/strict";
import { test } from "node:test";
import { BrowserSupervisor } from "../../build/ts/host/browser-supervisor.js";
import { captureCall } from "../../build/ts/host/namespace.js";

const module = new WebAssembly.Module(Uint8Array.of(0, 0x61, 0x73, 0x6d, 1, 0, 0, 0));
const encoder = new TextEncoder();
const plan = encoder.encode("PLAN ONLY: no proof was checked\n");

class FakeWorker extends EventTarget {
  constructor(behave) {
    super();
    this.behave = behave;
    this.terminated = false;
    this.requests = [];
  }
  postMessage(request, transfer) {
    this.requests.push(structuredClone(request, { transfer }));
    this.behave(this, this.requests.at(-1));
  }
  terminate() { this.terminated = true; }
  reply(data) { this.dispatchEvent(new MessageEvent("message", { data })); }
}

const reply = (request, overrides = {}) => ({
  schema: 1, requestId: request.requestId,
  result: { status: 4, stdout: plan.slice(), stderr: new Uint8Array(), failure: null }, ...overrides,
});
const snapshot = (files = new Map()) => captureCall(files, ["cp_verify", "-plan", "id", "config", "key.bin"]);

function supervise(behave, now) {
  const workers = [];
  const supervisor = new BrowserSupervisor({ start: () => { const w = new FakeWorker(behave); workers.push(w); return w; }, now });
  return { supervisor, workers };
}

test("a valid reply settles once, terminates the worker and ignores late messages", async () => {
  const { supervisor, workers } = supervise((worker, request) => queueMicrotask(() => {
    worker.reply(reply(request));
    worker.reply(reply(request, { result: { status: 0, stdout: encoder.encode("YES\n"), stderr: new Uint8Array(), failure: null } }));
  }));
  const result = await supervisor.run(module, snapshot());
  assert.equal(result.status, 4);
  assert.equal(result.failure, null);
  assert.equal(workers[0].terminated, true);
  assert.equal(workers[0].requests[0].schema, 1);
  assert.deepEqual(workers[0].requests[0].argv, ["cp_verify", "-plan", "id", "config", "key.bin"]);
});

test("stale, malformed and inconsistent replies end in a worker failure", async () => {
  for (const mutate of [
    request => reply(request, { requestId: request.requestId + 1 }),
    request => reply(request, { schema: 2 }),
    () => "YES",
    request => reply(request, { result: { status: 0, stdout: encoder.encode("YES\n"), stderr: new Uint8Array(), failure: null } }),
    request => reply(request, { result: { status: 5, stdout: plan.slice(), stderr: new Uint8Array(), failure: "trap" } }),
  ]) {
    const { supervisor, workers } = supervise((worker, request) => queueMicrotask(() => worker.reply(mutate(request))));
    const result = await supervisor.run(module, snapshot());
    assert.equal(result.failure, "worker");
    assert.equal(result.status, 5);
    assert.equal(workers[0].terminated, true);
  }
});

test("an error event or a silent worker fails closed; the deadline wins after it passes", async () => {
  const errored = supervise(worker => queueMicrotask(() => worker.dispatchEvent(new Event("error"))));
  assert.equal((await errored.supervisor.run(module, snapshot())).failure, "worker");
  const silent = supervise(() => {});
  const started = performance.now();
  assert.equal((await silent.supervisor.run(module, snapshot(), { deadlineMs: 30 })).failure, "timeout");
  assert.ok(performance.now() - started >= 29);
  assert.equal(silent.workers[0].terminated, true);
  let clock = 0;
  const late = supervise((worker, request) => setTimeout(() => { clock = 1000; worker.reply(reply(request)); }, 1), () => clock);
  assert.equal((await late.supervisor.run(module, snapshot(), { deadlineMs: 500 })).failure, "timeout");
});

test("one call at a time; invalid options and a failed start are typed refusals", async () => {
  let release;
  const { supervisor } = supervise((worker, request) => { release = () => worker.reply(reply(request)); });
  const first = supervisor.run(module, snapshot());
  assert.equal((await supervisor.run(module, snapshot())).failure, "busy");
  release();
  assert.equal((await first).failure, null);
  const next = supervisor.run(module, snapshot());
  release();
  assert.equal((await next).failure, null, "the slot is free once the first call settles");
});

test("the snapshot's buffers move to the worker; the caller's stay attached", async () => {
  const bytes = Uint8Array.of(1, 2, 3);
  const call = snapshot(new Map([["/config/policy.txt", bytes]]));
  const { supervisor, workers } = supervise((worker, request) => queueMicrotask(() => worker.reply(reply(request))));
  await supervisor.run(module, call);
  assert.equal(call.files[0][1].byteLength, 0, "the call's copy was transferred");
  assert.deepEqual([...workers[0].requests[0].files[0][1]], [1, 2, 3]);
  assert.equal(bytes.byteLength, 3);
  assert.equal((await new BrowserSupervisor({ start: () => { throw new Error("no workers"); } }).run(module, snapshot())).failure, "worker");
  assert.equal((await supervisor.run(module, snapshot(), { deadlineMs: 0 })).failure, "invalid-input");
});
