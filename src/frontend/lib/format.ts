import { CURRENCY } from "@/shared/constants/limits";
export { formatInr, parseAmountToMinor, minorToMajorString } from "@/shared/utils/money";

const dateFormatter = new Intl.DateTimeFormat(CURRENCY.LOCALE, {
  timeZone: CURRENCY.TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat(CURRENCY.LOCALE, {
  timeZone: CURRENCY.TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const monthFormatter = new Intl.DateTimeFormat(CURRENCY.LOCALE, { timeZone: CURRENCY.TIME_ZONE, month: "long", year: "numeric" });

export const formatDate = (iso: string | null | undefined) => (iso ? dateFormatter.format(new Date(iso)) : "—");
export const formatDateTime = (iso: string | null | undefined) => (iso ? dateTimeFormatter.format(new Date(iso)) : "—");
export const formatMonth = (iso: string) => monthFormatter.format(new Date(iso));

/** Shows only the last few characters of an identifier (UTR, VPA, account). */
export function maskTail(value: string | null | undefined, visible = 4): string {
  if (!value) return "—";
  return value.length <= visible ? value : `••${value.slice(-visible)}`;
}

/** `YYYY-MM-DD` for today in IST, for date inputs and report defaults. */
export function todayIst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: CURRENCY.TIME_ZONE }).format(new Date());
}

export function monthStartIst(offsetMonths = 0): string {
  const [y, m] = todayIst().split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offsetMonths, 1));
  return d.toISOString().slice(0, 10);
}

export function monthEndIst(offsetMonths = 0): string {
  const [y, m] = todayIst().split("-").map(Number);
  const d = new Date(Date.UTC(y, m + offsetMonths, 0));
  return d.toISOString().slice(0, 10);
}
