/** Caller acceptance on the pinned examples: each independent fact varied alone (R-API-3, RFC-0008). */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { checkAcceptance, verify } from "../build/ts/host/verify.js";

const examples = ".upstream/FlashProve/examples";
// Trusted values come from the audited build artifacts, never from the output under test.
const moduleSha256 = readFileSync("build/wasm/cp_verify.wasm.sha256", "ascii").trim();
const build = readFileSync("build/wasm/source.sha256", "ascii").trim();
const RULES = ["verifier", "files", "id", "verdict", "coverage", "work", "commitment", "completion"];

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

function words(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: bytes.length / 4 }, (_, index) => view.getUint32(index * 4, true));
}

function expectationsFor(files, policy) {
  const request = files.get("/example.req").slice(), token = files.get("/example.y").slice();
  const req = words(request);
  const T = req.length - 2, r = req[T], e = req[T + 1];
  return {
    verifier: { moduleSha256, build }, files: { request, token },
    id: new TextDecoder().decode(files.get("/ID.txt")).trim(),
    coverage: { r, e, T, requireY: e === T }, policy, allowProofOfWork: true, acceptTheoremOnCodes: true,
    completion: { kind: "partial" },
  };
}

const failedRules = decision => decision.accepted ? [] : [...decision.failed];

function expectRules(result, want, rules, label) {
  assert.deepEqual(failedRules(checkAcceptance(result, want)), rules, label);
  console.log(`acceptance: ${label}: ${rules.length ? `failed ${rules.join(", ")}` : "accepted"}`);
}

const call = (files, ...extra) => ["config", "ivk", "example.req", "example.y", "example.proof",
  "-id", new TextDecoder().decode(files.get("/ID.txt")).trim(), ...extra, "-q"];

async function suite(fixture, policy, policyArgs) {
  const files = load(fixture);
  const want = expectationsFor(files, policy);
  const result = await verify(files, call(files, ...policyArgs));
  assert.equal(result.exitCode, 0, fixture);
  expectRules(result, want, [], `${fixture} as published`);

  const other = "0".repeat(64);
  const vary = (label, change, rules) => expectRules(result, { ...want, ...change }, rules, `${fixture} ${label}`);
  vary("untrusted module", { verifier: { moduleSha256: other, build } }, ["verifier"]);
  vary("untrusted build", { verifier: { moduleSha256, build: other } }, ["verifier"]);
  const request = want.files.request.slice();
  request[0] ^= 1;
  vary("other request bytes", { files: { request, token: want.files.token } }, ["files"]);
  vary("other token bytes", { files: { request: want.files.request, token: Uint8Array.of(1, 0, 0, 0) } }, ["files"]);
  vary("other ID", { id: other }, ["id"]);
  vary("other range", { coverage: { ...want.coverage, r: want.coverage.r - 1 } }, ["files", "coverage"]);
  vary("y required on a partial window", { coverage: { ...want.coverage, requireY: true } },
    want.coverage.e === want.coverage.T ? [] : ["files", "coverage"]);
  if (policy.kind === "exact-match") {
    vary("clipped gap expected", { policy: { kind: "clipped-gap", C: "256", theta: "256", cap: "0", s: "16", sh: "8" } },
      ["verdict", "coverage"]);
  } else {
    vary("other policy value", { policy: { ...policy, cap: "2" } }, ["verdict", "coverage"]);
    vary("exact match expected", { policy: { kind: "exact-match" } }, ["verdict", "coverage"]);
  }
  vary("no proof of work allowed", { allowProofOfWork: false }, ["work"]);
  vary("theorem on codes not accepted", { acceptTheoremOnCodes: false }, ["commitment"]);
  const req = words(want.files.request);
  const { r, e, T } = want.coverage;
  const checked = req.slice(r + 1, Math.min(e, T - 1) + 1);
  if (e === T) checked.push(words(want.files.token)[0]);
  const lastToken = checked.at(-1);
  vary("complete reply ending in an end token", { completion: { kind: "complete", endTokenIds: [lastToken] } },
    checked.slice(0, -1).includes(lastToken) ? ["completion"] : []);
  vary("complete reply with an earlier end token",
    { completion: { kind: "complete", endTokenIds: [lastToken, checked[0]] } },
    checked.length > 1 && checked[0] !== lastToken ? ["completion"] : []);
  vary("complete reply cut short", { completion: { kind: "complete", endTokenIds: [0xffffffff] } }, ["completion"]);

  // Exposed arrays are views for the caller; changing them cannot change the decision.
  result.stdout.fill(0);
  assert.throws(() => { result.stdoutLines.push("YES"); }, TypeError);
  expectRules(result, want, [], `${fixture} after the caller zeroed stdout`);
  // A copy carries no evidence, however faithful.
  expectRules({ ...result }, want, RULES, `${fixture} copied result`);
  expectRules(structuredClone(result), want, RULES, `${fixture} cloned result`);
  return { files, want };
}

const exact = await suite("accepted-proof", { kind: "exact-match" }, []);
await suite("accepted-proof-clipped-gap",
  { kind: "clipped-gap", C: "9244130", theta: "323343", cap: "1", s: "16", sh: "8" },
  ["-policy", "clipped-gap,9244130,323343,1,16,8"]);

// Pass-like results that are not acceptances.
const { files, want } = exact;
expectRules(await verify(files, call(files, "-bits", "96")), want, ["verdict"], "-bits 96 (exit 14)");
expectRules(await verify(files, call(files, "-bits", "128")), want, ["verdict"], "-bits 128 named explicitly");
expectRules(await verify(files, call(files, "-no-proof-of-work")), want, ["verdict"], "-no-proof-of-work (exit 14)");
expectRules(await verify(files, ["-key", "config", "ivk/key.bin", "-id", want.id, "-q"]), want,
  ["verifier", "files", "id", "verdict", "coverage", "work", "commitment"], "key part call");
const absent = call(files).filter((arg, index, all) => arg !== "-id" && all[index - 1] !== "-id");
expectRules(await verify(files, absent), want, ["id", "verdict"], "no -id (exit 14)");
expectRules({ exitCode: 0, stdout: new Uint8Array(), stderr: new Uint8Array(), stdoutLines: ["YES"], stderrLines: [],
  verdict: "YES", resultV1: null, failure: null }, want, RULES, "fabricated result");
assert.throws(() => checkAcceptance({}, { ...want, id: want.id.toUpperCase() }), TypeError);
assert.throws(() => checkAcceptance({}, { ...want, coverage: { ...want.coverage, e: want.coverage.T + 1 } }), TypeError);
console.log("acceptance: ill-typed expectations throw TypeError");
