import { BASELINE_LIMITS, PAGE_BYTES } from "./limits.js";

export const failureCodes = [
  "abi", "trap", "replay-mismatch", "invalid-input", "input-limit", "output-limit",
  "memory-limit", "runtime-oom", "busy", "host-io", "host-internal", "timeout", "worker",
] as const;
export type Failure = typeof failureCodes[number];

const stages = ["parent", "plan", "key", "leaf", "request"] as const;
export type DiagnosticStage = typeof stages[number];
const maxElapsedNs = BASELINE_LIMITS.deadlineMs * 1e6;
export const MAX_INSTANCE_DIAGNOSTICS = 16;

export type InstanceDiagnostic = Readonly<{ schema: 1 } & (
  { phase: "setup"; code: "elapsed"; elapsedNs: number }
  | { phase: "replay" | "stage"; code: "elapsed"; stage: DiagnosticStage; elapsedNs: number }
  | { phase: "instance"; code: "start"; stage: DiagnosticStage }
  | { phase: "instance"; code: "end"; stage: DiagnosticStage; peakLinearBytes: number }
)>;

export type DiagnosticsV1 = InstanceDiagnostic | Readonly<{ schema: 1 } & (
  { phase: "provenance"; code: "build"; build: string; port: string }
  | { phase: "call"; code: "elapsed"; elapsedNs: number }
  | { phase: "call" | "admission"; code: Failure }
)>;

export type DiagnosticsSink = (event: DiagnosticsV1) => void | Promise<void>;

export function elapsedNs(startMs: number, endMs = performance.now()): number {
  const elapsed = (endMs - startMs) * 1e6;
  return Number.isFinite(elapsed) ? Math.floor(Math.max(0, Math.min(maxElapsedNs, elapsed))) : 0;
}

export function buildDiagnostic(module: WebAssembly.Module): DiagnosticsV1 | undefined {
  try {
    const sections = WebAssembly.Module.customSections(module, "fpv.provenance");
    if (sections.length !== 1 || sections[0].byteLength !== 141) return;
    const text = new TextDecoder().decode(sections[0]);
    const match = /^build=([a-f0-9]{64})\nport=([a-f0-9]{64})\n$/.exec(text);
    if (match) return { schema: 1, phase: "provenance", code: "build", build: match[1], port: match[2] };
  } catch {
    // Provenance observation is independent of the verifier result.
  }
}

function boundedInteger(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;
}

export function readInstanceDiagnostics(value: unknown): InstanceDiagnostic[] {
  if (!Array.isArray(value) || value.length > MAX_INSTANCE_DIAGNOSTICS) return [];
  const events: InstanceDiagnostic[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Object.getPrototypeOf(item) !== Object.prototype) return [];
    const event = item as Record<string, unknown>;
    const { schema, phase, code, stage, elapsedNs, peakLinearBytes } = event;
    if (schema !== 1) return [];
    const count = Object.keys(event).length;
    if (phase === "setup" && code === "elapsed" && count === 4 && boundedInteger(elapsedNs, maxElapsedNs)) {
      events.push({ schema, phase, code, elapsedNs });
      continue;
    }
    if (typeof stage !== "string" || !stages.some(known => known === stage)) return [];
    const known = stage as DiagnosticStage;
    if ((phase === "stage" || (phase === "replay" && known !== "plan")) && known !== "parent"
      && code === "elapsed" && count === 5
      && boundedInteger(elapsedNs, maxElapsedNs)) {
      events.push({ schema, phase, code, stage: known, elapsedNs });
    } else if (phase === "instance" && code === "start" && count === 4) {
      events.push({ schema, phase, code, stage: known });
    } else if (phase === "instance" && code === "end" && count === 5
      && boundedInteger(peakLinearBytes, (stage === "parent" ? BASELINE_LIMITS.parentPages : BASELINE_LIMITS.childPages) * PAGE_BYTES)
      && peakLinearBytes >= PAGE_BYTES && peakLinearBytes % PAGE_BYTES === 0) {
      events.push({ schema, phase, code, stage: known, peakLinearBytes });
    } else {
      return [];
    }
  }
  return events;
}
