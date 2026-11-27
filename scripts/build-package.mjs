#!/usr/bin/env node
// Stage and pack the npm archive: CLI, runtime entries with declarations, the audited module and
// all notices. Writes build/package/, the .tgz and an inventory of both the package and the demo.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

// A release sets FPV_VERSION; local builds stay on the prerelease line.
const VERSION = process.env.FPV_VERSION ?? "1.0.0-alpha.0";
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/.test(VERSION)) throw new Error(`${VERSION} is not a SemVer version`);
const stage = "build/package";
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const walk = directory => readdirSync(directory).flatMap(name => {
  const path = join(directory, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});
const copy = (from, to = from) => { mkdirSync(dirname(join(stage, to)), { recursive: true }); cpSync(from, join(stage, to), { recursive: true }); };

const wasm = readFileSync("build/wasm/cp_verify.wasm");
if (readFileSync("build/wasm/cp_verify.wasm.sha256", "ascii") !== `${sha256(wasm)}\n`) {
  throw new Error("build/wasm/cp_verify.wasm does not match its audited checksum");
}
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

// Runtime code: every compiled host module and its declarations, nothing from tests or the demo.
for (const file of walk("build/ts/host")) {
  if (/\.(js|d\.ts)$/.test(file) && !file.includes(`${join("host", "test")}`)) copy(file);
}
for (const file of ["cp_verify.wasm", "cp_verify.wasm.sha256", "source.sha256", "port.sha256"]) copy(join("build/wasm", file));
copy("bin/fpv");
copy("LICENSE");
copy("NOTICE");
for (const file of ["NOTICE", "LICENSE", "THIRD_PARTY.md", "licenses"]) copy(join(".upstream/FlashProve", file), join("notices/FlashProve", file));
copy("port/notices/wasi-libc", "notices/wasi-libc");
copy("port/notices/README.md", "notices/TOOLCHAIN.md");
copy("host/PACKAGE.md", "README.md");

const entry = (name, runtime = name) => ({ types: `./build/ts/host/${runtime}.d.ts`, default: `./build/ts/host/${runtime}.js` });
const manifest = {
  name: "flashprove-wasm-verifier",
  version: VERSION,
  description: "FlashProve's cp_verify compiled to WebAssembly, with the Node CLI, a typed library and a browser worker.",
  license: "Apache-2.0",
  type: "module",
  engines: { node: ">=24" },
  bin: { fpv: "bin/fpv" },
  // Runtime chosen statically by export conditions, never by probing globals (RFC-0007).
  exports: {
    ".": { browser: entry("browser"), default: entry("verify") },
    "./node": entry("verify"),
    "./browser": entry("browser"),
    "./worker": "./build/ts/host/browser-worker.js",
    "./cp_verify.wasm": "./build/wasm/cp_verify.wasm",
    "./package.json": "./package.json",
  },
  types: "./build/ts/host/verify.d.ts",
  sideEffects: ["./build/ts/host/browser-worker.js", "./build/ts/host/node-worker.js"],
};
writeFileSync(join(stage, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const packed = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", "build", `./${stage}`], { encoding: "utf8" }))[0];
const archive = join("build", packed.filename);

// No fixture bytes in the archive: no file may equal any published example file.
const fixtureDigests = new Set();
for (const example of readdirSync(".upstream/FlashProve/examples")) {
  const sums = join(".upstream/FlashProve/examples", example, "SHA256SUMS");
  if (existsSync(sums)) for (const line of readFileSync(sums, "utf8").trim().split("\n")) fixtureDigests.add(line.slice(0, 64));
}
const files = walk(stage).map(path => {
  const bytes = readFileSync(path);
  return { path: relative(stage, path), bytes: bytes.length, sha256: sha256(bytes) };
}).sort((a, b) => a.path.localeCompare(b.path));
const leaked = files.filter(file => fixtureDigests.has(file.sha256) || /\.(proof|req|y)$|key\.bin$|leaf\//.test(file.path));
if (leaked.length) throw new Error(`fixture bytes in the package: ${leaked.map(file => file.path).join(", ")}`);
for (const required of ["LICENSE", "NOTICE", "notices/FlashProve/NOTICE", "notices/FlashProve/THIRD_PARTY.md",
  "notices/wasi-libc/LICENSE", "notices/wasi-libc/musl-COPYRIGHT", "build/wasm/cp_verify.wasm", "bin/fpv"]) {
  if (!files.some(file => file.path === required)) throw new Error(`package is missing ${required}`);
}

const demo = existsSync("build/demo/manifest.json") ? walk("build/demo").map(path => {
  const bytes = readFileSync(path);
  return { path: relative("build/demo", path), bytes: bytes.length, sha256: sha256(bytes) };
}).sort((a, b) => a.path.localeCompare(b.path)) : null;
const inventory = {
  schema: 1, version: VERSION, archive: { path: packed.filename, bytes: readFileSync(archive).length, sha256: sha256(readFileSync(archive)) },
  moduleSha256: sha256(wasm), files, demo,
};
writeFileSync("build/package-inventory.json", `${JSON.stringify(inventory, null, 2)}\n`);
console.log(`package: ${archive}, ${files.length} files, no fixture bytes; inventory in build/package-inventory.json`
  + (demo ? `, demo ${demo.length} files` : ", demo not built"));
