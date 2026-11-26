import { createHash } from "node:crypto";
import type { CallSnapshot } from "./namespace.js";
import { replayGuest } from "./replay.js";

function createSha256() {
  const hash = createHash("sha256");
  return {
    update(bytes: Uint8Array) { hash.update(bytes); },
    digest() { return hash.digest("hex"); },
  };
}

export function runNodeGuest(module: WebAssembly.Module, snapshot: CallSnapshot) {
  return replayGuest(module, snapshot, createSha256);
}
