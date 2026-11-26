import { parentPort } from "node:worker_threads";

parentPort.once("message", request => {
  const mode = request.argv[2];
  if (mode === "lost") process.exit(7);
  const stdout = new TextEncoder().encode("PLAN ONLY: no proof was checked\n");
  const result = { status: 4, failure: null, stdout, stderr: new Uint8Array(0) };
  parentPort.postMessage({ schema: 1, requestId: request.requestId, result });
  if (mode === "reply-then-lost") process.exit(7);
  parentPort.close();
});
