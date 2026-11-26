import { isAbsolute } from "node:path";
import { parentPort } from "node:worker_threads";
import { captureCliInputs } from "./cli-input.js";
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
    || typeof request.workingDirectory !== "string" || !isAbsolute(request.workingDirectory)) {
    throw new Error("invalid verifier request");
  }
  const { argv, workingDirectory, module } = request;
  const result = runNodeGuest(module, () => captureCliInputs(argv.slice(1), workingDirectory));
  const stdout = result.stdout.slice(), stderr = result.stderr.slice();
  const reply: NodeWorkerReply = { schema: 1, requestId: request.requestId, result: { ...result, stdout, stderr } };
  port.postMessage(reply, [stdout.buffer, stderr.buffer]);
  port.close();
});
