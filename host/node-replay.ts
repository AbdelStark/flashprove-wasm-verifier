import { createHash } from "node:crypto";
import type { InstanceDiagnostic } from "./diagnostics.js";
import type { RunLimits } from "./limits.js";
import type { CallSnapshot } from "./namespace.js";
import { replayGuest } from "./replay.js";

function createSha256() {
  const hash = createHash("sha256");
  return {
    update(bytes: Uint8Array) { hash.update(bytes); },
    digest() { return hash.digest("hex"); },
  };
}

export function runNodeGuest(module: WebAssembly.Module, capture: () => CallSnapshot, limits?: Partial<RunLimits>,
                             diagnostics?: (event: InstanceDiagnostic) => void) {
  return replayGuest(module, capture, createSha256, limits, diagnostics);
}
