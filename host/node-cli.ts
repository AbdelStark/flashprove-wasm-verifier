import type { Writable } from "node:stream";
import { loadGuest } from "./node-module.js";
import { NodeSupervisor } from "./node-supervisor.js";
import { refusal } from "./replay.js";
import type { GuestResult } from "./replay.js";

function write(stream: Writable, bytes: Uint8Array): Promise<boolean> {
  if (bytes.length === 0) return Promise.resolve(true);
  return new Promise(resolve => {
    const failed = () => resolve(false);
    stream.once("error", failed);
    try {
      stream.write(bytes, error => {
        // The error event can arrive after the write callback.
        if (!error) stream.off("error", failed);
        resolve(!error);
      });
    } catch {
      stream.off("error", failed);
      resolve(false);
    }
  });
}

export async function runCli(args: readonly string[], stdout: Writable, stderr: Writable): Promise<number> {
  const module = await loadGuest();
  let result: GuestResult;
  try {
    result = module ? await new NodeSupervisor().run(module, args) : refusal("integrity");
  } catch {
    result = refusal("host-internal");
  }
  const [outputDelivered, errorDelivered] = await Promise.all([write(stdout, result.stdout), write(stderr, result.stderr)]);
  return outputDelivered && errorDelivered ? result.status : 15;
}
