import { CURRENCY } from "../constants/limits";

// Money is always an integer count of paise. Floats never hold an amount.

const inrFormatter = new Intl.NumberFormat(CURRENCY.LOCALE, {
  style: "currency",
  currency: CURRENCY.CODE,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatInr(minor: number): string {
  return inrFormatter.format(minor / CURRENCY.MINOR_PER_MAJOR);
}

/**
 * Parses a human/bank amount string ("1,23,456.7", "₹ 500", "-12.50", "450.00 Dr") into paise.
 * Returns null when the text is not a well-formed amount. Sign markers are left to the caller.
 */
export function parseAmountToMinor(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    return Math.round(raw * CURRENCY.MINOR_PER_MAJOR);
  }
  const cleaned = raw
    .replace(/₹|rs\.?|inr/gi, "")
    .replace(/\(?(?<![a-z])(dr|cr)\b\.?\)?/gi, "")
    .replace(/[,\s]/g, "")
    .replace(/^\((.*)\)$/, "-$1");
  if (!/^[-+]?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const negative = cleaned.startsWith("-");
  const [whole, fraction = ""] = cleaned.replace(/^[-+]/, "").split(".");
  const minor = Number(whole) * CURRENCY.MINOR_PER_MAJOR + Number(fraction.padEnd(2, "0"));
  return negative ? -minor : minor;
}

export function minorToMajorString(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / CURRENCY.MINOR_PER_MAJOR);
  const fraction = String(abs % CURRENCY.MINOR_PER_MAJOR).padStart(2, "0");
  return `${sign}${whole}.${fraction}`;
}
