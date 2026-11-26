import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import { NodeSupervisor } from "../../build/ts/host/node-supervisor.js";

const module = new WebAssembly.Module(Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0));
const encode = text => new TextEncoder().encode(text);
const args = ["-plan", "id"];

function reject(result, code) {
  assert.equal(result.status, 5);
  assert.equal(result.failure, code);
  assert.deepEqual(result.stdout, encode("NOT CHECKED: internal-stage\n"));
  assert.equal(result.stderr.length, 0);
}

class ControlledWorker extends EventEmitter {
  postMessage(request) {
    for (const name of ["message", "messageerror", "error", "exit"]) assert.equal(this.listenerCount(name), 1);
    this.request = request;
  }

  reply(fields = {}, resultFields = {}) {
    this.emit("message", {
      schema: 1, requestId: this.request.requestId, ...fields,
      result: { status: 4, failure: null, stdout: encode("PLAN ONLY: no proof was checked\n"),
        stderr: new Uint8Array(0), ...resultFields },
    });
  }

  terminate() {
    this.stopping = true;
    return new Promise(resolve => this.once("exit", resolve));
  }

  unref() {
    return this;
  }
}

function controlled() {
  let now = 0;
  const workers = [];
  const host = new NodeSupervisor({
    now: () => now,
    start: () => {
      const next = new ControlledWorker();
      workers.push(next);
      return next;
    },
  });
  return { host, workers, time: value => { now = value; } };
}

test("a validated reply followed by clean exit wins before the deadline", async () => {
  const { host, workers, time } = controlled();
  const input = args.slice();
  const pending = host.run(module, input, { deadlineMs: 500 });
  input[1] = "changed";
  assert.deepEqual(workers[0].request.argv, ["cp_verify", ...args]);
  time(499);
  workers[0].reply();
  workers[0].emit("exit", 0);
  const result = await pending;
  assert.equal(result.status, 4);
  assert.equal(result.failure, null);
  assert.equal(workers[0].stopping, undefined);
});

test("the deadline wins at the boundary and a late reply cannot change the result", async () => {
  const { host, workers, time } = controlled();
  const pending = host.run(module, args, { deadlineMs: 500 });
  time(500);
  workers[0].reply();
  reject(await pending, "timeout");
  assert.equal(workers[0].stopping, true);
  reject(await host.run(module, args), "busy");
  assert.equal(workers.length, 1);
  workers[0].reply();
  workers[0].emit("exit", 0);
  reject(await pending, "timeout");
  const next = host.run(module, args);
  workers[1].reply();
  workers[1].emit("exit", 0);
  assert.equal((await next).status, 4);
});

test("a received result still needs clean exit before the deadline", async () => {
  const { host, workers, time } = controlled();
  const pending = host.run(module, args, { deadlineMs: 500 });
  time(499);
  workers[0].reply();
  time(500);
  workers[0].emit("exit", 0);
  reject(await pending, "timeout");
});

test("invalid or duplicate deliveries are fail closed", async () => {
  for (const bad of [
    worker => worker.reply({ requestId: -1 }),
    worker => worker.reply({ schema: 2 }),
    worker => worker.reply({}, { status: 0, stdout: encode("YES\n") }),
    worker => worker.reply({}, { stdout: Uint8Array.of(0, 1).subarray(1) }),
    worker => worker.reply({}, { status: 5, failure: "timeout", stdout: encode("YES\n") }),
    worker => worker.reply({}, { status: 5, failure: "timeout", stdout: encode("\ufeffNOT CHECKED: internal-stage\n") }),
    worker => { worker.reply(); worker.reply(); },
    worker => worker.emit("messageerror", new Error("failed delivery")),
  ]) {
    const { host, workers } = controlled();
    const pending = host.run(module, args);
    bad(workers[0]);
    reject(await pending, "worker");
    assert.equal(workers[0].stopping, true);
    workers[0].emit("exit", 1);
  }
});

test("a real lost worker refuses even after a reply and leaves admission available", async () => {
  const host = new NodeSupervisor({ start: () => new Worker(new URL("./fixtures/supervisor-worker.mjs", import.meta.url)) });
  reject(await host.run(module, ["-plan", "lost"]), "worker");
  reject(await host.run(module, ["-plan", "reply-then-lost"]), "worker");
  assert.equal((await host.run(module, ["-plan", "ok"])).status, 4);
});

test("admission refuses invalid options before launching a worker and releases the slot", async () => {
  const { host, workers } = controlled();
  reject(await host.run(module, args, { deadlineMs: 0 }), "invalid-input");
  reject(await host.run(module, ["bad\0arg"]), "invalid-input");
  assert.equal(workers.length, 0);
  const next = host.run(module, args);
  workers[0].reply();
  workers[0].emit("exit", 0);
  assert.equal((await next).status, 4);
});
