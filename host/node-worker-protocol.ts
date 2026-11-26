import { failureCodes } from "./diagnostics.js";
import type { Failure, InstanceDiagnostic } from "./diagnostics.js";
import { BASELINE_LIMITS } from "./limits.js";
import type { GuestResult } from "./replay.js";

export type NodeWorkerRequest = Readonly<{
  schema: 1;
  requestId: number;
  module: WebAssembly.Module;
  argv: readonly string[];
  workingDirectory: string;
  diagnostics?: true;
}>;

export type NodeWorkerReply = Readonly<{
  schema: 1;
  requestId: number;
  result: GuestResult;
  diagnostics?: readonly InstanceDiagnostic[];
}>;

const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
const internalStage = "NOT CHECKED: internal-stage\n";
const knownFailures: ReadonlySet<Failure> = new Set(failureCodes);
const policy = /^WITHIN LIMITS: clipped-gap C=\d{1,20} theta=\d{1,20} cap=\d{1,20} s=\d{1,20} sh=\d{1,20}$/;
const plan = "PLAN ONLY: no proof was checked";

function ending(bytes: Uint8Array): string[] {
  if (bytes.at(-1) !== 10) return [];
  const lines = [];
  let end = bytes.length - 1;
  for (let index = 0; index < 4 && end >= 0; index++) {
    const start = end === 0 ? -1 : bytes.lastIndexOf(10, end - 1);
    lines.unshift(decoder.decode(bytes.subarray(start + 1, end)));
    end = start;
  }
  return lines;
}

function consistent(status: number, bytes: Uint8Array, mode: string | undefined): boolean {
  const lines = ending(bytes);
  const final = lines.at(-1) ?? "";
  const whole = mode !== "-plan" && mode !== "-key" && mode !== "-leaf";
  if (status === 14 && (mode === "-key" || mode === "-leaf")) return final === "NOT-A-VERIFICATION";
  if (status === 0 || status === 14) {
    return whole && lines.length === 4 && lines[0].startsWith("commitment: ")
      && lines[1].startsWith("proof of work: ") && lines[2].startsWith(`result-v1 status=${status} `)
      && (status === 0 ? final === "YES" || policy.test(final) : final === "NOT-A-VERIFICATION");
  }
  if (status === 3) return (mode === "-key" || mode === "-leaf") && final === `PART PASSED: ${mode.slice(1)}`;
  if (status === 4) return mode === "-plan" && final === plan;
  if (status === 1) return final.startsWith("NO: ");
  if (status === 5) return final.startsWith("NOT CHECKED: ");
  if (status !== 2 && status !== 15) return false;
  return final !== "YES" && !final.startsWith("PART PASSED:") && !final.startsWith("WITHIN LIMITS:")
    && final !== plan && final !== "NOT-A-VERIFICATION";
}

export function readNodeReply(value: unknown, request: NodeWorkerRequest): GuestResult | undefined {
  if (!value || typeof value !== "object") return;
  const message = value as Partial<NodeWorkerReply>;
  if (message.schema !== 1 || message.requestId !== request.requestId || !message.result
    || typeof message.result !== "object") return;
  const { status, stdout, stderr, failure } = message.result;
  if (!Number.isInteger(status) || !(stdout instanceof Uint8Array) || !(stderr instanceof Uint8Array)
    || !(stdout.buffer instanceof ArrayBuffer) || !(stderr.buffer instanceof ArrayBuffer)
    || stdout.byteOffset !== 0 || stderr.byteOffset !== 0
    || stdout.byteLength !== stdout.buffer.byteLength || stderr.byteLength !== stderr.buffer.byteLength
    || stdout.length > BASELINE_LIMITS.outputBytes || stderr.length > BASELINE_LIMITS.outputBytes - stdout.length) return;
  if (failure !== null) {
    if (!knownFailures.has(failure) || status !== 5 || stderr.length !== 0 || stdout.length !== internalStage.length
      || decoder.decode(stdout) !== internalStage) return;
  } else if (!consistent(status, stdout, request.argv[1])) {
    return;
  }
  return { status, stdout, stderr, failure };
}
