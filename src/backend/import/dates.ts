import "server-only";

// Minimal, dependency-free date parsing for statement formats. All statements are read as IST.

const IST_OFFSET_MINUTES = 330;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const TOKENS: Array<[string, string, string]> = [
  // [token, regex, part]
  ["yyyy", "(\\d{4})", "year4"],
  ["yy", "(\\d{2})", "year2"],
  ["MMMM", "([A-Za-z]{3,9})", "monthName"],
  ["MMM", "([A-Za-z]{3,4})", "monthName"],
  ["MM", "(\\d{2})", "month"],
  ["M", "(\\d{1,2})", "month"],
  ["dd", "(\\d{2})", "day"],
  ["d", "(\\d{1,2})", "day"],
  ["HH", "(\\d{2})", "hour"],
  ["H", "(\\d{1,2})", "hour"],
  ["hh", "(\\d{2})", "hour12"],
  ["h", "(\\d{1,2})", "hour12"],
  ["mm", "(\\d{2})", "minute"],
  ["ss", "(\\d{2})", "second"],
  ["a", "([AaPp][Mm])", "ampm"],
];

type Compiled = { regex: RegExp; parts: string[] };
const cache = new Map<string, Compiled>();

function compile(format: string): Compiled {
  const hit = cache.get(format);
  if (hit) return hit;
  let pattern = "";
  const parts: string[] = [];
  let i = 0;
  outer: while (i < format.length) {
    for (const [token, re, part] of TOKENS) {
      if (format.startsWith(token, i)) {
        pattern += re;
        parts.push(part);
        i += token.length;
        continue outer;
      }
    }
    const ch = format[i];
    pattern += ch === " " ? "\\s+" : ch.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
    i += 1;
  }
  const compiled = { regex: new RegExp(`^${pattern}$`), parts };
  cache.set(format, compiled);
  return compiled;
}

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function matchFormat(value: string, format: string): Parts | null {
  const { regex, parts } = compile(format);
  const m = regex.exec(value);
  if (!m) return null;
  const out: Parts = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  let ampm: string | null = null;
  let hour12: number | null = null;
  parts.forEach((part, idx) => {
    const raw = m[idx + 1];
    switch (part) {
      case "year4": out.year = Number(raw); break;
      case "year2": out.year = 2000 + Number(raw); break;
      case "monthName": out.month = MONTHS[raw.toLowerCase().slice(0, 3)] ?? 0; break;
      case "month": out.month = Number(raw); break;
      case "day": out.day = Number(raw); break;
      case "hour": out.hour = Number(raw); break;
      case "hour12": hour12 = Number(raw); break;
      case "minute": out.minute = Number(raw); break;
      case "second": out.second = Number(raw); break;
      case "ampm": ampm = raw.toLowerCase(); break;
    }
  });
  if (hour12 !== null) out.hour = (hour12 % 12) + (ampm === "pm" ? 12 : 0);
  return isValid(out) ? out : null;
}

function isValid(p: Parts): boolean {
  if (p.year < 2000 || p.year > 2100 || p.month < 1 || p.month > 12 || p.day < 1 || p.hour > 23 || p.minute > 59 || p.second > 59) return false;
  const daysInMonth = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
  return p.day <= daysInMonth;
}

function toIsoFromIst(p: Parts): string {
  const utcMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - IST_OFFSET_MINUTES * 60_000;
  return new Date(utcMs).toISOString();
}

/** Formats always tried after a config's own, covering XLS-normalised and ISO values. */
const FALLBACK_FORMATS = ["yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd"];

/**
 * Parses a statement date (and optional separate time) into an ISO UTC timestamp, interpreting
 * wall-clock values as IST. Returns null if no format matches or the date is impossible.
 */
export function parseStatementDate(dateText: string, formats: readonly string[], timeText?: string | null): string | null {
  const value = dateText.replace(/\s+/g, " ").replace(/,(?=\S)/g, ", ").trim();
  if (!value) return null;

  // Explicit ISO timestamps with an offset (e.g. Takeout JSON) are already absolute.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) && /(Z|[+-]\d{2}:?\d{2})$/.test(value)) {
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }

  const combined = timeText ? `${value} ${timeText.trim()}` : value;
  for (const format of [...formats, ...FALLBACK_FORMATS]) {
    const withTime = timeText ? matchFormat(combined, `${format} ${guessTimeFormat(timeText)}`) : null;
    const parts = withTime ?? matchFormat(value, format);
    if (parts) return toIsoFromIst(parts);
  }
  return null;
}

function guessTimeFormat(time: string): string {
  const t = time.trim();
  const hasSeconds = /^\d{1,2}:\d{2}:\d{2}/.test(t);
  const hasAmPm = /[ap]m$/i.test(t);
  const base = hasAmPm ? (hasSeconds ? "h:mm:ss" : "h:mm") : hasSeconds ? "H:mm:ss" : "H:mm";
  return hasAmPm ? `${base}${/\s[ap]m$/i.test(t) ? " " : ""}a` : base;
}

/** `yyyy-MM-dd` (IST calendar date) for an ISO timestamp. */
export function istDate(iso: string): string {
  return new Date(Date.parse(iso) + IST_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}
