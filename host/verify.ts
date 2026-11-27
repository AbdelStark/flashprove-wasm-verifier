/** The Node library entry: verify(files, args) on an in-memory call (R-API-2). */

import { captureCall } from "./namespace.js";
import type { FileSnapshot } from "./namespace.js";
import { loadGuest } from "./node-module.js";
import { NodeSupervisor } from "./node-supervisor.js";
import { refusal } from "./replay.js";
import type { Failure, GuestResult } from "./replay.js";
import { decodeResult, missingRecord } from "./result.js";
import type { VerifyResult } from "./result.js";

export type { HostFailure, ResultV1, Sha256, Verdict, VerifyResult } from "./result.js";
export type Files = ReadonlyMap<string, Uint8Array>;
export type VerifyOptions = Readonly<{ deadlineMs?: number }>;

let guest: Promise<WebAssembly.Module | undefined> | undefined;
const supervisor = new NodeSupervisor();

function inputFailure(error: unknown): Failure {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "input-limit" ? "input-limit" : "invalid-input";
}

/**
 * Verify one call. Paths in `files` are canonical absolute virtual paths, and relative arguments
 * resolve from `/`. The map and arguments are copied before the first await, so the caller's
 * buffers stay attached and later changes cannot reach the call. The promise always resolves.
 */
export async function verify(files: Files, args: readonly string[], options: VerifyOptions = {}): Promise<VerifyResult> {
  let snapshot: FileSnapshot;
  let argv: readonly string[];
  try {
    if (!(files instanceof Map) || !Array.isArray(args)) throw new TypeError("verify(files: Map, args: string[])");
    snapshot = captureCall(files, ["cp_verify", ...args]);
    argv = snapshot.argv.slice(1);
  } catch (error) {
    return decodeResult(refusal(inputFailure(error)), []);
  }
  let result: GuestResult;
  try {
    guest ??= loadGuest();
    const module = await guest;
    if (!module) guest = undefined;
    result = module ? await supervisor.runFiles(module, snapshot, options) : refusal("integrity");
  } catch {
    result = refusal("host-internal");
  }
  const decoded = decodeResult(result, argv);
  // Malformed terminal output latches before any pass is published (error model).
  return missingRecord(decoded, argv) ? decodeResult(refusal("host-internal"), argv) : decoded;
}
