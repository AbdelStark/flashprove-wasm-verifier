import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeResult, missingRecord, parseResultV1, splitLines, verdictOf } from "../../build/ts/host/result.js";

const encoder = new TextEncoder();
const id = "79a5a2bc7a469b40df73dedf40abeb740671e8ae8077738bd3743897aeb22183";
const build = "93afdaf592393a54ebd17b681d1c03295eb883f0161ff0e6ab872a3b39939595";
const whole = ["config", "ivk", "example.req", "example.y", "example.proof", "-id", id];
const commitment = "commitment: 49 closeness rounds of the one-time files rest on another source";
const work = "proof of work: up to 32 bits counted in 38 rounds; with it the least round has 128.00 bits";
const fields = {
  status: "0", claim: "exact-match", id, bits: "128", work: "32", "work-rounds": "38", "least-round": "128.00",
  "least-round-without-work": "96.23", "commitment-assumed-rounds": "49", record: "1", r: "60", e: "64", T: "64",
  tokens: "61..63", y: "yes", policy: "exact-match", C: "256", theta: "256", cap: "0", s: "16", sh: "8", sT: "4",
  F: "24", "above-clip": "0", leaf: "0", stages: "key,leaf,request", dw: "8", build,
};
const line = (overrides = {}) => "result-v1 " + Object.entries({ ...fields, ...overrides }).map(([k, v]) => `${k}=${v}`).join(" ");
const output = (...lines) => encoder.encode(lines.map(text => text + "\n").join(""));
const guest = (status, stdout, failure = null) => ({ status, stdout, stderr: encoder.encode("stage note\n"), failure });
const closing = (record, last) => ["---- the call ----", "", commitment, work, record, last];

test("a complete pass decodes every field losslessly and keeps the raw streams", () => {
  const stdout = output(...closing(line(), "YES"));
  const result = decodeResult(guest(0, stdout), whole);
  assert.equal(result.exitCode, 0);
  assert.equal(result.verdict, "YES");
  assert.deepEqual({ ...result.resultV1 }, fields);
  assert.equal(result.stdout, stdout);
  assert.deepEqual(result.stdoutLines, closing(line(), "YES"));
  assert.deepEqual(result.stderrLines, ["stage note"]);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.resultV1) && Object.isFrozen(result.stdoutLines));
  assert.equal(missingRecord(result, whole), false);
});

test("policy, next-token and status 14 records agree with their last line", () => {
  const policy = { claim: "policy", policy: "clipped-gap", C: "9244130", theta: "323343", cap: "1", r: "15", e: "47", tokens: "16..47", y: "no" };
  const within = "WITHIN LIMITS: clipped-gap C=9244130 theta=323343 cap=1 s=16 sh=8";
  assert.equal(decodeResult(guest(0, output(...closing(line(policy), within))), whole).verdict, "WITHIN LIMITS");
  assert.ok(parseResultV1(0, closing(line(policy), within)));
  assert.equal(parseResultV1(0, closing(line(policy), within.replace("cap=1", "cap=2"))), null);
  assert.equal(parseResultV1(0, closing(line(policy), "YES")), null);
  const next = { claim: "next-token", r: "63", tokens: "none" };
  assert.ok(parseResultV1(0, closing(line(next), "YES")));
  const fourteen = decodeResult(guest(14, output(...closing(line({ status: "14" }), "NOT-A-VERIFICATION"))), whole);
  assert.equal(fourteen.verdict, "NOT-A-VERIFICATION");
  assert.equal(fourteen.resultV1.status, "14");
  assert.equal(parseResultV1(14, closing(line(), "NOT-A-VERIFICATION")), null, "status field must equal the exit");
  assert.equal(parseResultV1(0, closing(line({ status: "14" }), "YES")), null);
});

test("malformed, reordered, duplicated or inconsistent records yield no record", () => {
  const bad = [
    line({ work: "33" }), line({ bits: "0128" }), line({ "least-round": "128.0" }), line({ id: id.toUpperCase() }),
    line({ build: build.slice(1) }), line({ record: "0" }), line({ dw: "4" }), line({ stages: "key,leaf" }),
    line({ tokens: "60..63" }), line({ y: "no" }), line({ r: "64" }), line({ e: "65" }), line({ work: "0" }),
    line() + " ", line().replace("claim=exact-match id=", "id=").replace(` bits=`, ` claim=exact-match bits=`),
    line().replace("result-v1 ", "result-v2 "), line() + " extra=1", line({ claim: "exact-match x" }),
  ];
  for (const record of bad) assert.equal(parseResultV1(0, closing(record, "YES")), null, record);
  assert.equal(parseResultV1(0, [commitment, line(), work, line(), "YES"]), null, "duplicate record");
  assert.equal(parseResultV1(0, ["TEST BUILD: not for use", ...closing(line(), "YES")]), null);
  assert.equal(parseResultV1(0, [work, commitment, line(), "YES"]), null, "closing lines out of order");
  assert.equal(parseResultV1(0, [line(), "YES"]), null);
  const missing = decodeResult(guest(0, output(...closing(line({ work: "33" }), "YES"))), whole);
  assert.equal(missing.resultV1, null);
  assert.equal(missingRecord(missing, whole), true);
});

test("part, planning, rejection and host failure outputs carry no record", () => {
  const part = decodeResult(guest(3, output("PART PASSED: key")), ["-key", "config", "key.bin"]);
  assert.equal(part.verdict, "PART PASSED");
  assert.equal(part.resultV1, null);
  assert.equal(missingRecord(part, ["-key"]), false);
  const partFourteen = decodeResult(guest(14, output(...closing(line({ status: "14" }), "NOT-A-VERIFICATION"))), ["-leaf"]);
  assert.equal(partFourteen.resultV1, null, "a part call never yields a whole-call record");
  assert.equal(missingRecord(partFourteen, ["-leaf"]), false);
  const plan = decodeResult(guest(4, output("PLAN ONLY: no proof was checked")), ["-plan", "id"]);
  assert.equal(plan.verdict, "PLAN ONLY");
  const no = decodeResult(guest(1, output(...closing(line(), "NO: key-refused"))), whole);
  assert.equal(no.verdict, "NO");
  assert.equal(no.resultV1, null);
  const host = decodeResult(guest(5, output("NOT CHECKED: internal-stage"), "timeout"), whole);
  assert.equal(host.verdict, "NOT CHECKED");
  assert.equal(host.failure, "timeout");
  assert.equal(host.resultV1, null);
});

test("the verdict needs the exit code that the last line implies", () => {
  assert.equal(verdictOf(1, ["YES"]), null);
  assert.equal(verdictOf(0, ["NO: x"]), null);
  assert.equal(verdictOf(3, ["PART PASSED: "]), null);
  assert.equal(verdictOf(2, ["usage: cp_verify ..."]), null);
  assert.equal(verdictOf(15, ["YES"]), null);
  assert.equal(verdictOf(0, []), null);
  assert.equal(verdictOf(5, ["NOT CHECKED: internal-stage"]), "NOT CHECKED");
});

test("lines split on LF only, keep empty interior lines and decode with replacement", () => {
  assert.deepEqual(splitLines(encoder.encode("a\r\n\nb")), ["a\r", "", "b"]);
  assert.deepEqual(splitLines(encoder.encode("a\n")), ["a"]);
  assert.deepEqual(splitLines(new Uint8Array()), []);
  assert.deepEqual(splitLines(encoder.encode("\n")), [""]);
  assert.deepEqual(splitLines(Uint8Array.of(0xef, 0xbb, 0xbf, 0x41, 0xff, 10)), ["﻿A�"]);
});
