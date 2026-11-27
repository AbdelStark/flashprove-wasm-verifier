import assert from "node:assert/strict";
import { test } from "node:test";
import { checkAcceptance, recordEvidence, RULES } from "../../build/ts/host/acceptance.js";

const moduleSha256 = "a".repeat(64), build = "b".repeat(64), id = "c".repeat(64);
const commitment = "commitment: 49 closeness rounds of the one-time files rest on another source than the bound within "
  + "a third of the distance; the table has a record: the binding of the weights rests on the theorem on codes "
  + "(ePrint 2025/2055, Theorem 4.6), taken as given";
const work = "proof of work: up to 32 bits counted in 38 rounds; with it the least round has 128.00 bits, without it 96.23 bits";

function requestFile(T, r, e, fill = index => index + 100) {
  const bytes = new Uint8Array((T + 2) * 4);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < T; index++) view.setUint32(index * 4, fill(index), true);
  view.setUint32(T * 4, r, true);
  view.setUint32((T + 1) * 4, e, true);
  return bytes;
}
const word = value => { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value, true); return bytes; };

function scenario({ T = 64, r = 63, e = 64, y = 7, policy = { kind: "exact-match" } } = {}) {
  const yOnly = r === T - 1;
  const clipped = policy.kind === "clipped-gap";
  const values = clipped ? policy : { C: "256", theta: "256", cap: "0", s: "16", sh: "8" };
  const tokens = yOnly ? "none" : `${r + 1}..${Math.min(e, T - 1)}`;
  const yField = e === T ? "yes" : "no";
  const record = {
    status: "0", claim: yOnly ? "next-token" : clipped ? "policy" : "exact-match", id, bits: "128", work: "32",
    "work-rounds": "38", "least-round": "128.00", "least-round-without-work": "96.23", "commitment-assumed-rounds": "49",
    record: "1", r: String(r), e: String(e), T: String(T), tokens, y: yField, policy: policy.kind,
    C: values.C, theta: values.theta, cap: values.cap, s: values.s, sh: "8", sT: "4", F: "24", "above-clip": "0",
    leaf: "0", stages: "key,leaf,request", dw: "8", build,
  };
  const covered = `covered: r=${r} e=${e} T=${T} C=${values.C} theta=${values.theta} cap=${values.cap} s=${values.s} sh=8 `
    + `positions=${r}..${e - 1} tokens=${tokens} y=${yField} next-token=${yOnly ? "yes" : "no"} policy=${policy.kind} above-clip=0 (places)`;
  const last = clipped && !yOnly ? `WITHIN LIMITS: clipped-gap C=${values.C} theta=${values.theta} cap=${values.cap} s=${values.s} sh=8` : "YES";
  const request = requestFile(T, r, e), token = word(e === T ? y : 0);
  const lines = ["---- the call ----", covered, commitment, work,
    "result-v1 " + Object.entries(record).map(([k, v]) => `${k}=${v}`).join(" "), last];
  const evidence = { moduleSha256, mode: "whole", id, bitsGiven: false, request: request.slice(), token: token.slice(),
    exitCode: 0, failure: null, lines, record };
  const want = { verifier: { moduleSha256, build }, files: { request, token }, id,
    coverage: { r, e, T, requireY: e === T }, policy, allowProofOfWork: true, acceptTheoremOnCodes: true,
    completion: { kind: "partial" } };
  return { evidence, want };
}

function decide(evidence, want) {
  const result = {};
  recordEvidence(result, evidence);
  const decision = checkAcceptance(result, want);
  return decision.accepted ? [] : [...decision.failed];
}

test("y-only calls are accepted with YES under exact match and under a clipped gap", () => {
  const exact = scenario();
  assert.deepEqual(decide(exact.evidence, exact.want), []);
  const gap = { kind: "clipped-gap", C: "25856", theta: "512", cap: "1", s: "15", sh: "8" };
  const clipped = scenario({ policy: gap });
  assert.deepEqual(decide(clipped.evidence, clipped.want), []);
  const within = { ...clipped.evidence, lines: [...clipped.evidence.lines.slice(0, -1),
    "WITHIN LIMITS: clipped-gap C=25856 theta=512 cap=1 s=15 sh=8"] };
  assert.deepEqual(decide(within, clipped.want), ["verdict"], "a y-only call expects YES");
});

test("y-only completion reads y from the token file", () => {
  const { evidence, want } = scenario({ y: 2 });
  assert.deepEqual(decide(evidence, { ...want, completion: { kind: "complete", endTokenIds: [2] } }), []);
  assert.deepEqual(decide(evidence, { ...want, completion: { kind: "complete", endTokenIds: [3] } }), ["completion"]);
});

test("closing lines must carry the pinned wording and agree with the record", () => {
  const { evidence, want } = scenario({ r: 9, e: 14 });
  assert.deepEqual(decide(evidence, want), []);
  const replace = (index, line) => ({ ...evidence, lines: evidence.lines.map((old, i) => i === index ? line : old) });
  assert.deepEqual(decide(replace(1, evidence.lines[1].replace("tokens=10..14", "tokens=10..13")), want), ["coverage"]);
  assert.deepEqual(decide(replace(1, evidence.lines[1].replace("positions=9..13", "positions=9..14")), want), ["coverage"]);
  assert.deepEqual(decide({ ...evidence, lines: [evidence.lines[1], ...evidence.lines] }, want), ["coverage"]);
  assert.deepEqual(decide(replace(2, evidence.lines[2].replace("taken as given", "assumed")), want), ["commitment"]);
  assert.deepEqual(decide(replace(2, evidence.lines[2].replace("49 closeness", "48 closeness")), want), ["commitment"]);
  assert.deepEqual(decide(replace(3, work.replace("38 rounds", "37 rounds")), want), ["work"]);
  assert.deepEqual(decide(replace(3, "proof of work: none counted"), want), ["work"]);
  const none = { ...evidence, record: { ...evidence.record, work: "0", "work-rounds": "0" },
    lines: evidence.lines.map((line, i) => i === 3 ? "proof of work: none counted" : line) };
  assert.deepEqual(decide(none, { ...want, allowProofOfWork: false }), []);
  assert.deepEqual(decide(evidence, { ...want, allowProofOfWork: false }), ["work"]);
});

test("each observed fact is required", () => {
  const { evidence, want } = scenario({ r: 9, e: 14 });
  assert.deepEqual(decide({ ...evidence, bitsGiven: true }, want), ["verdict"]);
  assert.deepEqual(decide({ ...evidence, mode: "key" }, want), ["verdict"]);
  assert.deepEqual(decide({ ...evidence, failure: "timeout" }, want), ["verdict"]);
  assert.deepEqual(decide({ ...evidence, id: null }, want), ["id"]);
  assert.deepEqual(decide({ ...evidence, request: null }, want), ["files"]);
  assert.deepEqual(decide({ ...evidence, record: null }, want), ["verifier", "id", "verdict", "coverage", "work", "commitment"]);
  assert.deepEqual(decide({ ...evidence, record: { ...evidence.record, sT: "5" } }, want), ["coverage"]);
  assert.deepEqual(decide({ ...evidence, record: { ...evidence.record, record: "0" } }, want), ["commitment"]);
  const nonzeroToken = word(5);
  assert.deepEqual(decide({ ...evidence, token: nonzeroToken }, { ...want, files: { ...want.files, token: nonzeroToken } }),
    ["files"], "y is unused when e < T, so the token file must be zero");
});

test("results without evidence fail every rule and expectations are copied", () => {
  const { evidence, want } = scenario({ r: 9, e: 14 });
  assert.deepEqual(checkAcceptance({}, want), { accepted: false, failed: RULES });
  assert.deepEqual(checkAcceptance(null, want), { accepted: false, failed: RULES });
  const result = {};
  recordEvidence(result, evidence);
  evidence.lines.length = 0;
  evidence.request.fill(0);
  assert.deepEqual(checkAcceptance(result, scenario({ r: 9, e: 14 }).want), { accepted: true });
  for (const bad of [{ ...want, id: "X" }, { ...want, policy: { kind: "clipped-gap", C: "1", theta: "1", cap: "0", s: "1", sh: "7" } },
    { ...want, completion: { kind: "complete", endTokenIds: [] } }, { ...want, files: { request: [1], token: want.files.token } },
    { ...want, allowProofOfWork: "yes" }, { ...want, coverage: { ...want.coverage, r: 1.5 } }]) {
    assert.throws(() => checkAcceptance(result, bad), TypeError);
  }
});
