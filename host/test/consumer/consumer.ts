// A strict package consumer compiled against the emitted declarations only.
import { verify } from "../../../build/ts/host/verify.js";
import type { Files, HostFailure, ResultV1, Verdict, VerifyResult } from "../../../build/ts/host/verify.js";

const files: Files = new Map([["/config/policy.txt", new Uint8Array()]]);
const pending: Promise<VerifyResult> = verify(files, ["-plan", "accounting", "config", "128"], { deadlineMs: 1000 });

async function accepted(expectedId: string): Promise<boolean> {
  const result = await pending;
  const verdict: Verdict = result.verdict;
  const failure: HostFailure | null = result.failure;
  const record: ResultV1 | null = result.resultV1;
  const stdout: Uint8Array = result.stdout;
  const lines: readonly string[] = result.stdoutLines;
  // @ts-expect-error result fields are read-only
  result.exitCode = 0;
  // @ts-expect-error records are read-only
  if (record) record.status = "0";
  // @ts-expect-error lines are read-only
  lines.push("YES");
  // @ts-expect-error the verdict is a closed union
  const invented: Verdict = "MAYBE";
  // @ts-expect-error the failure is a closed union
  const unknown: HostFailure = "network";
  // @ts-expect-error a status is "0" or "14"
  const status: ResultV1["status"] = "1";
  void [invented, unknown, status, stdout];
  return failure === null && result.exitCode === 0 && verdict === "YES" && record !== null
    && record.status === "0" && record.id === expectedId;
}
void accepted;

// @ts-expect-error files must be a map of byte arrays
void verify(new Map([["/a", "text"]]), []);
// @ts-expect-error arguments are strings
void verify(files, [1]);
// @ts-expect-error unknown options are rejected
void verify(files, [], { deadline: 1 });

import { checkAcceptance } from "../../../build/ts/host/verify.js";
import type { AcceptanceDecision, AcceptanceExpectations, AcceptanceRule } from "../../../build/ts/host/verify.js";

const expectations: AcceptanceExpectations = {
  verifier: { moduleSha256: "a".repeat(64), build: "b".repeat(64) },
  files: { request: new Uint8Array(264), token: new Uint8Array(4) },
  id: "c".repeat(64),
  coverage: { r: 60, e: 64, T: 64, requireY: true },
  policy: { kind: "clipped-gap", C: "9244130", theta: "323343", cap: "1", s: "16", sh: "8" },
  allowProofOfWork: false,
  acceptTheoremOnCodes: true,
  completion: { kind: "complete", endTokenIds: [2] },
};

async function decide(): Promise<readonly AcceptanceRule[]> {
  const decision: AcceptanceDecision = checkAcceptance(await pending, expectations);
  if (decision.accepted) {
    // @ts-expect-error an accepted decision has no failures
    return decision.failed;
  }
  return decision.failed;
}
void decide;

// @ts-expect-error sh is pinned to "8"
const seven: AcceptanceExpectations["policy"] = { kind: "clipped-gap", C: "1", theta: "1", cap: "0", s: "1", sh: "7" };
// @ts-expect-error a complete reply names its end tokens
const noEnds: AcceptanceExpectations["completion"] = { kind: "complete" };
// @ts-expect-error rules are a closed union
const rule: AcceptanceRule = "trust-me";
void [seven, noEnds, rule];
