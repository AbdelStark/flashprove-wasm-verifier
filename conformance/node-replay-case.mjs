import { readFileSync } from "node:fs";
import { captureCliInputs } from "../build/ts/host/cli-input.js";
import { runNodeGuest } from "../build/ts/host/node-replay.js";

const module = new WebAssembly.Module(readFileSync(new URL("../build/wasm/cp_verify.wasm", import.meta.url)));
const result = runNodeGuest(module, () => captureCliInputs(process.argv.slice(2)));
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exitCode = result.status;
