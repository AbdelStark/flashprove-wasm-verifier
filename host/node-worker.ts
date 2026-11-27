import { isAbsolute } from "node:path";
import { parentPort } from "node:worker_threads";
import { captureCliInputs } from "./cli-input.js";
import { MAX_INSTANCE_DIAGNOSTICS } from "./diagnostics.js";
import type { InstanceDiagnostic } from "./diagnostics.js";
import { captureCall } from "./namespace.js";
import { runNodeGuest } from "./node-replay.js";
import type { NodeWorkerReply, NodeWorkerRequest } from "./node-worker-protocol.js";

const port = parentPort;
if (!port) throw new Error("missing verifier supervisor");

port.once("message", (value: unknown) => {
  if (!value || typeof value !== "object") throw new Error("invalid verifier request");
  const request = value as Partial<NodeWorkerRequest>;
  if (request.schema !== 1 || typeof request.requestId !== "number" || !Number.isSafeInteger(request.requestId)
    || request.requestId < 1 || !(request.module instanceof WebAssembly.Module)
    || !Array.isArray(request.argv) || request.argv[0] !== "cp_verify"
    || (request.diagnostics !== undefined && request.diagnostics !== true)
    || (request.files === undefined) === (request.workingDirectory === undefined)
    || (request.files !== undefined && !Array.isArray(request.files))
    || (request.workingDirectory !== undefined
      && (typeof request.workingDirectory !== "string" || !isAbsolute(request.workingDirectory)))) {
    throw new Error("invalid verifier request");
  }
  const { argv, workingDirectory, files, module } = request;
  const diagnostics: InstanceDiagnostic[] | undefined = request.diagnostics ? [] : undefined;
  const capture = files ? () => captureCall(new Map(files), argv) : () => captureCliInputs(argv.slice(1), workingDirectory!);
  const result = runNodeGuest(module, capture, undefined,
    diagnostics ? event => { if (diagnostics.length < MAX_INSTANCE_DIAGNOSTICS) diagnostics.push(event); } : undefined);
  const stdout = result.stdout.slice(), stderr = result.stderr.slice();
  const reply: NodeWorkerReply = { schema: 1, requestId: request.requestId, result: { ...result, stdout, stderr },
    ...(diagnostics ? { diagnostics } : {}) };
  // The once listener is gone, so the worker exits on its own; Deno's parentPort has no close().
  port.postMessage(reply, [stdout.buffer, stderr.buffer]);
});
