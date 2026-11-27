/** Compare verify(files, args) with the pinned native verifier on published calls (R-API-2, R-EQ-2). */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { verify } from "../build/ts/host/verify.js";

const native = resolve("build/native/cp_verify");
// The approved R-EQ-3 exclusions (conformance/excluded-fields.txt): thread count and wall time, only
// inside an exact stage heading line.
const heading = /^(---- stage (?:key|leaf|request) ----) [0-9]+ thread\(s\), [0-9]+\.[0-9]{3} s$/gm;
const comparable = bytes => Buffer.from(bytes).toString("latin1").replace(heading, "$1");
const compare = existsSync(native);
const examples = ".upstream/FlashProve/examples";

function load(fixture) {
  const files = new Map();
  const walk = (directory, prefix) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) walk(path, `${prefix}${name}/`);
      else files.set(`/${prefix}${name}`, new Uint8Array(readFileSync(path)));
    }
  };
  walk(join(examples, fixture), "");
  return files;
}

function nativeRun(files, args) {
  const root = mkdtempSync(resolve("build/verify-native-"));
  try {
    for (const [path, bytes] of files) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), bytes);
    }
    const run = spawnSync(native, args.map(arg => arg.startsWith("/") ? join(root, arg) : arg), { cwd: root });
    if (run.error) throw run.error;
    return run;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function check(label, files, args, exitCode, verdict, record) {
  const result = await verify(files, args);
  assert.equal(result.failure, null, label);
  assert.equal(result.exitCode, exitCode, label);
  assert.equal(result.verdict, verdict, label);
  assert.equal(result.resultV1 !== null, record, label);
  if (record) assert.equal(`result-v1 ${Object.entries(result.resultV1).map(([k, v]) => `${k}=${v}`).join(" ")}`,
    result.stdoutLines.at(-2), `${label}: record is lossless`);
  if (compare && !args.some(arg => arg.startsWith("/"))) {
    const oracle = nativeRun(files, args);
    assert.equal(oracle.status, exitCode, `${label}: native exit`);
    assert.equal(comparable(result.stdout), comparable(oracle.stdout), `${label}: stdout differs from native`);
    assert.ok(Buffer.from(result.stderr).equals(oracle.stderr), `${label}: stderr differs from native`);
  }
  console.log(`verify: ${label} exit=${exitCode} ${verdict}${compare ? ", both streams match native" : ""}`);
  return result;
}

const exact = load("accepted-proof");
const clipped = load("accepted-proof-clipped-gap");
const idOf = files => new TextDecoder().decode(files.get("/ID.txt")).trim();
const call = (files, ...extra) => ["config", "ivk", "example.req", "example.y", "example.proof", "-id", idOf(files), ...extra];
const policy = ["-policy", "clipped-gap,9244130,323343,1,16,8"];

const baseline = await check("exact-match pass", exact, call(exact, "-q"), 0, "YES", true);
await check("clipped-gap pass", clipped, call(clipped, ...policy, "-q"), 0, "WITHIN LIMITS", true);
await check("work not counted", exact, call(exact, "-no-proof-of-work", "-q"), 14, "NOT-A-VERIFICATION", true);
await check("bits below the target", exact, call(exact, "-bits", "96", "-q"), 14, "NOT-A-VERIFICATION", true);
await check("key part call", exact, ["-key", "config", "ivk/key.bin", "-id", idOf(exact), "-q"], 3, "PART PASSED", false);
await check("plan", exact, ["-plan", "id", "config", "ivk/key.bin"], 4, "PLAN ONLY", false);
await check("clipped proof without its policy", clipped, call(clipped, "-q"), 1, "NO", false);
await check("missing proof", new Map([...exact].filter(([path]) => path !== "/example.proof")), call(exact, "-q"), 2, null, false);
await check("absolute paths", exact,
  ["/config", "/ivk", "/example.req", "/example.y", "/example.proof", "-id", idOf(exact), "-q"], 0, "YES", true);

// The call owns a copy taken before the first await: later caller changes cannot reach it.
const proof = exact.get("/example.proof");
const pending = verify(exact, call(exact, "-q"));
proof.fill(0);
exact.delete("/ivk/key.bin");
const owned = await pending;
assert.equal(owned.exitCode, 0);
assert.equal(owned.verdict, "YES");
assert.equal(comparable(owned.stdout), comparable(baseline.stdout));
assert.equal(proof.byteLength > 0, true, "the caller's buffer stays attached");
console.log("verify: caller changes after the call began did not reach it");
