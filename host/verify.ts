/** The Node library entry: verify(files, args) on an in-memory call (R-API-2), and checkAcceptance (R-API-3). */

import { recordEvidence } from "./acceptance.js";
import type { CallEvidence } from "./acceptance.js";
import { captureCall } from "./namespace.js";
import type { FileSnapshot } from "./namespace.js";
import { loadGuest } from "./node-module.js";
import type { Guest } from "./node-module.js";
import { NodeSupervisor } from "./node-supervisor.js";
import { refusal } from "./replay.js";
import type { Failure, GuestResult } from "./replay.js";
import { decodeResult, missingRecord } from "./result.js";
import type { VerifyResult } from "./result.js";

export { checkAcceptance } from "./acceptance.js";
export type { AcceptanceDecision, AcceptanceExpectations, AcceptanceRule } from "./acceptance.js";
export type { HostFailure, ResultV1, Sha256, Verdict, VerifyResult } from "./result.js";
export type Files = ReadonlyMap<string, Uint8Array>;
export type VerifyOptions = Readonly<{ deadlineMs?: number }>;

// The largest request upstream reads: T = 2^20 tokens plus r and e, as 32-bit words.
const MAX_REQUEST_BYTES = ((1 << 20) + 2) * 4;
const VALUED = new Set(["-id", "-policy", "-j", "-bits"]);

let guest: Promise<Guest | undefined> | undefined;
const supervisor = new NodeSupervisor();

type Facts = Pick<CallEvidence, "mode" | "id" | "bitsGiven" | "request" | "token">;

function inputFailure(error: unknown): Failure {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "input-limit" ? "input-limit" : "invalid-input";
}

/** Copy what acceptance needs from the snapshot before its buffers move to the worker. */
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
 * Verify one call. Paths in `files` are canonical absolute virtual paths, and relative arguments
 * resolve from `/`. The map and arguments are copied before the first await, so the caller's
 * buffers stay attached and later changes cannot reach the call. The promise always resolves.
 */
export async function verify(files: Files, args: readonly string[], options: VerifyOptions = {}): Promise<VerifyResult> {
  let snapshot: FileSnapshot;
  let argv: readonly string[];
  let facts: Facts;
  try {
    if (!(files instanceof Map) || !Array.isArray(args)) throw new TypeError("verify(files: Map, args: string[])");
    snapshot = captureCall(files, ["cp_verify", ...args]);
    argv = snapshot.argv.slice(1);
    facts = argumentFacts(argv, snapshot);
  } catch (error) {
    return decodeResult(refusal(inputFailure(error)), []);
  }
  let result: GuestResult;
  let loaded: Guest | undefined;
  try {
    guest ??= loadGuest();
    loaded = await guest;
    if (!loaded) guest = undefined;
    result = loaded ? await supervisor.runFiles(loaded.module, snapshot, options) : refusal("integrity");
  } catch {
    result = refusal("host-internal");
  }
  let decoded = decodeResult(result, argv);
  // Malformed terminal output latches before any pass is published (error model).
  if (missingRecord(decoded, argv)) decoded = decodeResult(refusal("host-internal"), argv);
  if (loaded) {
    recordEvidence(decoded, {
      ...facts, moduleSha256: loaded.sha256, exitCode: decoded.exitCode, failure: decoded.failure,
      lines: decoded.stdoutLines, record: decoded.resultV1,
    });
  }
  return decoded;
}
