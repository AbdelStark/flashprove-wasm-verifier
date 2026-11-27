/** Load the audited module beside the host and check it against the build's checksum. */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const artifact = new URL("../../wasm/cp_verify.wasm", import.meta.url);

/** Resolves to undefined for an unreadable, mismatched or uncompilable module. */
export async function loadGuest(): Promise<WebAssembly.Module | undefined> {
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
