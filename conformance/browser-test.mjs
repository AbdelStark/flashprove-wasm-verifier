/** Run the browser library in Chromium: published proofs in a dedicated worker, integrity and liveness (#35). */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, normalize, resolve, sep } from "node:path";
import { chromium } from "playwright";

const root = resolve(".");
const served = ["build/ts/host/", "build/wasm/", ".upstream/FlashProve/examples/"].map(prefix => resolve(prefix) + sep);
const types = { ".js": "text/javascript", ".wasm": "application/wasm", ".html": "text/html" };
const moduleSha256 = readFileSync("build/wasm/cp_verify.wasm.sha256", "ascii").trim();
const build = readFileSync("build/wasm/source.sha256", "ascii").trim();

const server = createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  if (path === "/") {
    response.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><title>fpv</title>");
    return;
  }
  if (path === "/tampered.wasm") {
    const bytes = readFileSync("build/wasm/cp_verify.wasm");
    bytes[bytes.length - 1] ^= 1;
    response.writeHead(200, { "content-type": "application/wasm" }).end(bytes);
    return;
  }
  const file = normalize(resolve(root, `.${path}`));
  if (!served.some(prefix => file.startsWith(prefix))) {
    response.writeHead(404).end();
    return;
  }
  try {
    const bytes = readFileSync(file);
    response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(bytes);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise(ready => server.listen(0, "127.0.0.1", ready));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();

try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error));
  await page.goto(origin);
  const outcome = await page.evaluate(async ({ moduleSha256, build }) => {
    const { createVerifier, checkAcceptance } = await import("/build/ts/host/browser.js");
    const { BrowserSupervisor } = await import("/build/ts/host/browser-supervisor.js");
    const { captureCall } = await import("/build/ts/host/namespace.js");
    const names = ["ID.txt", "config/KL.bin", "config/layout.txt", "config/policy.txt", "ivk/key.bin", "ivk/leaf/0.bin",
      "example.req", "example.y", "example.proof"];
    const load = async fixture => new Map(await Promise.all(names.map(async name => {
      const response = await fetch(`/.upstream/FlashProve/examples/${fixture}/${name}`);
      if (!response.ok) throw new Error(`missing ${fixture}/${name}`);
      return [`/${name}`, new Uint8Array(await response.arrayBuffer())];
    })));
    const words = bytes => { const view = new DataView(bytes.buffer); return Array.from({ length: bytes.length / 4 }, (_, i) => view.getUint32(i * 4, true)); };
    const verifier = createVerifier({ moduleUrl: "/build/wasm/cp_verify.wasm", moduleSha256 });
    const summary = async (files, args, policy) => {
      const id = new TextDecoder().decode(files.get("/ID.txt")).trim();
      // Measure main-thread liveness while the guest runs in the worker.
      let last = performance.now(), worstGap = 0, ticks = 0;
      const ticker = setInterval(() => { const now = performance.now(); worstGap = Math.max(worstGap, now - last); last = now; ticks++; }, 10);
      const started = performance.now();
      const result = await verifier.verify(files, ["config", "ivk", "example.req", "example.y", "example.proof", "-id", id, ...args, "-q"]);
      const elapsed = performance.now() - started;
      clearInterval(ticker);
      const req = words(files.get("/example.req"));
      const T = req.length - 2;
      const decision = checkAcceptance(result, {
        verifier: { moduleSha256, build }, files: { request: files.get("/example.req"), token: files.get("/example.y") }, id,
        coverage: { r: req[T], e: req[T + 1], T, requireY: req[T + 1] === T }, policy,
        allowProofOfWork: true, acceptTheoremOnCodes: true, completion: { kind: "partial" },
      });
      return { exitCode: result.exitCode, verdict: result.verdict, failure: result.failure, claim: result.resultV1?.claim,
        accepted: decision.accepted, worstGap, ticks, elapsed, attached: files.get("/example.proof").byteLength > 0 };
    };
    const exact = await summary(await load("accepted-proof"), [], { kind: "exact-match" });
    const clipped = await summary(await load("accepted-proof-clipped-gap"), ["-policy", "clipped-gap,9244130,323343,1,16,8"],
      { kind: "clipped-gap", C: "9244130", theta: "323343", cap: "1", s: "16", sh: "8" });
    const tampered = await createVerifier({ moduleUrl: "/tampered.wasm", moduleSha256 }).verify(await load("accepted-proof"), ["-plan", "id", "config", "ivk/key.bin"]);
    const missing = await createVerifier({ moduleUrl: "/build/wasm/absent.wasm", moduleSha256 }).verify(new Map(), []);
    // A real worker that is terminated before it can reply: the supervisor fails closed at its deadline.
    const module = await WebAssembly.compileStreaming(fetch("/build/wasm/cp_verify.wasm"));
    const killed = await new BrowserSupervisor({ start: () => {
      const worker = new Worker("/build/ts/host/browser-worker.js", { type: "module" });
      const post = worker.postMessage.bind(worker);
      worker.postMessage = (message, transfer) => { post(message, transfer); worker.terminate(); };
      return worker;
    } }).run(module, captureCall(new Map(), ["cp_verify", "-plan", "zero"]), { deadlineMs: 2000 });
    // A real worker answering for another request ID.
    const stale = await new BrowserSupervisor({ start: () => {
      const worker = new Worker("/build/ts/host/browser-worker.js", { type: "module" });
      const post = worker.postMessage.bind(worker);
      worker.postMessage = (message, transfer) => post({ ...message, requestId: message.requestId + 1 }, transfer);
      return worker;
    } }).run(module, captureCall(new Map(), ["cp_verify"]));
    return { exact, clipped, tampered: [tampered.exitCode, tampered.failure], missing: [missing.exitCode, missing.failure],
      killed: [killed.status, killed.failure], stale: [stale.status, stale.failure] };
  }, { moduleSha256, build });

  assert.deepEqual(errors, []);
  for (const [name, run, verdict, claim] of [["exact-match", outcome.exact, "YES", "exact-match"],
    ["clipped-gap", outcome.clipped, "WITHIN LIMITS", "policy"]]) {
    assert.equal(run.exitCode, 0, name);
    assert.equal(run.verdict, verdict, name);
    assert.equal(run.failure, null, name);
    assert.equal(run.claim, claim, name);
    assert.equal(run.accepted, true, name);
    assert.equal(run.attached, true, name);
    // The guest runs about two seconds; a 10 ms timer must keep firing on the page meanwhile.
    assert.ok(run.worstGap < 250, `${name}: main thread stalled ${run.worstGap.toFixed(0)} ms`);
    assert.ok(run.ticks > run.elapsed / 50, `${name}: ${run.ticks} timer ticks in ${run.elapsed.toFixed(0)} ms`);
    console.log(`browser: ${name} exit=0 ${verdict} accepted; ${run.ticks} timer ticks in ${run.elapsed.toFixed(0)} ms, `
      + `longest gap ${run.worstGap.toFixed(0)} ms`);
  }
  assert.deepEqual(outcome.tampered, [5, "integrity"]);
  assert.deepEqual(outcome.missing, [5, "integrity"]);
  assert.deepEqual(outcome.killed, [5, "timeout"]);
  assert.deepEqual(outcome.stale, [5, "worker"]);
  console.log("browser: changed module bytes and a missing module returned integrity; a terminated worker timed out; "
    + "a stale request ID returned worker");
} finally {
  await browser.close();
  server.close();
}
