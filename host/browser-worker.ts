/** The dedicated browser worker: one call, fresh instances, then close (RFC-0007). */

import type { WorkerReplyV1, WorkerRequestV1 } from "./browser-worker-protocol.js";
import { captureCall } from "./namespace.js";
import { replayGuest } from "./replay.js";
import { createSha256 } from "./sha256.js";

type WorkerScope = {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: WorkerReplyV1, transfer: Transferable[]): void;
  close(): void;
};
const scope = globalThis as unknown as WorkerScope;

scope.onmessage = event => {
  scope.onmessage = null;
  const request = event.data as Partial<WorkerRequestV1> | null;
  if (!request || request.schema !== 1 || !Number.isSafeInteger(request.requestId) || (request.requestId ?? 0) < 1
    || !(request.module instanceof WebAssembly.Module) || !Array.isArray(request.argv) || request.argv[0] !== "cp_verify"
    || !Array.isArray(request.files)) {
    throw new Error("invalid verifier request");
  }
  const { argv, files, module, requestId } = request as WorkerRequestV1;
  const result = replayGuest(module, () => captureCall(new Map(files), argv), createSha256);
  const stdout = result.stdout.slice(), stderr = result.stderr.slice();
  scope.postMessage({ schema: 1, requestId, result: { ...result, stdout, stderr } }, [stdout.buffer, stderr.buffer]);
  scope.close();
};
