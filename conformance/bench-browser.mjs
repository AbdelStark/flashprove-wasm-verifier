/**
 * Time whole calls in a browser engine through the library's dedicated worker (R-PERF-1, R-PERF-2).
 * Usage: node conformance/bench-browser.mjs ENGINE FIXTURE SAMPLES -- ARGS...
 * Prints one JSON line: engine version, setup time, and per-call samples with exit and verdict.
 * Scope: fixture files already in page memory and the module compiled once at setup; each sample is
 * one verify() call from admission through the decoded verdict, in a fresh worker and fresh instances.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { chromium, firefox, webkit } from "playwright";

const [engineName, fixture, count, separator, ...args] = process.argv.slice(2);
if (!engineName || !fixture || !/^[1-9][0-9]*$/.test(count ?? "") || separator !== "--") {
  console.error("usage: bench-browser.mjs ENGINE FIXTURE SAMPLES -- ARGS...");
  process.exit(2);
}
const engines = { chromium, firefox, webkit };
const root = resolve(".");
const served = ["build/ts/host/", "build/wasm/", ".upstream/FlashProve/examples/"].map(prefix => resolve(prefix) + sep);
const types = { ".js": "text/javascript", ".wasm": "application/wasm" };
const fixtureRoot = join(".upstream/FlashProve/examples", fixture);
const names = [];
const walk = (directory, prefix) => {
  for (const name of readdirSync(directory)) {
    if (statSync(join(directory, name)).isDirectory()) walk(join(directory, name), `${prefix}${name}/`);
    else names.push(`${prefix}${name}`);
  }
};
walk(fixtureRoot, "");

const server = createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  if (path === "/") return response.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><title>bench</title>");
  const file = normalize(resolve(root, `.${path}`));
  if (!served.some(prefix => file.startsWith(prefix))) return response.writeHead(404).end();
  try {
    response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise(ready => server.listen(0, "127.0.0.1", ready));
const browser = await engines[engineName].launch();
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(0);
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result = await page.evaluate(async ({ fixture, names, args, samples, moduleSha256 }) => {
    const { createVerifier } = await import("/build/ts/host/browser.js");
    const files = new Map(await Promise.all(names.map(async name => {
      const response = await fetch(`/.upstream/FlashProve/examples/${fixture}/${name}`);
      return [`/${name}`, new Uint8Array(await response.arrayBuffer())];
    })));
    const setupStart = performance.now();
    const verifier = createVerifier({ moduleUrl: "/build/wasm/cp_verify.wasm", moduleSha256 });
    // A plan call loads, hashes and compiles the module; it is setup, not a sample.
    await verifier.verify(new Map(), ["-plan", "zero"]);
    const setupMs = performance.now() - setupStart;
    const runs = [];
    for (let index = 0; index < samples + 1; index++) {
      const started = performance.now();
      const verdict = await verifier.verify(files, args);
      runs.push({ ms: performance.now() - started, exitCode: verdict.exitCode, verdict: verdict.stdoutLines.at(-1) ?? "",
        failure: verdict.failure });
    }
    return { setupMs, runs };
  }, { fixture, names, args, samples: Number(count), moduleSha256: readFileSync("build/wasm/cp_verify.wasm.sha256", "ascii").trim() });
  const [warmup, ...samples] = result.runs;
  console.log(JSON.stringify({ engine: engineName, version: browser.version(), setupNs: Math.round(result.setupMs * 1e6),
    warmup: { ...warmup, ns: Math.round(warmup.ms * 1e6) },
    samples: samples.map(run => ({ ns: Math.round(run.ms * 1e6), exitCode: run.exitCode, verdict: run.verdict, failure: run.failure })) }));
} finally {
  await browser.close();
  server.close();
}
