/** Decode a terminal call result. Only a complete whole-call suffix yields a `result-v1` record. */

import type { Failure } from "./diagnostics.js";
import type { GuestResult } from "./replay.js";

export type HostFailure = Failure;
export type Sha256 = string;
export type Verdict =
  | "YES" | "WITHIN LIMITS" | "PART PASSED" | "NO"
  | "NOT CHECKED" | "NOT-A-VERIFICATION" | "PLAN ONLY" | null;

export type ResultV1 = Readonly<{
  status: "0" | "14"; claim: "next-token" | "exact-match" | "policy";
  id: Sha256 | "not-shown-without-id"; bits: string;
  work: string; "work-rounds": string; "least-round": string;
  "least-round-without-work": string; "commitment-assumed-rounds": string;
  record: "1"; r: string; e: string; T: string; tokens: string; y: "yes" | "no";
  policy: "exact-match" | "clipped-gap"; C: string; theta: string; cap: string;
  s: string; sh: string; sT: string; F: string; "above-clip": string; leaf: string;
  stages: "key,leaf,request"; dw: "8"; build: Sha256;
}>;

export type VerifyResult = Readonly<{
  exitCode: number; stdout: Uint8Array; stderr: Uint8Array;
  stdoutLines: readonly string[]; stderrLines: readonly string[];
  verdict: Verdict; resultV1: ResultV1 | null; failure: HostFailure | null;
}>;

const whole = "(?:0|[1-9][0-9]{0,19})";
const hex = "[0-9a-f]{64}";
const figure = `${whole}\\.[0-9]{2}`;
// Pinned field order and value forms from FORMAT.md 14.8 at the upstream lock.
const FIELDS: readonly (readonly [name: keyof ResultV1, form: string])[] = [
  ["status", "0|14"], ["claim", "next-token|exact-match|policy"], ["id", `${hex}|not-shown-without-id`],
  ["bits", whole], ["work", "[0-9]|[12][0-9]|3[0-2]"], ["work-rounds", whole],
  ["least-round", figure], ["least-round-without-work", figure], ["commitment-assumed-rounds", whole],
  ["record", "1"], ["r", whole], ["e", whole], ["T", whole], ["tokens", `none|${whole}\\.\\.${whole}`],
  ["y", "yes|no"], ["policy", "exact-match|clipped-gap"], ["C", whole], ["theta", whole], ["cap", whole],
  ["s", whole], ["sh", whole], ["sT", whole], ["F", whole], ["above-clip", whole], ["leaf", whole],
  ["stages", "key,leaf,request"], ["dw", "8"], ["build", hex],
];
const RESULT_LINE = new RegExp(`^result-v1 ${FIELDS.map(([name, form]) => `${name}=(${form})`).join(" ")}$`);

const VERDICT_FOR_EXIT: ReadonlyMap<number, readonly [prefix: string, verdict: Exclude<Verdict, null>]> = new Map([
  [0, ["WITHIN LIMITS: ", "WITHIN LIMITS"]], [1, ["NO: ", "NO"]], [3, ["PART PASSED: ", "PART PASSED"]],
  [5, ["NOT CHECKED: ", "NOT CHECKED"]],
]);
const EXACT_FOR_EXIT: ReadonlyMap<number, readonly [line: string, verdict: Exclude<Verdict, null>]> = new Map([
  [0, ["YES", "YES"]], [4, ["PLAN ONLY: no proof was checked", "PLAN ONLY"]], [14, ["NOT-A-VERIFICATION", "NOT-A-VERIFICATION"]],
]);

/** Split on LF only, keep empty interior lines and drop the final delimiter. Comparisons use the bytes. */
export function splitLines(bytes: Uint8Array): string[] {
  if (bytes.length === 0) return [];
  const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
  const lines = text.split("\n");
  if (bytes[bytes.length - 1] === 10) lines.pop();
  return lines;
}

/** The verdict that the last line names, only when the exit code agrees with it. */
export function verdictOf(exitCode: number, lines: readonly string[]): Verdict {
  const last = lines.at(-1);
  if (last === undefined) return null;
  const exact = EXACT_FOR_EXIT.get(exitCode);
  if (exact && last === exact[0]) return exact[1];
  const prefixed = VERDICT_FOR_EXIT.get(exitCode);
  if (prefixed && last.startsWith(prefixed[0]) && last.length > prefixed[0].length) return prefixed[1];
  return null;
}

function isWholeCall(args: readonly string[]): boolean {
  return args[0] !== "-key" && args[0] !== "-leaf" && args[0] !== "-plan";
}

/**
 * Parse the `result-v1` record of a whole call at exit 0 or 14. Returns null unless the four closing
 * lines, the field grammar, the request range and the verdict all agree.
 */
export function parseResultV1(exitCode: number, lines: readonly string[]): ResultV1 | null {
  if (exitCode !== 0 && exitCode !== 14) return null;
  if (lines.length < 4 || lines.some(line => line.startsWith("TEST BUILD:"))) return null;
  if (lines.filter(line => line.startsWith("result-v1 ")).length !== 1) return null;
  const [commitment, work, record, last] = lines.slice(-4);
  if (!commitment.startsWith("commitment: ") || !work.startsWith("proof of work: ")) return null;
  const match = RESULT_LINE.exec(record);
  if (!match) return null;
  const fields: Record<string, string> = {};
  FIELDS.forEach(([name], index) => { fields[name] = match[index + 1]; });
  const value = fields as ResultV1;
  if (value.status !== String(exitCode)) return null;
  if ((value.work === "0") !== (value["work-rounds"] === "0")) return null;
  const r = BigInt(value.r), e = BigInt(value.e), T = BigInt(value.T);
  if (!(r < e && e <= T)) return null;
  const lastChecked = e < T - 1n ? e : T - 1n;
  const tokens = r === T - 1n ? "none" : `${r + 1n}..${lastChecked}`;
  if (value.tokens !== tokens || value.y !== (e === T ? "yes" : "no")) return null;
  if (exitCode === 14) return last === "NOT-A-VERIFICATION" ? Object.freeze(value) : null;
  const expected = value.claim === "policy"
    ? `WITHIN LIMITS: ${value.policy} C=${value.C} theta=${value.theta} cap=${value.cap} s=${value.s} sh=${value.sh}`
    : "YES";
  return last === expected ? Object.freeze(value) : null;
}

/**
 * Build the public view of a terminal result. A whole call that claims exit 0 or 14 without a valid
 * record is malformed terminal output: the caller must latch it as a host failure before publishing.
 */
export function decodeResult(result: GuestResult, args: readonly string[]): VerifyResult {
  const stdoutLines = Object.freeze(splitLines(result.stdout));
  const stderrLines = Object.freeze(splitLines(result.stderr));
  const exitCode = result.status;
  const resultV1 = result.failure === null && isWholeCall(args) ? parseResultV1(exitCode, stdoutLines) : null;
  return Object.freeze({
    exitCode, stdout: result.stdout, stderr: result.stderr, stdoutLines, stderrLines,
    verdict: verdictOf(exitCode, stdoutLines), resultV1, failure: result.failure,
  });
}

/** True when a whole call ended at exit 0 or 14 but its closing record did not decode. */
export function missingRecord(result: VerifyResult, args: readonly string[]): boolean {
  return result.failure === null && isWholeCall(args) && (result.exitCode === 0 || result.exitCode === 14)
    && result.resultV1 === null;
}
