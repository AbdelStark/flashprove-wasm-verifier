import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, renameSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { captureCliInputs, DiskInputError } from "../../build/ts/host/cli-input.js";
import { Errno } from "../../build/ts/host/namespace.js";

const linux = process.platform === "linux" && ["x64", "arm64"].includes(process.arch);
const hasProcfs = { skip: !linux };

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "fpv-disk-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const make = (name, text) => writeFileSync(join(root, name), text);
  mkdirSync(join(root, "config"));
  mkdirSync(join(root, "keys/leaf"), { recursive: true });
  make("config/policy.txt", "policy");
  make("config/KL.bin", "kl");
  make("keys/key.bin", "key");
  return {
    root,
    make,
    capture(args) {
      const result = captureCliInputs(args, root);
      t.after(() => result.namespace.close());
      return result;
    },
  };
}

function contents(result) {
  assert.equal(result.kind, "file");
  const bytes = new Uint8Array(Number(result.size));
  assert.equal(result.readInto(bytes, 0n), bytes.length);
  return new TextDecoder().decode(bytes);
}

test("capability selection preserves path operands and defers platform access", (t) => {
  const { root, capture } = fixture(t);
  const args = ["-plan", "request", "-literal-policy", "params", "129",
    "-j", "-ignored", "-prompt", "./req", "-layout", "/layout", "-reply", "../token"];
  const call = capture(args);
  assert.deepEqual(call.argv, ["cp_verify", ...args]);
  args[2] = "discarded";
  assert.equal(call.argv[3], "-literal-policy");
  assert.deepEqual(call.namespace.lookupOperand("-ignored", true), { kind: "error", errno: Errno.noent });
  const ambiguous = capture(["config", "keys", "config/policy.txt", "/config/policy.txt", "proof"]);
  assert.throws(() => ambiguous.namespace.lookupOperand("config/policy.txt", true), DiskInputError);
  if (!linux) assert.throws(() => captureCliInputs(["-plan", "id", "config", "keys/key.bin"], root)
    .namespace.lookupOperand("config/policy.txt", false), DiskInputError);
});

test("a snapshot caches authorized bytes and ordinary errors across disk changes", hasProcfs, (t) => {
  const { make, capture } = fixture(t);
  make("req", "original");
  const { namespace } = capture(["config", "keys", "req", "reply", "proof"]);
  assert.equal(contents(namespace.lookupOperand("req", true)), "original");
  assert.deepEqual(namespace.lookupOperand("reply", true), { kind: "error", errno: Errno.noent });
  make("req", "modified");
  make("reply", "late");
  assert.equal(contents(namespace.lookupOperand("req", true)), "original");
  assert.equal(namespace.lookupOperand("req", false).size, 8n);
  assert.deepEqual(namespace.lookupOperand("reply", false), { kind: "error", errno: Errno.noent });
});

test("metadata precedes bytes, changed files refuse and caps apply when opened", hasProcfs, (t) => {
  const { root, make, capture } = fixture(t);
  make("req", "before");
  make("proof", "");
  truncateSync(join(root, "proof"), 64 * 2 ** 20 + 1);
  const { namespace } = capture(["config", "keys", "req", "reply", "proof"]);
  assert.equal(namespace.lookupOperand("req", false).size, 6n);
  make("req", "changed length");
  assert.throws(() => namespace.lookupOperand("req", true), DiskInputError);
  assert.equal(namespace.lookupOperand("proof", false).size, BigInt(64 * 2 ** 20 + 1));
  assert.throws(() => namespace.lookupOperand("proof", true), { code: "input-limit" });
});

test("anchored roots survive replacement and guest-selected symlinks cannot escape", hasProcfs, (t) => {
  const { root, make, capture } = fixture(t);
  make("outside", "outside");
  symlinkSync("../../outside", join(root, "keys/leaf/0.bin"));
  make("keys/leaf/1.bin", "permitted");
  const { namespace } = capture(["config", "keys", "req", "reply", "proof"]);
  assert.equal(contents(namespace.lookupOperand("keys/key.bin", true)), "key");
  assert.deepEqual(namespace.lookupOperand("keys/leaf/0.bin", true), { kind: "error", errno: Errno.loop });
  assert.equal(contents(namespace.lookupOperand("keys/leaf/1.bin", true)), "permitted");
  for (const name of ["01.bin", "1/../0.bin", "4294967296.bin", "../../outside", "README.md"]) {
    assert.deepEqual(namespace.lookupOperand("keys/leaf/" + name, true), { kind: "error", errno: Errno.noent });
  }
  make("keys/leaf/2.bin", "anchored");
  renameSync(join(root, "keys"), join(root, "old-keys"));
  symlinkSync(".", join(root, "keys"));
  assert.equal(contents(namespace.lookupOperand("keys/leaf/2.bin", true)), "anchored");
  const fresh = capture(["config", "old-keys", "req", "reply", "proof"]);
  renameSync(join(root, "old-keys/leaf"), join(root, "outside-leaf"));
  symlinkSync("../outside-leaf", join(root, "old-keys/leaf"));
  assert.equal(fresh.namespace.lookupOperand("old-keys/leaf/2.bin", true).kind, "error");
});

test("explicit parent-relative and symlinked operands stay available", hasProcfs, (t) => {
  const { root, capture } = fixture(t);
  const alias = join(root, "alias");
  symlinkSync("keys", alias);
  const { namespace } = capture(["-plan", "id", "config/../config", "alias/key.bin"]);
  assert.equal(contents(namespace.lookupOperand("config/../config/policy.txt", true)), "policy");
  assert.equal(contents(namespace.lookupOperand("alias/key.bin", true)), "key");
  const parent = captureCliInputs(["-plan", "id", "../config", "../keys/key.bin"], join(root, "config"));
  t.after(() => parent.namespace.close());
  assert.equal(contents(parent.namespace.lookupOperand("../config/policy.txt", true)), "policy");
});
