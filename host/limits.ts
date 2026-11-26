/** Measured baseline envelope from ADR 0006. */

export const BASELINE_LIMITS = Object.freeze({
  fileBytes: 64 * 2 ** 20,
  totalInputBytes: 128 * 2 ** 20,
  parentPages: 2048,
  childPages: 57344,
  outputBytes: 8 * 2 ** 20,
  concurrentCalls: 1,
});

export const PAGE_BYTES = 65536;

export type RunLimits = Readonly<{
  parentPages: number;
  childPages: number;
  outputBytes: number;
}>;

export function lowerLimits(overrides: Partial<RunLimits>): RunLimits {
  const limits: RunLimits = {
    parentPages: overrides.parentPages ?? BASELINE_LIMITS.parentPages,
    childPages: overrides.childPages ?? BASELINE_LIMITS.childPages,
    outputBytes: overrides.outputBytes ?? BASELINE_LIMITS.outputBytes,
  };
  for (const key of ["parentPages", "childPages", "outputBytes"] as const) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > BASELINE_LIMITS[key]) {
      throw new RangeError("invalid call limit");
    }
  }
  return limits;
}
