import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_INSTANCE_DIAGNOSTICS, readInstanceDiagnostics } from "../../build/ts/host/diagnostics.js";
import { BASELINE_LIMITS, PAGE_BYTES } from "../../build/ts/host/limits.js";

test("DiagnosticsV1 validates stage, schema, fields and finite bounds", () => {
  const setup = { schema: 1, phase: "setup", code: "elapsed", elapsedNs: 42 };
  const start = { schema: 1, phase: "instance", code: "start", stage: "key" };
  const end = { ...start, code: "end", peakLinearBytes: PAGE_BYTES };
  const events = [setup, start, { schema: 1, phase: "replay", code: "elapsed", stage: "key", elapsedNs: 10 }, end];
  assert.deepEqual(readInstanceDiagnostics(events), events);
  assert.notEqual(readInstanceDiagnostics(events)[0], setup);
  for (const invalid of [
    { ...start, schema: 2 }, { ...start, stage: "/private-path" }, { ...start, unexpected: "secret" },
    { ...setup, elapsedNs: Infinity }, { ...setup, elapsedNs: -1 }, { ...setup, elapsedNs: 0.5 },
    { ...setup, elapsedNs: BASELINE_LIMITS.deadlineMs * 1e6 + 1 },
    { ...end, peakLinearBytes: 0 }, { ...end, peakLinearBytes: PAGE_BYTES + 1 },
    { ...end, peakLinearBytes: (BASELINE_LIMITS.childPages + 1) * PAGE_BYTES },
    { ...end, stage: "parent", peakLinearBytes: (BASELINE_LIMITS.parentPages + 1) * PAGE_BYTES },
  ]) assert.deepEqual(readInstanceDiagnostics([setup, invalid]), []);
  assert.deepEqual(readInstanceDiagnostics(Array(MAX_INSTANCE_DIAGNOSTICS + 1).fill(start)), []);
  assert.deepEqual(readInstanceDiagnostics({ value: start }), []);
});
