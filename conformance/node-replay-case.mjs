import { readFileSync } from "node:fs";
import { NodeSupervisor } from "../build/ts/host/node-supervisor.js";

const module = new WebAssembly.Module(readFileSync(new URL("../build/wasm/cp_verify.wasm", import.meta.url)));
const result = await new NodeSupervisor().run(module, process.argv.slice(2));
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exitCode = result.status;
