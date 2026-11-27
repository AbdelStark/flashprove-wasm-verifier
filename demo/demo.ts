/** The offline demo: preload every asset, then verify a published example with no network (RFC-0007). */

import { checkAcceptance, createVerifier } from "../host/browser.js";
import type { AcceptanceExpectations, VerifyResult } from "../host/browser.js";

type Fixture = Readonly<{
  id: string; title: string; policyArgs: readonly string[]; policy: AcceptanceExpectations["policy"];
  files: readonly Readonly<{ path: string; sha256: string; bytes: number }>[];
}>;
type Manifest = Readonly<{ schema: 1; upstreamCommit: string; moduleSha256: string; build: string; fixtures: readonly Fixture[] }>;

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = byId<HTMLParagraphElement>("status");
const fieldset = byId<HTMLFieldSetElement>("fixtures");
const button = byId<HTMLButtonElement>("verify");
const results = byId<HTMLDivElement>("results");

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function rows(list: HTMLElement, entries: readonly (readonly [string, string])[]) {
  list.replaceChildren(...entries.flatMap(([term, value]) => {
    const dt = document.createElement("dt"), dd = document.createElement("dd");
    dt.textContent = term;
    dd.textContent = value;
    return [dt, dd];
  }));
}

function words(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: bytes.length / 4 }, (_, index) => view.getUint32(index * 4, true));
}

/** Load the manifest, module, worker and every fixture file, checking each digest, while online. */
async function preload() {
  const manifest = await (await fetch("manifest.json")).json() as Manifest;
  if (manifest.schema !== 1) throw new Error("unsupported manifest");
  const wasm = await fetchBytes("cp_verify.wasm");
  const worker = await fetchBytes("worker.js");
  const fixtures = new Map<string, Map<string, Uint8Array>>();
  for (const fixture of manifest.fixtures) {
    const files = new Map<string, Uint8Array>();
    for (const file of fixture.files) {
      const bytes = await fetchBytes(`fixtures/${fixture.id}/${file.path}`);
      if (await sha256(bytes) !== file.sha256) throw new Error(`${fixture.id}/${file.path} does not match the manifest`);
      files.set(`/${file.path}`, bytes);
    }
    fixtures.set(fixture.id, files);
  }
  // Blob URLs keep the module and worker reachable after the network goes away.
  const verifier = createVerifier({
    moduleUrl: URL.createObjectURL(new Blob([wasm as Uint8Array<ArrayBuffer>], { type: "application/wasm" })),
    moduleSha256: manifest.moduleSha256,
    workerUrl: URL.createObjectURL(new Blob([worker as Uint8Array<ArrayBuffer>], { type: "text/javascript" })),
  });
  return { manifest, fixtures, verifier };
}

function show(fixture: Fixture, files: Map<string, Uint8Array>, manifest: Manifest, result: VerifyResult) {
  byId("exit").textContent = String(result.exitCode);
  byId("verdict").textContent = result.stdoutLines.at(-1) ?? "(no output)";
  byId("failure").textContent = result.failure ?? "none";
  const record = result.resultV1;
  rows(byId("coverage"), record ? [
    ["Claim", record.claim], ["Request range", `r=${record.r} e=${record.e} T=${record.T}`],
    ["Checked tokens", record.tokens], ["Next token y", record.y], ["Policy", record.policy],
    ["Proof of work", record.work === "0" ? "none counted" : `up to ${record.work} bits in ${record["work-rounds"]} rounds`],
  ] : [["Record", "none: only a whole call at exit 0 or 14 has one"]]);
  const request = files.get("/example.req")!, token = files.get("/example.y")!;
  const req = words(request);
  const T = req.length - 2;
  const decision = checkAcceptance(result, {
    verifier: { moduleSha256: manifest.moduleSha256, build: manifest.build }, files: { request, token },
    id: new TextDecoder().decode(files.get("/ID.txt")).trim(),
    coverage: { r: req[T], e: req[T + 1], T, requireY: req[T + 1] === T }, policy: fixture.policy,
    allowProofOfWork: true, acceptTheoremOnCodes: true, completion: { kind: "partial" },
  });
  const acceptance = byId("acceptance");
  acceptance.className = decision.accepted ? "accepted" : "rejected";
  acceptance.textContent = decision.accepted ? "Accepted: all eight points hold."
    : `Not accepted. Failed: ${decision.failed.join(", ")}.`;
  rows(byId("provenance"), [
    ["Example", `examples/${fixture.id} at FlashProve ${manifest.upstreamCommit}`],
    ["Module SHA-256", manifest.moduleSha256], ["Source build", manifest.build],
    ...fixture.files.map(file => [file.path, file.sha256] as const),
  ]);
  return decision.accepted;
}

async function main() {
  let loaded: Awaited<ReturnType<typeof preload>>;
  try {
    loaded = await preload();
  } catch (error) {
    status.textContent = `The bundle could not be loaded: ${error instanceof Error ? error.message : String(error)}`;
    return;
  }
  const { manifest, fixtures, verifier } = loaded;
  manifest.fixtures.forEach((fixture, index) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "fixture";
    input.value = fixture.id;
    input.checked = index === 0;
    label.append(input, ` ${fixture.title} (examples/${fixture.id})`);
    fieldset.append(label);
  });
  fieldset.disabled = false;
  button.disabled = false;
  status.textContent = "Ready. Everything is loaded; the network is no longer needed.";
  byId<HTMLFormElement>("form").addEventListener("submit", async event => {
    event.preventDefault();
    const choice = (fieldset.querySelector("input:checked") as HTMLInputElement | null)?.value;
    const fixture = manifest.fixtures.find(item => item.id === choice);
    const files = fixture && fixtures.get(fixture.id);
    if (!fixture || !files) return;
    button.disabled = true;
    fieldset.disabled = true;
    results.setAttribute("aria-busy", "true");
    status.textContent = `Verifying ${fixture.title}…`;
    const id = new TextDecoder().decode(files.get("/ID.txt")).trim();
    const result = await verifier.verify(files,
      ["config", "ivk", "example.req", "example.y", "example.proof", "-id", id, ...fixture.policyArgs, "-q"]);
    const accepted = show(fixture, files, manifest, result);
    results.hidden = false;
    results.setAttribute("aria-busy", "false");
    status.textContent = `${fixture.title}: verdict ${result.verdict ?? "none"}, ${accepted ? "accepted" : "not accepted"}.`;
    button.disabled = false;
    fieldset.disabled = false;
  });
}

void main();
