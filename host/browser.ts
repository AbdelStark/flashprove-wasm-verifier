/** The browser library entry (R-API-2, R-API-3): verification runs in a dedicated worker. */

import { BrowserSupervisor } from "./browser-supervisor.js";
import { admit, publish } from "./call.js";
import type { Files, VerifyOptions } from "./call.js";
import { refusal } from "./replay.js";
import type { GuestResult } from "./replay.js";
import type { VerifyResult } from "./result.js";

export { checkAcceptance } from "./acceptance.js";
export type { AcceptanceDecision, AcceptanceExpectations, AcceptanceRule } from "./acceptance.js";
export type { Files, VerifyOptions } from "./call.js";
export type { HostFailure, ResultV1, Sha256, Verdict, VerifyResult } from "./result.js";

export type BrowserVerifierOptions = Readonly<{
  /** Where to fetch the module. */
  moduleUrl: string | URL;
  /** The SHA-256 the caller trusts, from release metadata. Bytes with another digest are never compiled. */
  moduleSha256: string;
  /** Defaults to the worker beside this file. */
  workerUrl?: string | URL;
}>;

export type BrowserVerifier = Readonly<{
  verify(files: Files, args: readonly string[], options?: VerifyOptions): Promise<VerifyResult>;
}>;

type Guest = Readonly<{ module: WebAssembly.Module; sha256: string }>;

async function loadGuest(url: string | URL, expected: string): Promise<Guest | undefined> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return;
    const bytes = await response.arrayBuffer();
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      byte => byte.toString(16).padStart(2, "0")).join("");
    if (digest === expected) return { module: await WebAssembly.compile(bytes), sha256: digest };
  } catch {
    // An unreadable or uncompilable module has the same terminal result as a hash mismatch.
  }
}

/** Create a verifier bound to one trusted module. One call runs at a time; another resolves `busy`. */
export function createVerifier(options: BrowserVerifierOptions): BrowserVerifier {
  if (!/^[0-9a-f]{64}$/.test(options.moduleSha256)) throw new TypeError("moduleSha256 must be 64 lowercase hex digits");
  const workerUrl = options.workerUrl ?? new URL("./browser-worker.js", import.meta.url);
  const supervisor = new BrowserSupervisor({ start: () => new Worker(workerUrl, { type: "module" }) });
  let guest: Promise<Guest | undefined> | undefined;
  return Object.freeze({
    async verify(files: Files, args: readonly string[], callOptions: VerifyOptions = {}): Promise<VerifyResult> {
      const call = admit(files, args);
      if (!("snapshot" in call)) return call;
      let result: GuestResult;
      let loaded: Guest | undefined;
      try {
        guest ??= loadGuest(options.moduleUrl, options.moduleSha256);
        loaded = await guest;
        if (!loaded) guest = undefined;
        result = loaded ? await supervisor.run(loaded.module, call.snapshot, callOptions) : refusal("integrity");
      } catch {
        result = refusal("host-internal");
      }
      return publish(call, result, loaded?.sha256 ?? null);
    },
  });
}
