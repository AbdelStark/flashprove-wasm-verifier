import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Writable } from "node:stream";
import { NodeSupervisor } from "./node-supervisor.js";
import { refusal } from "./replay.js";
import type { GuestResult } from "./replay.js";

const artifact = new URL("../../wasm/cp_verify.wasm", import.meta.url);

async function loadGuest(): Promise<WebAssembly.Module | undefined> {
  try {
    const [wasm, expected] = await Promise.all([
      readFile(artifact), readFile(new URL("cp_verify.wasm.sha256", artifact), "ascii"),
    ]);
    const digest = createHash("sha256").update(wasm).digest("hex");
    if (expected === `${digest}\n`) return await WebAssembly.compile(wasm);
  } catch {
    // A failed read or compilation has the same terminal result as a hash mismatch.
  }
}

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
