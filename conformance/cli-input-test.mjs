/** Compare scoped disk reads through the pinned guest and native verifier. */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { BASELINE_LIMITS } from "../build/ts/host/limits.js";
import { NodeSupervisor } from "../build/ts/host/node-supervisor.js";

const native = resolve("build/native/cp_verify");
const cli = resolve("bin/fpv");
const module = new WebAssembly.Module(readFileSync("build/wasm/cp_verify.wasm"));
const supervisor = new NodeSupervisor();
async function check(label, args, dir, status, verdict, diagnostics) {
  const oracle = spawnSync(native, args, { cwd: dir });
  if (oracle.error) throw oracle.error;
  assert.equal(oracle.status, status, label);
  if (verdict) assert.equal(oracle.stdout.toString().trimEnd().split("\n").at(-1), verdict, label);
  const guest = spawnSync(cli, args, { cwd: dir });
  if (guest.error) throw guest.error;
  assert.equal(guest.status, status, label);
  assert.ok(oracle.stdout.equals(guest.stdout), `${label}: stdout differs`);
  assert.ok(oracle.stderr.equals(guest.stderr), `${label}: stderr differs`);
  if (diagnostics) {
    const observed = await supervisor.run(module, args, { workingDirectory: dir, diagnostics });
    assert.equal(observed.failure, null, label);
    assert.equal(observed.status, status, label);
    assert.ok(guest.stdout.equals(observed.stdout), `${label}: diagnostics changed stdout`);
    assert.ok(guest.stderr.equals(observed.stderr), `${label}: diagnostics changed stderr`);
  }
  console.log(`CLI inputs: ${label} exit=${status}, both streams match`);
}

async function checkBrokenSink(args, dir, sink) {
  const child = spawn(cli, args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"], timeout: 600_000 });
  const closed = once(child, "close");
  child[sink].destroy();
  child[sink === "stdout" ? "stderr" : "stdout"].resume();
  assert.deepEqual(await closed, [15, null]);
  console.log(`fpv CLI: broken ${sink} returned exit 15`);
}

function checkModuleIntegrity(scratch) {
  const install = join(scratch, "install");
  const wasm = join(install, "build/wasm");
  mkdirSync(wasm, { recursive: true });
  cpSync("package.json", join(install, "package.json"));
  cpSync("bin", join(install, "bin"), { recursive: true });
  cpSync("build/ts/host", join(install, "build/ts/host"), { recursive: true });
  const entry = join(install, "bin/fpv");
  const moduleFile = join(wasm, "cp_verify.wasm");
  cpSync("build/wasm/cp_verify.wasm.sha256", moduleFile + ".sha256");

  const bytes = readFileSync("build/wasm/cp_verify.wasm");
  bytes[bytes.length - 1] ^= 1;
  new WebAssembly.Module(bytes);
  writeFileSync(moduleFile, bytes);
  for (const condition of ["mismatched", "missing"]) {
    const result = spawnSync(entry, [], { cwd: scratch });
    if (result.error) throw result.error;
    assert.equal(result.status, 5);
    assert.ok(result.stdout.equals(Buffer.from("NOT CHECKED: internal-stage\n")));
    assert.equal(result.stderr.length, 0);
    if (condition === "mismatched") renameSync(moduleFile, moduleFile + ".changed");
    console.log(`fpv CLI: ${condition} module returned exit 5`);
  }
}

const scratch = mkdtempSync(resolve("build/cli-input-"));
try {
  const dir = join(scratch, "fixture");
  cpSync(".upstream/FlashProve/examples/accepted-proof", dir, { recursive: true });
  await check("usage with no arguments", [], dir, 2);
  const plan = "PLAN ONLY: no proof was checked";
  await check("plan accounting", ["-plan", "accounting", "config", "128"], dir, 4, plan);
  await check("plan arrays", ["-plan", "arrays", "./config", "128"], dir, 4, plan);
  await check("plan ID", ["-plan", "id", join(dir, "config"), "ivk/key.bin"], dir, 4, plan);
  await check("plan request", ["-plan", "request", "config/policy.txt", "config/KL.bin", "128",
    "-reply", "example.y", "-q", "-layout", "config/layout.txt", "-prompt", "example.req"], dir, 4, plan);

  renameSync(join(dir, "config"), join(dir, "-config"));
  await check("option-like config path", ["-plan", "id", "-config", "ivk/key.bin"], dir, 4, plan);
  renameSync(join(dir, "-config"), join(dir, "config"));
  mkdirSync(join(dir, "sub"));
  await check("parent-relative paths", ["-plan", "id", "../config", "../ivk/key.bin"], join(dir, "sub"), 4, plan);
  const events = [];
  await check("part call below the verification bar with diagnostics", ["-key", "config", "ivk/key.bin", "-bits", "127", "-q"],
    dir, 14, "NOT-A-VERIFICATION", event => { events.push(event); });
  assert.deepEqual(events[0], {
    schema: 1, phase: "provenance", code: "build",
    build: readFileSync("build/wasm/source.sha256", "ascii").trim(),
    port: readFileSync("build/wasm/port.sha256", "ascii").trim(),
  });
  assert.ok(events.some(event => event.phase === "instance" && event.code === "end" && event.stage === "key"));
  console.log("CLI inputs: diagnostics provenance matches both build digests");

  const common = ["config", "ivk", "example.req", "example.y"];
  const id = readFileSync(join(dir, "ID.txt"), "ascii").trim();
  await checkBrokenSink([...common, "example.proof", "-id", id, "-j", "1", "-q"], dir, "stdout");
  await checkBrokenSink([], dir, "stderr");
  checkModuleIntegrity(scratch);
  const truncated = readFileSync(join(dir, "example.proof")).subarray(0, -1);
  writeFileSync(join(dir, "truncated.proof"), truncated);
  await check("C7 proof truncated within the file cap", [...common, "truncated.proof", "-id", id, "-q"],
    dir, 1, "NO: proof-refused");

  const sparse = join(dir, "sparse.key");
  const keyCall = ["-key", "config", "sparse.key", "-q"];
  writeFileSync(sparse, Buffer.alloc(0));
  truncateSync(sparse, BASELINE_LIMITS.fileBytes);
  await check("C7 key at the file cap", keyCall, dir, 1, "NO: cp-key-head");
  truncateSync(sparse, BASELINE_LIMITS.fileBytes + 1);
  const oversized = spawnSync(cli, keyCall, { cwd: dir });
  if (oversized.error) throw oversized.error;
  assert.equal(oversized.status, 5);
  assert.ok(oversized.stdout.equals(Buffer.from("NOT CHECKED: internal-stage\n")));
  assert.equal(oversized.stderr.length, 0);
  console.log("fpv CLI: C7 key one byte above the file cap returned exit 5");
  await check("invalid option precedes missing inputs", ["missing-config", ...common.slice(1), "missing.proof", "-bad"], dir, 2);
  await check("missing request plan option value", ["-plan", "request", "missing-policy", "missing-kl", "128", "-layout"],
    dir, 2);
  renameSync(join(dir, "ivk/leaf"), join(dir, "missing-leaf"));
  await check("missing selected leaf", [...common, "example.proof", "-q"], dir, 1, "NO: cp-entry-missing");
  writeFileSync(join(dir, "example.req"), Buffer.alloc(4));
  await check("wrong request length precedes missing proof", [...common, "missing.proof", "-q"], dir, 1, "NO: statement-range");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
