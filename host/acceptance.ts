/**
 * Caller acceptance (R-API-3, RFC-0008): the eight points of upstream's "When to accept", evaluated
 * on library-private evidence from verify() and facts the caller already holds.
 */

import type { HostFailure, ResultV1, Sha256 } from "./result.js";

export type AcceptanceRule = "verifier" | "files" | "id" | "verdict"
  | "coverage" | "work" | "commitment" | "completion";

export type AcceptanceExpectations = Readonly<{
  verifier: Readonly<{ moduleSha256: Sha256; build: Sha256 }>;
  files: Readonly<{ request: Uint8Array; token: Uint8Array }>;
  id: Sha256;
  coverage: Readonly<{ r: number; e: number; T: number; requireY: boolean }>;
  policy:
    | Readonly<{ kind: "exact-match" }>
    | Readonly<{ kind: "clipped-gap"; C: string; theta: string; cap: string; s: string; sh: "8" }>;
  allowProofOfWork: boolean;
  acceptTheoremOnCodes: boolean;
  completion: Readonly<{ kind: "partial" }> | Readonly<{ kind: "complete"; endTokenIds: readonly number[] }>;
}>;

export type AcceptanceDecision =
  | Readonly<{ accepted: true }>
  | Readonly<{ accepted: false; failed: readonly AcceptanceRule[] }>;

/** What verify() observed. Held apart from the returned object, so changes to its arrays cannot reach it. */
export type CallEvidence = Readonly<{
  moduleSha256: Sha256;
  mode: "whole" | "key" | "leaf" | "plan";
  id: string | null;
  bitsGiven: boolean;
  request: Uint8Array | null;
  token: Uint8Array | null;
  exitCode: number;
  failure: HostFailure | null;
  lines: readonly string[];
  record: ResultV1 | null;
}>;

export const RULES: readonly AcceptanceRule[] = Object.freeze(
  ["verifier", "files", "id", "verdict", "coverage", "work", "commitment", "completion"]);

const evidence = new WeakMap<object, CallEvidence>();

/** Bind evidence to the exact result object that verify() returns. Internal to the package. */
export function recordEvidence(result: object, observed: CallEvidence): void {
  evidence.set(result, Object.freeze({
    ...observed, lines: Object.freeze([...observed.lines]), request: observed.request?.slice() ?? null,
    token: observed.token?.slice() ?? null, record: observed.record && Object.freeze({ ...observed.record }),
  }));
}

const SHA256 = /^[0-9a-f]{64}$/;
const DECIMAL = /^(?:0|[1-9][0-9]{0,19})$/;
// Pinned upstream wording (docs/verifying.md, point 7; integrations/check_proof.py ON_THE_COMMITMENT).
const COMMITMENT = new RegExp("^commitment: (?:1 closeness round of the one-time files rests|([1-9][0-9]*) closeness rounds "
  + "of the one-time files rest) on another source than the bound within a third of the distance; the table has a "
  + "record: the binding of the weights rests on the theorem on codes \\(ePrint 2025/2055, Theorem 4\\.6\\), taken as given$");
const NO_WORK = "proof of work: none counted";
const WORK = /^proof of work: up to ([1-9][0-9]*) bits counted in (?:1 round|([1-9][0-9]*) rounds); with it the least round has ([0-9]+\.[0-9]{2}) bits, without it ([0-9]+\.[0-9]{2}) bits$/;
const COVERED = /^covered: r=([0-9]+) e=([0-9]+) T=([0-9]+) C=([0-9]+) theta=([0-9]+) cap=([0-9]+) s=([0-9]+) sh=([0-9]+) positions=([0-9]+)\.\.([0-9]+) tokens=(none|[0-9]+\.\.[0-9]+) y=(yes|no) next-token=(yes|no) policy=(exact-match|clipped-gap) above-clip=([0-9]+) \(/;

function fail(message: string): never {
  throw new TypeError(`invalid acceptance expectations: ${message}`);
}

function bytes(value: unknown, name: string): Uint8Array {
  if (!(value instanceof Uint8Array)) fail(`${name} must be a Uint8Array`);
  return value.slice();
}

/** Validate and copy the caller's expectations before reading any of them twice. */
function expectations(value: AcceptanceExpectations): AcceptanceExpectations {
  if (!value || typeof value !== "object") fail("not an object");
  const { verifier, files, id, coverage, policy, allowProofOfWork, acceptTheoremOnCodes, completion } = value;
  if (!verifier || !SHA256.test(verifier.moduleSha256) || !SHA256.test(verifier.build)) fail("verifier");
  if (!files) fail("files");
  if (typeof id !== "string" || !SHA256.test(id)) fail("id");
  if (!coverage || ![coverage.r, coverage.e, coverage.T].every(Number.isSafeInteger)
    || !(coverage.r >= 0 && coverage.r < coverage.e && coverage.e <= coverage.T) || typeof coverage.requireY !== "boolean") {
    fail("coverage");
  }
  let ownPolicy: AcceptanceExpectations["policy"];
  if (policy?.kind === "exact-match") ownPolicy = { kind: "exact-match" };
  else if (policy?.kind === "clipped-gap" && [policy.C, policy.theta, policy.cap, policy.s].every(v => DECIMAL.test(v))
    && policy.sh === "8") {
    ownPolicy = { kind: "clipped-gap", C: policy.C, theta: policy.theta, cap: policy.cap, s: policy.s, sh: "8" };
  } else fail("policy");
  if (typeof allowProofOfWork !== "boolean" || typeof acceptTheoremOnCodes !== "boolean") fail("work or commitment");
  let ownCompletion: AcceptanceExpectations["completion"];
  if (completion?.kind === "partial") ownCompletion = { kind: "partial" };
  else if (completion?.kind === "complete" && Array.isArray(completion.endTokenIds) && completion.endTokenIds.length > 0
    && completion.endTokenIds.every(t => Number.isInteger(t) && t >= 0 && t <= 0xffffffff)) {
    ownCompletion = { kind: "complete", endTokenIds: [...completion.endTokenIds] };
  } else fail("completion");
  return {
    verifier: { moduleSha256: verifier.moduleSha256, build: verifier.build },
    files: { request: bytes(files.request, "files.request"), token: bytes(files.token, "files.token") },
    id, coverage: { r: coverage.r, e: coverage.e, T: coverage.T, requireY: coverage.requireY },
    policy: ownPolicy, allowProofOfWork, acceptTheoremOnCodes, completion: ownCompletion,
  };
}

function equalBytes(left: Uint8Array | null, right: Uint8Array): boolean {
  if (!left || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false;
  return true;
}

function words(file: Uint8Array): Uint32Array | null {
  if (file.length % 4 !== 0) return null;
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const out = new Uint32Array(file.length / 4);
  for (let index = 0; index < out.length; index++) out[index] = view.getUint32(index * 4, true);
  return out;
}

const yOnly = (want: AcceptanceExpectations) => want.coverage.r === want.coverage.T - 1;

function checkFiles(seen: CallEvidence, want: AcceptanceExpectations): boolean {
  const { request, token } = want.files;
  if (!equalBytes(seen.request, request) || !equalBytes(seen.token, token)) return false;
  const req = words(request), tok = words(token);
  const { r, e, T, requireY } = want.coverage;
  if (!req || !tok || tok.length !== 1 || req.length !== T + 2) return false;
  if (req[T] !== r || req[T + 1] !== e) return false;
  if (e < T && tok[0] !== 0) return false;
  return !requireY || e === T;
}

function checkVerdict(seen: CallEvidence, want: AcceptanceExpectations): boolean {
  const record = seen.record;
  if (seen.mode !== "whole" || seen.failure !== null || seen.exitCode !== 0 || seen.bitsGiven) return false;
  if (!record || record.status !== "0") return false;
  const policy = want.policy;
  const last = policy.kind === "exact-match" || yOnly(want) ? "YES"
    : `WITHIN LIMITS: clipped-gap C=${policy.C} theta=${policy.theta} cap=${policy.cap} s=${policy.s} sh=${policy.sh}`;
  return seen.lines.at(-1) === last;
}

function checkCoverage(seen: CallEvidence, want: AcceptanceExpectations): boolean {
  const record = seen.record;
  if (!record) return false;
  const { r, e, T, requireY } = want.coverage;
  const tokens = r === T - 1 ? "none" : `${r + 1}..${Math.min(e, T - 1)}`;
  const y = e === T ? "yes" : "no";
  if (record.r !== String(r) || record.e !== String(e) || record.T !== String(T)) return false;
  if (record.tokens !== tokens || record.y !== y || (requireY && y !== "yes")) return false;
  if (record.sh !== "8" || record.sT !== "4" || record.F !== "24" || record.dw !== "8") return false;
  const policy = want.policy;
  if (record.policy !== policy.kind) return false;
  if (record.claim !== (yOnly(want) ? "next-token" : policy.kind === "exact-match" ? "exact-match" : "policy")) return false;
  if (policy.kind === "clipped-gap" && (record.C !== policy.C || record.theta !== policy.theta
    || record.cap !== policy.cap || record.s !== policy.s)) return false;
  // One upstream routine builds `covered:` and `result-v1`; they must agree.
  const covered = seen.lines.filter(line => line.startsWith("covered: "));
  if (covered.length !== 1) return false;
  const match = COVERED.exec(covered[0]);
  if (!match) return false;
  const [, cr, ce, cT, cC, ctheta, ccap, cs, csh, from, to, ctokens, cy, , cpolicy, cabove] = match;
  return cr === record.r && ce === record.e && cT === record.T && cC === record.C && ctheta === record.theta
    && ccap === record.cap && cs === record.s && csh === record.sh && from === record.r && to === String(e - 1)
    && ctokens === record.tokens && cy === record.y && cpolicy === record.policy && cabove === record["above-clip"];
}

function checkWork(seen: CallEvidence, want: AcceptanceExpectations): boolean {
  const record = seen.record;
  const line = seen.lines.at(-3);
  if (!record || line === undefined) return false;
  if (line === NO_WORK) return record.work === "0" && record["work-rounds"] === "0";
  const match = WORK.exec(line);
  if (!want.allowProofOfWork || !match) return false;
  return record.work === match[1] && record["work-rounds"] === (match[2] ?? "1")
    && record["least-round"] === match[3] && record["least-round-without-work"] === match[4];
}

function checkCommitment(seen: CallEvidence, want: AcceptanceExpectations): boolean {
  const record = seen.record;
  const match = COMMITMENT.exec(seen.lines.at(-4) ?? "");
  if (!want.acceptTheoremOnCodes || !record || !match || record.record !== "1") return false;
  return record["commitment-assumed-rounds"] === (match[1] ?? "1");
}

function checkCompletion(seen: CallEvidence, want: AcceptanceExpectations): boolean {
  const completion = want.completion;
  if (completion.kind === "partial") return true;
  if (!equalBytes(seen.request, want.files.request) || !equalBytes(seen.token, want.files.token)) return false;
  const req = words(want.files.request), tok = words(want.files.token);
  const { r, e, T } = want.coverage;
  if (!req || !tok || req.length !== T + 2 || tok.length !== 1) return false;
  const checked = Array.from(req.subarray(r + 1, Math.min(e, T - 1) + 1));
  if (e === T) checked.push(tok[0]);
  const ends = new Set(completion.endTokenIds);
  return checked.length > 0 && ends.has(checked[checked.length - 1]) && !checked.slice(0, -1).some(t => ends.has(t));
}

/**
 * Decide acceptance for a result returned by this package's verify(). Each rule passes only on
 * positive evidence. A result without evidence (assembled, cloned or from another instance) fails all
 * eight. Throws TypeError for ill-typed expectations.
 */
export function checkAcceptance(result: object, expected: AcceptanceExpectations): AcceptanceDecision {
  const want = expectations(expected);
  const seen = result && typeof result === "object" ? evidence.get(result) : undefined;
  if (!seen) return Object.freeze({ accepted: false, failed: RULES });
  const passed: Record<AcceptanceRule, boolean> = {
    verifier: seen.moduleSha256 === want.verifier.moduleSha256 && seen.record?.build === want.verifier.build,
    files: checkFiles(seen, want),
    id: seen.id === want.id && seen.record?.id === want.id,
    verdict: checkVerdict(seen, want),
    coverage: checkCoverage(seen, want),
    work: checkWork(seen, want),
    commitment: checkCommitment(seen, want),
    completion: checkCompletion(seen, want),
  };
  const failed = RULES.filter(rule => !passed[rule]);
  return Object.freeze(failed.length === 0 ? { accepted: true } : { accepted: false, failed: Object.freeze(failed) });
}
