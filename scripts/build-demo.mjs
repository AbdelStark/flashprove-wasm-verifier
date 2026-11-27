#!/usr/bin/env node
// Build the offline demo bundle in build/demo from the audited module and hash-checked public examples.
// Fixture bytes are generated here and never committed.

import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { build } from "esbuild";

const out = "build/demo";
const examples = ".upstream/FlashProve/examples";
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const lock = (file, key) => readFileSync(file, "utf8").match(new RegExp(`^${key}=(.+)$`, "m"))?.[1]?.trim();

const FIXTURES = [
  { id: "accepted-proof", title: "Exact match", policyArgs: [], policy: { kind: "exact-match" } },
  {
    id: "accepted-proof-clipped-gap", title: "Clipped gap",
    policyArgs: ["-policy", "clipped-gap,9244130,323343,1,16,8"],
    policy: { kind: "clipped-gap", C: "9244130", theta: "323343", cap: "1", s: "16", sh: "8" },
  },
];

const wasm = readFileSync("build/wasm/cp_verify.wasm");
const moduleSha256 = sha256(wasm);
if (readFileSync("build/wasm/cp_verify.wasm.sha256", "ascii") !== `${moduleSha256}\n`) {
  throw new Error("build/wasm/cp_verify.wasm does not match its audited checksum");
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const fixtures = FIXTURES.map(fixture => {
  const sums = readFileSync(join(examples, fixture.id, "SHA256SUMS"), "utf8").trim().split("\n");
  const files = sums.map(line => {
    const match = /^([0-9a-f]{64}) {2}([A-Za-z0-9_./-]+)$/.exec(line);
    if (!match || match[2].includes("..")) throw new Error(`${fixture.id}: unexpected SHA256SUMS line`);
    const [, digest, path] = match;
    const bytes = readFileSync(join(examples, fixture.id, path));
    if (sha256(bytes) !== digest) throw new Error(`${fixture.id}/${path} fails its SHA256SUMS`);
    const target = join(out, "fixtures", fixture.id, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    return { path, sha256: digest, bytes: bytes.length };
  });
  return { ...fixture, files };
});

cpSync("build/wasm/cp_verify.wasm", join(out, "cp_verify.wasm"));
cpSync("demo/index.html", join(out, "index.html"));
const bundle = { bundle: true, format: "esm", target: "es2022", legalComments: "inline", logLevel: "warning" };
await build({ ...bundle, entryPoints: ["host/browser-worker.ts"], outfile: join(out, "worker.js") });
await build({ ...bundle, entryPoints: ["demo/demo.ts"], outfile: join(out, "demo.js") });

const manifest = {
  schema: 1,
  upstreamCommit: lock("upstream.lock", "FLASHPROVE_COMMIT"),
  moduleSha256,
  build: readFileSync("build/wasm/source.sha256", "ascii").trim(),
  fixtures,
};
writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`demo: build/demo with ${fixtures.length} fixtures and module ${moduleSha256.slice(0, 12)}`);
