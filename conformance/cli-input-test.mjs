/** Compare scoped disk reads through the pinned guest and native verifier. */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { captureCliInputs } from "../build/ts/host/cli-input.js";
import { runNodeGuest } from "../build/ts/host/node-replay.js";

const native = resolve("build/native/cp_verify");
const module = new WebAssembly.Module(readFileSync("build/wasm/cp_verify.wasm"));
function check(label, args, dir, status, verdict) {
  const oracle = spawnSync(native, args, { cwd: dir });
  if (oracle.error) throw oracle.error;
  assert.equal(oracle.status, status, label);
  if (verdict) assert.equal(oracle.stdout.toString().trimEnd().split("\n").at(-1), verdict, label);
  const guest = runNodeGuest(module, () => captureCliInputs(args, dir));
  assert.equal(guest.failure, null, label);
  assert.equal(guest.status, status, label);
  assert.ok(oracle.stdout.equals(guest.stdout), `${label}: stdout differs`);
  assert.ok(oracle.stderr.equals(guest.stderr), `${label}: stderr differs`);
  console.log(`CLI inputs: ${label} exit=${status}, both streams match`);
}

const scratch = mkdtempSync(resolve("build/cli-input-"));
try {
  const dir = join(scratch, "fixture");
  cpSync(".upstream/FlashProve/examples/accepted-proof", dir, { recursive: true });
  const plan = "PLAN ONLY: no proof was checked";
  check("plan accounting", ["-plan", "accounting", "config", "128"], dir, 4, plan);
  check("plan arrays", ["-plan", "arrays", "./config", "128"], dir, 4, plan);
  check("plan ID", ["-plan", "id", join(dir, "config"), "ivk/key.bin"], dir, 4, plan);
  check("plan request", ["-plan", "request", "config/policy.txt", "config/KL.bin", "128",
    "-reply", "example.y", "-q", "-layout", "config/layout.txt", "-prompt", "example.req"], dir, 4, plan);

  renameSync(join(dir, "config"), join(dir, "-config"));
  check("option-like config path", ["-plan", "id", "-config", "ivk/key.bin"], dir, 4, plan);
  renameSync(join(dir, "-config"), join(dir, "config"));
  mkdirSync(join(dir, "sub"));
  check("parent-relative paths", ["-plan", "id", "../config", "../ivk/key.bin"], join(dir, "sub"), 4, plan);

  const common = ["config", "ivk", "example.req", "example.y"];
  check("invalid option precedes missing inputs", ["missing-config", ...common.slice(1), "missing.proof", "-bad"], dir, 2);
  check("missing request plan option value", ["-plan", "request", "missing-policy", "missing-kl", "128", "-layout"],
    dir, 2);
  renameSync(join(dir, "ivk/leaf"), join(dir, "missing-leaf"));
  check("missing selected leaf", [...common, "example.proof", "-q"], dir, 1, "NO: cp-entry-missing");
  writeFileSync(join(dir, "example.req"), Buffer.alloc(4));
  check("wrong request length precedes missing proof", [...common, "missing.proof", "-q"], dir, 1, "NO: statement-range");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
