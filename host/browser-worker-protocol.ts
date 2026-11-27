/** Versioned messages between the browser supervisor and its dedicated worker (RFC-0007). */

import type { CapturedFile } from "./namespace.js";
import type { GuestResult } from "./replay.js";

/** The module is compiled on the calling side after its SHA-256 matched the trusted value. */
export type WorkerRequestV1 = Readonly<{
  schema: 1;
  requestId: number;
  argv: readonly string[];
  files: readonly CapturedFile[];
  module: WebAssembly.Module;
}>;

export type WorkerReplyV1 = Readonly<{ schema: 1; requestId: number; result: GuestResult }>;
