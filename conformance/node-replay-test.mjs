import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ownedFile } from "../build/ts/host/namespace.js";
import { runNodeGuest } from "../build/ts/host/node-replay.js";
import { PREVIEW1 } from "../build/ts/host/wasi.js";

const module = new WebAssembly.Module(readFileSync("build/node-replay-test.wasm"));
const encode = text => new TextEncoder().encode(text);
const decode = bytes => new TextDecoder().decode(bytes);
const file = value => ownedFile(encode(value));

function snapshot(lookup) {
  return { argv: ["cp_verify", "config"], namespace: { lookup } };
}

function refusal(result, reason) {
  assert.equal(result.status, 5);
  assert.equal(result.failure, reason);
  assert.equal(decode(result.stdout), "NOT CHECKED: internal-stage\n");
  assert.equal(result.stderr.length, 0);
}

function intercept(hooks, run) {
  const original = WebAssembly.Instance;
  let instances = 0;
  WebAssembly.Instance = class extends original {
    constructor(compiled, imports) {
      const ordinal = ++instances;
      hooks.imports?.(ordinal, imports);
      super(compiled, imports);
      hooks.memory?.(ordinal, this.exports.memory);
    }
  };
  try {
    return run();
  } finally {
    WebAssembly.Instance = original;
  }
}

test("three ordinal replays run one child each and transport independent pipe bytes", () => {
  let opens = 0;
  const call = snapshot(path => {
    assert.equal(path, "/file");
    opens++;
    return file("A");
  });
  const result = runNodeGuest(module, () => call);
  assert.equal(result.failure, null);
  assert.equal(result.status, 0);
  assert.equal(decode(result.stdout), "PZ");
  assert.equal(decode(result.stderr), "abc");
  assert.equal(opens, 4);
});

test("a changed file rejects before the replayed stage", () => {
  let opens = 0;
  refusal(runNodeGuest(module, () => snapshot(() => file(++opens === 1 ? "A" : "B"))), "replay-mismatch");
});

test("a changed pre-fork descriptor event rejects before closing the descriptor", () => {
  intercept({
    imports(ordinal, imports) {
      if (ordinal === 2) {
        const close = imports[PREVIEW1].fd_close;
        imports[PREVIEW1].fd_close = fd => close(fd + 1);
      }
    },
  }, () => refusal(runNodeGuest(module, () => snapshot(() => file("A"))), "replay-mismatch"));
});

test("replay rejects an unexpected operand before it enters the namespace", () => {
  let calls = 0;
  intercept({
    memory(ordinal, memory) {
      if (ordinal === 2) new Uint8Array(memory.buffer, 300, 4).set(encode("else"));
    },
  }, () => {
    refusal(runNodeGuest(module, () => snapshot(path => {
      assert.equal(path, "/file");
      calls++;
      return file("A");
    })), "replay-mismatch");
    assert.equal(calls, 3);
  });
});

test("a trap supplies signal 6 and takes precedence over the parent's refusal", () => {
  let parentStatus;
  intercept({
    imports(ordinal, imports) {
      if (ordinal === 1) {
        const exit = imports[PREVIEW1].proc_exit;
        imports[PREVIEW1].proc_exit = status => { parentStatus = status; exit(status); };
      }
    },
  }, () => refusal(runNodeGuest(module, () => snapshot(() => file("T"))), "trap"));
  assert.equal(parentStatus, 1);
});

test("parent waits consume a known status exactly once", () => {
  intercept({
    imports(ordinal, imports) {
      if (ordinal === 1) {
        const wait = imports.fpv_port.waitpid;
        imports.fpv_port.waitpid = (...args) => {
          assert.equal(wait(...args), args[0]);
          return wait(...args);
        };
      }
    },
  }, () => refusal(runNodeGuest(module, () => snapshot(() => file("A"))), "abi"));
});
