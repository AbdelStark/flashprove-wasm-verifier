/** The runtime-independent edges of a library call: admission before the first await, and publication. */

import { recordEvidence } from "./acceptance.js";
import type { CallEvidence } from "./acceptance.js";
import { captureCall } from "./namespace.js";
import type { FileSnapshot } from "./namespace.js";
import { refusal } from "./replay.js";
import type { Failure, GuestResult } from "./replay.js";
import { decodeResult, missingRecord } from "./result.js";
import type { VerifyResult } from "./result.js";

export type Files = ReadonlyMap<string, Uint8Array>;
export type VerifyOptions = Readonly<{ deadlineMs?: number }>;

// The largest request upstream reads: T = 2^20 tokens plus r and e, as 32-bit words.
const MAX_REQUEST_BYTES = ((1 << 20) + 2) * 4;
const VALUED = new Set(["-id", "-policy", "-j", "-bits"]);

type Facts = Pick<CallEvidence, "mode" | "id" | "bitsGiven" | "request" | "token">;
export type AdmittedCall = Readonly<{ snapshot: FileSnapshot; argv: readonly string[]; facts: Facts }>;

function inputFailure(error: unknown): Failure {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "input-limit" ? "input-limit" : "invalid-input";
}

/** Copy what acceptance needs from the snapshot before its buffers move to a worker. */
function argumentFacts(argv: readonly string[], snapshot: FileSnapshot): Facts {
  const first = argv[0];
  const mode = first === "-key" ? "key" : first === "-leaf" ? "leaf" : first === "-plan" ? "plan" : "whole";
  const ids: string[] = [];
  const bitsGiven = argv.includes("-bits");
  for (let index = 5; mode === "whole" && index < argv.length; index++) {
    const option = argv[index];
    if (option === "-id") ids.push(argv[index + 1] ?? "");
    if (VALUED.has(option)) index++;
  }
  // Only a path that names a captured file exactly is bound; anything else leaves the binding unproved.
  const file = (operand: string | undefined): Uint8Array | null => {
    if (mode !== "whole" || operand === undefined) return null;
    const path = operand.startsWith("/") ? operand : `/${operand}`;
    const entry = snapshot.files.find(([name]) => name === path);
    return entry && entry[1].length <= MAX_REQUEST_BYTES ? entry[1].slice() : null;
  };
  return { mode, id: ids.length === 1 ? ids[0] : null, bitsGiven, request: file(argv[2]), token: file(argv[3]) };
}

/**
 * Copy the caller's map and arguments synchronously. Call this before any await, so the caller's
 * buffers stay attached and later changes cannot reach the call. A refusal is already decoded.
 */
export function admit(files: Files, args: readonly string[]): AdmittedCall | VerifyResult {
  try {
    if (!(files instanceof Map) || !Array.isArray(args)) throw new TypeError("verify(files: Map, args: string[])");
    const snapshot = captureCall(files, ["cp_verify", ...args]);
    const argv = snapshot.argv.slice(1);
    return Object.freeze({ snapshot, argv, facts: argumentFacts(argv, snapshot) });
  } catch (error) {
    return decodeResult(refusal(inputFailure(error)), []);
  }
}

/** Decode, latch malformed terminal output and bind evidence to the exact object returned. */
export function publish(call: AdmittedCall, result: GuestResult, moduleSha256: string | null): VerifyResult {
  let decoded = decodeResult(result, call.argv);
  // Malformed terminal output latches before any pass is published (error model).
  if (missingRecord(decoded, call.argv)) decoded = decodeResult(refusal("host-internal"), call.argv);
  if (moduleSha256 !== null) {
    recordEvidence(decoded, {
      ...call.facts, moduleSha256, exitCode: decoded.exitCode, failure: decoded.failure,
      lines: decoded.stdoutLines, record: decoded.resultV1,
    });
  }
  return decoded;
}
