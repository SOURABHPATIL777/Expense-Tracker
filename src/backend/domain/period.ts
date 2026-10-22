import "server-only";

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** Inclusive IST calendar dates → half-open UTC instant range [from, to). */
export function istDateRange(from: string, to: string): { fromIso: string; toIso: string } {
  const start = Date.parse(`${from}T00:00:00Z`) - IST_OFFSET_MS;
  const end = Date.parse(`${to}T00:00:00Z`) - IST_OFFSET_MS + DAY_MS;
  return { fromIso: new Date(start).toISOString(), toIso: new Date(end).toISOString() };
}

/** Today's date in IST as `yyyy-MM-dd`. */
export const todayIst = (now = Date.now()) => new Date(now + IST_OFFSET_MS).toISOString().slice(0, 10);

export const daysBetween = (fromIso: string, toIso: string) => Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / DAY_MS);
