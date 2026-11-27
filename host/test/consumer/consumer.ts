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
