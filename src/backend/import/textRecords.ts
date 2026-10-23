import "server-only";
import { parseAmountToMinor } from "@/shared/utils/money";
import type { Direction, TransactionStatus } from "@/backend/constants/enums.constants";
import { parseStatementDate } from "./dates";
import { DATE_FORMAT_OPTIONS } from "./mapping";
import { AMOUNT_IN_TEXT, DATE_IN_TEXT } from "./statementCheck";
import { nullIfEmpty } from "./text";
import type { ExtractedRow, ParsedEvent } from "./types";

/** Date formats seen in UPI-app statements and activity exports, beyond the table formats. */
const TEXT_DATE_FORMATS = [...DATE_FORMAT_OPTIONS, "MMM d, yyyy", "d MMM, yyyy", "dd MMMM yyyy", "d MMMM yyyy", "MMMM d, yyyy", "dd.MM.yyyy"];

const ISO_TIMESTAMP = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})/;
const TIME = /\b(\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?)(?![\d:])/i;
const RUPEE_AMOUNT = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/i;
const PLAIN_AMOUNT = /\b(\d[\d,]*\.\d{2})\b/;
const UTR_LABELLED = /(?:utr|upi ref(?:erence)?(?: no)?|rrn|ref(?:erence)?\.? no\.?|upi transaction id)\s*[:#.-]?\s*(\d{12})(?!\d)/i;
const UTR_ANY = /(?<!\d)(\d{12})(?!\d)/;
const APP_TXN_ID = /transaction id\s*[:#.-]?\s*([A-Z]{1,4}\d{10,})/i;
const VPA = /\b[a-z0-9._-]{2,}@[a-z][a-z0-9.]{1,}\b/i;
/** An optional amount between the verb and "to"/"from" ("Paid ₹350.00 to Swiggy"). */
const AMT = String.raw`(?:\s+(?:₹|rs\.?|inr)?\s*[\d,]+(?:\.\d{1,2})?)?`;
const STOP = String.raw`(?=\s+(?:using|on|via|debit|credit|note:|upi\b|from|to)\b|\s+[-+]?\s*(?:₹|rs\.|rs\s|inr\s)|[;|]|$)`;
const OUT = new RegExp(String.raw`(?:paid|sent|money sent|transferred|transfer|payment)${AMT}\s+to\s+(.+?)${STOP}`, "im");
const IN = new RegExp(String.raw`(?:received|money received|credited|payment)${AMT}\s+(?:from|by)\s+(.+?)${STOP}`, "im");
const DEBIT_WORDS = /\b(debit|debited|dr|paid|sent|purchase|spent|withdrawn)\b/gi;
const CREDIT_WORDS = /\b(credit|credited|cr|received|refund|refunded|cashback|added)\b/gi;
const FOOTER = /^(page \d+( of \d+)?|.*system generated.*|.*this is a computer generated.*)$/i;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** A record that starts with a day and month but no year ("05 Nov Paid to …", Paytm PDFs). */
const DAY_MONTH = /^(\d{1,2}) (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b(?![ ,'-]*\d{2,4}\b)/i;
/** The statement period at the top ("1 Nov'23 - 31 Oct'24", "01 Apr 2026 to 30 Apr 2026"). */
const PERIOD = /(\d{1,2})[ -]([a-z]{3})[a-z]*[ ,'-]+(\d{2,4})\s*(?:-|to|–)\s*(\d{1,2})[ -]([a-z]{3})[a-z]*[ ,'-]+(\d{2,4})/i;
/** The user's own account in a "Your Account" column ("HDFC Bank - 12"), trailing a payee name. */
const OWN_ACCOUNT = /\s+\S+\s+bank(?:\s+[a-z]{1,4})?(?:\s+-\s*\d+)?\s*$/i;

type Period = { start: number; end: number };

const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

/** The statement's period, used to give year-less dates their year. */
function statementPeriod(lines: readonly string[]): Period | null {
  for (const line of lines.slice(0, 40)) {
    const m = PERIOD.exec(line);
    if (!m) continue;
    const [sm, em] = [MONTHS.indexOf(m[2].toLowerCase()), MONTHS.indexOf(m[5].toLowerCase())];
    if (sm < 0 || em < 0) continue;
    return { start: Date.UTC(fullYear(m[3]), sm, Number(m[1])), end: Date.UTC(fullYear(m[6]), em, Number(m[4])) };
  }
  return null;
}

/** "05 Nov" → "05 Nov 2023", choosing the year that puts it inside the statement period. */
function withYear(line: string, period: Period): string | null {
  const m = DAY_MONTH.exec(line);
  if (!m) return null;
  const month = MONTHS.indexOf(m[2].toLowerCase());
  const endYear = new Date(period.end).getUTCFullYear();
  const year = Date.UTC(endYear, month, Number(m[1])) > period.end + 86_400_000 ? endYear - 1 : endYear;
  return `${m[1].padStart(2, "0")} ${m[2]} ${year}`;
}

const count = (re: RegExp, text: string) => (text.match(re) ?? []).length;

function direction(text: string): Direction | null {
  // An explicit DEBIT/CREDIT label or a sign before the amount ("- Rs.350", "+ ₹500") outweighs
  // words like "Paid by" in a credit's details.
  const debit = count(DEBIT_WORDS, text) + (/\bDEBIT\b/.test(text) ? 3 : 0) + (/-\s*(?:₹|rs\.?|inr)/i.test(text) ? 3 : 0);
  const credit = count(CREDIT_WORDS, text) + (/\bCREDIT\b/.test(text) ? 3 : 0) + (/\+\s*(?:₹|rs\.?|inr)/i.test(text) ? 3 : 0);
  return debit === credit ? null : debit > credit ? "debit" : "credit";
}

function dateOf(text: string, period: Period | null): string | null {
  const iso = ISO_TIMESTAMP.exec(text)?.[0];
  if (iso) return parseStatementDate(iso, TEXT_DATE_FORMATS);
  const date = (period && withYear(text, period)) || DATE_IN_TEXT.exec(text)?.[0];
  if (!date) return null;
  const after = text.includes(date) ? text.slice(text.indexOf(date) + date.length) : text;
  const time = TIME.exec(after)?.[1] ?? TIME.exec(text)?.[1] ?? null;
  return parseStatementDate(date.replace(/[,\s]+$/, ""), TEXT_DATE_FORMATS, time) ?? parseStatementDate(date.replace(/[,\s]+$/, ""), TEXT_DATE_FORMATS);
}

/** One transaction from the text of its record, or why it couldn't be read. */
function parseRecord(text: string, period: Period | null): { parsed: ParsedEvent | null; error: string | null } {
  const amountText = RUPEE_AMOUNT.exec(text)?.[1] ?? PLAIN_AMOUNT.exec(text)?.[1] ?? null;
  const amountMinor = parseAmountToMinor(amountText);
  const occurredAt = dateOf(text, period);
  const dir = direction(text);
  if (!occurredAt) return { parsed: null, error: "Unrecognised date" };
  if (!amountMinor) return { parsed: null, error: "No amount" };
  if (!dir) return { parsed: null, error: "Could not tell debit from credit" };
  const status: TransactionStatus = /\bfailed\b/i.test(text) ? "failed" : /\bpending\b/i.test(text) ? "pending" : "success";
  const reference = UTR_LABELLED.exec(text)?.[1] ?? UTR_ANY.exec(text)?.[1] ?? null;
  const party = (dir === "debit" ? OUT : IN).exec(text)?.[1] ?? (dir === "debit" ? IN : OUT).exec(text)?.[1] ?? null;
  const firstLine = text.split("\n")[0].replace(ISO_TIMESTAMP, "").replace(DATE_IN_TEXT, "").replace(/\btime:\s*;?/i, "").trim();
  return {
    error: null,
    parsed: {
      occurredAt,
      amountMinor: Math.abs(amountMinor),
      direction: dir,
      status,
      counterpartyName: nullIfEmpty(party?.replace(/\s+/g, " ").replace(OWN_ACCOUNT, "").slice(0, 120)),
      counterpartyVpa: VPA.exec(text)?.[0]?.toLowerCase() ?? null,
      narration: nullIfEmpty(firstLine.slice(0, 300)),
      referenceId: reference,
      appTransactionId: APP_TXN_ID.exec(text)?.[1] ?? null,
      balanceMinor: null,
      note: null,
    },
  };
}

/**
 * Reads statements that aren't tables (PhonePe/Google Pay/Paytm PDFs, Takeout activity pages,
 * JSON records) without any AI: lines are grouped into records around their date, then each
 * record's date, amount, direction, counterparty and UTR are read from its text.
 *
 * Records start at a date line ("Oct 05, 2024 Paid to Swiggy DEBIT ₹350") unless amounts appear
 * before the first date, in which case the date line ends each record ("Paid ₹350.00 to Swiggy",
 * then "Oct 5, 2024, 10:32 AM"). Date lines with no amount (statement periods) are skipped.
 */
export function parseTextRecords(lines: readonly string[]): ExtractedRow[] {
  const clean = lines.map((l) => l.trim()).filter((l) => l && !FOOTER.test(l));
  const period = statementPeriod(clean);
  const isAnchor = (l: string) => DATE_IN_TEXT.test(l) || ISO_TIMESTAMP.test(l) || Boolean(period && DAY_MONTH.test(l));
  const firstDate = clean.findIndex(isAnchor);
  const firstAmount = clean.findIndex((l) => AMOUNT_IN_TEXT.test(l));
  if (firstDate < 0 || firstAmount < 0) return [];
  const datesEnd = firstAmount < firstDate;

  const records: string[][] = [];
  let current: string[] = [];
  for (const line of clean) {
    if (datesEnd) {
      current.push(line);
      if (isAnchor(line)) {
        records.push(current);
        current = [];
      }
    } else if (isAnchor(line)) {
      if (current.length) records.push(current);
      current = [line];
    } else if (current.length) current.push(line);
  }
  if (!datesEnd && current.length) records.push(current);

  return records
    .filter((r) => AMOUNT_IN_TEXT.test(r.join(" ")))
    .map((r, rowIndex) => ({ rowIndex, raw: r.join("\n"), ...parseRecord(r.join("\n"), period) }));
}
