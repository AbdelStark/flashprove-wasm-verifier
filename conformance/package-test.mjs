/** Install the packed archive in a clean project, compile a strict consumer and smoke-test Node, Deno and Bun (#38). */

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const inventory = JSON.parse(readFileSync("build/package-inventory.json", "utf8"));
const archive = resolve("build", inventory.archive.path);
const tsc = resolve("node_modules/typescript/bin/tsc");
const types = resolve("node_modules/@types");
const fixture = resolve(".upstream/FlashProve/examples/accepted-proof");
const project = mkdtempSync(resolve("build/package-smoke-"));

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: project, encoding: "utf8", ...options });
  if (result.error) throw result.error;
  return result;
};

try {
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "consumer", private: true, type: "module" }));
  execFileSync("npm", ["install", "--no-audit", "--no-fund", "--offline", archive], { cwd: project, stdio: "inherit" });
  assert.equal(JSON.parse(readFileSync(join(project, "node_modules/flashprove-wasm-verifier/package.json"), "utf8")).version,
    inventory.version);

  // A strict consumer compiled against the installed declarations through the package's exports.
  writeFileSync(join(project, "consumer.ts"), `
import { checkAcceptance, verify } from "flashprove-wasm-verifier";
import type { AcceptanceDecision, Files, VerifyResult } from "flashprove-wasm-verifier";
import { createVerifier } from "flashprove-wasm-verifier/browser";
import type { BrowserVerifier } from "flashprove-wasm-verifier/browser";
const files: Files = new Map([["/a", new Uint8Array(1)]]);
const pending: Promise<VerifyResult> = verify(files, ["-plan", "id"]);
const browser: BrowserVerifier = createVerifier({ moduleUrl: "/cp_verify.wasm", moduleSha256: "a".repeat(64) });
void browser;
export async function decide(): Promise<AcceptanceDecision> {
  const result = await pending;
  // @ts-expect-error results are read-only
  result.exitCode = 0;
  return checkAcceptance(result, {
    verifier: { moduleSha256: "a".repeat(64), build: "b".repeat(64) }, files: { request: new Uint8Array(), token: new Uint8Array() },
    id: "c".repeat(64), coverage: { r: 0, e: 1, T: 1, requireY: true }, policy: { kind: "exact-match" },
    allowProofOfWork: false, acceptTheoremOnCodes: true, completion: { kind: "partial" },
  });
}
`);
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify({ compilerOptions: {
    target: "ES2024", lib: ["ES2024", "DOM"], module: "NodeNext", strict: true, exactOptionalPropertyTypes: true,
    noUncheckedIndexedAccess: true, noEmit: true, skipLibCheck: false, typeRoots: [types], types: ["node"],
  }, files: ["consumer.ts"] }));
  execFileSync(process.execPath, [tsc, "-p", "tsconfig.json"], { cwd: project, stdio: "inherit" });
  console.log("package: strict consumer compiled against the installed declarations");

  // The installed CLI keeps native usage behavior.
  const cli = run(join(project, "node_modules/.bin/fpv"), []);
  assert.equal(cli.status, 2, "fpv with no arguments is a native usage error");
  console.log("package: installed fpv exits 2 on no arguments");

  writeFileSync(join(project, "smoke.mjs"), `
import { readFileSync } from "node:fs";
import { verify } from "flashprove-wasm-verifier";
const root = ${JSON.stringify(fixture)};
const names = ["ID.txt", "config/KL.bin", "config/layout.txt", "config/policy.txt", "ivk/key.bin", "ivk/leaf/0.bin",
  "example.req", "example.y", "example.proof"];
const files = new Map(names.map(name => ["/" + name, new Uint8Array(readFileSync(root + "/" + name))]));
const id = new TextDecoder().decode(files.get("/ID.txt")).trim();
const result = await verify(files, ["config", "ivk", "example.req", "example.y", "example.proof", "-id", id, "-q"]);
console.log(JSON.stringify({ exitCode: result.exitCode, verdict: result.verdict, failure: result.failure, record: result.resultV1 !== null }));
`);
  const expected = { exitCode: 0, verdict: "YES", failure: null, record: true };
  const runtimes = [["node", process.execPath, ["smoke.mjs"]]];
  const deno = process.env.DENO ?? "deno", bun = process.env.BUN ?? "bun";
  for (const [name, command, args] of [["deno", deno, ["run", "--allow-read", "--allow-env", "smoke.mjs"]], ["bun", bun, ["smoke.mjs"]]]) {
    const probe = spawnSync(command, ["--version"], { encoding: "utf8" });
    if (probe.error) {
      if (process.env.REQUIRE_RUNTIMES) throw new Error(`${name} is required but not found`);
      console.log(`package: ${name} not found, skipped`);
      continue;
    }
    runtimes.push([`${name} ${probe.stdout.trim().split("\n")[0]}`, command, args]);
  }
  for (const [name, command, args] of runtimes) {
    const smoke = run(command, args, { timeout: 300_000 });
    assert.equal(smoke.status, 0, `${name}: ${smoke.stderr}`);
    assert.deepEqual(JSON.parse(smoke.stdout.trim().split("\n").at(-1)), expected, name);
    console.log(`package: ${name} verified examples/accepted-proof from the installed package: YES with a record`);
  }
} finally {
  rmSync(project, { recursive: true, force: true });
}
