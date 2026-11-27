/** The Node library entry: verify(files, args) on an in-memory call (R-API-2), and checkAcceptance (R-API-3). */

import { admit, publish } from "./call.js";
import type { Files, VerifyOptions } from "./call.js";
import { loadGuest } from "./node-module.js";
import type { Guest } from "./node-module.js";
import { NodeSupervisor } from "./node-supervisor.js";
import { refusal } from "./replay.js";
import type { GuestResult } from "./replay.js";
import type { VerifyResult } from "./result.js";

export { checkAcceptance } from "./acceptance.js";
export type { AcceptanceDecision, AcceptanceExpectations, AcceptanceRule } from "./acceptance.js";
export type { Files, VerifyOptions } from "./call.js";
export type { HostFailure, ResultV1, Sha256, Verdict, VerifyResult } from "./result.js";

let guest: Promise<Guest | undefined> | undefined;
const supervisor = new NodeSupervisor();

/**
 * Verify one call. Paths in `files` are canonical absolute virtual paths, and relative arguments
 * resolve from `/`. The map and arguments are copied before the first await, so the caller's
 * buffers stay attached and later changes cannot reach the call. The promise always resolves.
 */
export async function verify(files: Files, args: readonly string[], options: VerifyOptions = {}): Promise<VerifyResult> {
  const call = admit(files, args);
  if (!("snapshot" in call)) return call;
  let result: GuestResult;
  let loaded: Guest | undefined;
  try {
    guest ??= loadGuest();
    loaded = await guest;
    if (!loaded) guest = undefined;
    result = loaded ? await supervisor.runFiles(loaded.module, call.snapshot, options) : refusal("integrity");
  } catch {
    result = refusal("host-internal");
  }
  return publish(call, result, loaded?.sha256 ?? null);
}
