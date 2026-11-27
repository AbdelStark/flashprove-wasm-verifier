/** Offline smoke test of the static demo bundle: keyboard only, network off after loading (#37). */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, normalize, resolve, sep } from "node:path";
import { chromium } from "playwright";

const root = resolve("build/demo") + sep;
const types = { ".js": "text/javascript", ".wasm": "application/wasm", ".html": "text/html", ".json": "application/json" };
const server = createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const file = normalize(resolve(root, `.${path === "/" ? "/index.html" : path}`));
  if (!file.startsWith(root)) return response.writeHead(404).end();
  try {
    response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise(ready => server.listen(0, "127.0.0.1", ready));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();

try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin);
  const status = page.locator("#status");
  assert.equal(await status.getAttribute("role"), "status");
  assert.equal(await status.getAttribute("aria-live"), "polite");
  await page.waitForFunction(() => document.getElementById("status").textContent.startsWith("Ready."), null, { timeout: 60_000 });

  // From here on, any request that leaves the page is a failure.
  await context.setOffline(true);
  const online = [];
  page.on("request", request => { if (!request.url().startsWith("blob:")) online.push(request.url()); });

  async function run(keys, title, verdict) {
    for (const key of keys) await page.keyboard.press(key);
    await page.waitForFunction(() => document.getElementById("results").getAttribute("aria-busy") === "true"
      || document.getElementById("status").textContent.includes("verdict"), null, { timeout: 10_000 });
    await page.waitForFunction(t => document.getElementById("status").textContent.startsWith(`${t}: verdict`), title,
      { timeout: 120_000 });
    const text = await status.textContent();
    assert.equal(text, `${title}: verdict ${verdict}, accepted.`);
    assert.equal(await page.locator("#acceptance").textContent(), "Accepted: all eight points hold.");
    assert.equal(await page.locator("#acceptance").getAttribute("class"), "accepted");
    assert.equal(await page.locator("#exit").textContent(), "0");
    assert.equal(await page.locator("#failure").textContent(), "none");
    assert.equal(await page.locator("#results").getAttribute("aria-busy"), "false");
    console.log(`demo: offline, keyboard ${keys.join(" ")} -> "${text}"`);
  }
  // Tab reaches the checked radio; arrows choose; Tab reaches the button; Enter or Space activates it.
  await run(["Tab", "ArrowDown", "Tab", "Enter"], "Clipped gap", "WITHIN LIMITS");
  assert.match(await page.locator("#verdict").textContent(), /^WITHIN LIMITS: clipped-gap C=9244130 /);
  await run(["Shift+Tab", "ArrowUp", "Tab", "Space"], "Exact match", "YES");
  assert.equal(await page.locator("#verdict").textContent(), "YES");
  assert.deepEqual(online, [], "no request may leave the page after loading");
  assert.deepEqual(errors, []);
  console.log("demo: both published examples verified and accepted with the network off");
} finally {
  await browser.close();
  server.close();
}
