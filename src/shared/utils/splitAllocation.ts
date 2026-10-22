import type { SplitMethod } from "../constants/enums";

export class SplitError extends Error {}

/** Percent values may have two decimals (33.33); compared in hundredths to avoid float drift. */
const PERCENT_SCALE = 100;
const FULL_PERCENT = 100 * PERCENT_SCALE;

/**
 * Splits `totalMinor` paise across participants. The result always sums exactly to the total:
 * leftover paise go to the largest fractional remainders (ties: earlier participants first).
 *  - equal:   values ignored
 *  - percent: values are percentages that must add up to 100
 *  - exact:   values are paise that must add up to the total
 */
export function allocateSplit(totalMinor: number, method: SplitMethod, values: Array<number | undefined>): number[] {
  const n = values.length;
  if (n === 0) throw new SplitError("Add at least one person.");
  if (!Number.isInteger(totalMinor) || totalMinor <= 0) throw new SplitError("The total must be a positive amount.");

  if (method === "exact") {
    const shares = values.map((v) => {
      if (v === undefined || !Number.isInteger(v) || v < 0) throw new SplitError("Enter an amount for everyone.");
      return v;
    });
    const sum = shares.reduce((a, b) => a + b, 0);
    if (sum !== totalMinor) throw new SplitError(`Shares add up to ${sum / 100}, not ${totalMinor / 100}.`);
    return shares;
  }

  const weights =
    method === "equal"
      ? values.map(() => 1)
      : values.map((v) => {
          if (v === undefined || v < 0) throw new SplitError("Enter a percentage for everyone.");
          return Math.round(v * PERCENT_SCALE);
        });
  const weightTotal = weights.reduce((a, b) => a + b, 0);
  if (method === "percent" && weightTotal !== FULL_PERCENT) throw new SplitError(`Percentages add up to ${weightTotal / PERCENT_SCALE}%, not 100%.`);

  const exact = weights.map((w) => (totalMinor * w) / weightTotal);
  const shares = exact.map(Math.floor);
  let leftover = totalMinor - shares.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => ({ i, frac: e - Math.floor(e) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (leftover === 0) break;
    shares[i] += 1;
    leftover -= 1;
  }
  return shares;
}
