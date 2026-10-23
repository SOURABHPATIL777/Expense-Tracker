import "server-only";
import { z } from "zod";
import { AppError } from "@/backend/errors/AppError";
import { DIRECTIONS, SOURCE_APPS, SOURCE_KINDS, TRANSACTION_STATUSES } from "@/backend/constants/enums.constants";
import { PDF_LLM } from "@/backend/constants/llm.constants";
import { parseAmountToMinor } from "@/shared/utils/money";
import { parseStatementDate } from "@/backend/import/dates";
import { DATE_FORMAT_OPTIONS } from "@/backend/import/mapping";
import type { ParsedEvent } from "@/backend/import/types";
import { redactForExtraction } from "./redact";
import { inputBudgetChars, runLlmTask } from "./run";

const PDF_DATE_FORMATS = [...DATE_FORMAT_OPTIONS, "MMM d, yyyy", "d MMM, yyyy", "dd MMMM yyyy", "d MMMM yyyy", "dd.MM.yyyy"];

const rowSchema = z.object({
  date: z.string().min(4).max(40),
  time: z.string().max(20).nullish(),
  description: z.string().max(300),
  counterparty: z.string().max(120).nullish(),
  amount: z.string().min(1).max(30),
  direction: z.enum(DIRECTIONS),
  reference: z.string().max(40).nullish(),
  status: z.enum(TRANSACTION_STATUSES).nullish(),
});
export type LlmPdfRow = z.infer<typeof rowSchema>;

const chunkSchema = z.object({
  /** Asked on the first part only: false when the file isn't a transaction statement at all. */
  isStatement: z.boolean().default(true),
  source: z.object({ sourceKind: z.enum(SOURCE_KINDS), sourceApp: z.enum(SOURCE_APPS) }).nullish(),
  rows: z.array(rowSchema).max(300),
});

const INSTRUCTIONS = `You are given part of a file a user uploaded as their Indian bank or UPI-app statement, as plain text lines
(from a PDF, an HTML page or JSON records). If this is the first part, set isStatement: false when it is clearly not a
transaction statement (an invoice, receipt, salary slip, resume, letter, price list…) and return no rows.
List every transaction in this part. For each one, copy text EXACTLY as printed (do not reformat):
- date (and time if printed), amount as printed (e.g. "1,250.00" or "₹350"), description line, counterparty if shown,
  status if shown (success/pending/failed);
- reference: the UTR / UPI reference number (usually 12 digits, labelled "UTR", "UPI Ref" or "RRN"), NOT the app's own
  transaction or order ID; null if no UTR is printed;
- direction: "debit" for money out, "credit" for money in.
Skip opening/closing balances, totals and headings. If this is the first part, also identify
source.sourceKind ("upi_app" or "bank") and source.sourceApp (use "other_upi"/"other_bank" if unsure).
Never invent a transaction or a number that is not in the text.`;

/** Splits PDF lines into chunks that fit the extraction task's input budget. */
export function chunkLines(lines: string[], maxChars = inputBudgetChars("pdf_extraction", PDF_LLM.TEXT_SHARE)): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const line of lines) {
    if (size + line.length + 1 > maxChars && current.length) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(line);
    size += line.length + 1;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const appearsIn = (hay: string, needle: string | null | undefined) => Boolean(needle && squash(needle) && hay.includes(squash(needle)));

/**
 * Anti-hallucination gate: a row is kept only if its date and amount text appear verbatim in the
 * chunk and parse cleanly; a reference or counterparty not found in the text is discarded.
 */
export function verifyLlmRows(chunkText: string, rows: LlmPdfRow[]): { events: ParsedEvent[]; dropped: number } {
  const hay = squash(chunkText);
  const events: ParsedEvent[] = [];
  let dropped = 0;
  for (const r of rows) {
    const amountText = r.amount.trim();
    const bareAmount = amountText.replace(/^(₹|rs\.?|inr)\s*/i, "");
    const amountMinor = parseAmountToMinor(amountText);
    const time = appearsIn(hay, r.time) ? r.time! : null;
    const occurredAt = appearsIn(hay, r.date) ? parseStatementDate(r.date, PDF_DATE_FORMATS, time) : null;
    if (!(appearsIn(hay, amountText) || appearsIn(hay, bareAmount)) || !amountMinor || !occurredAt) {
      dropped += 1;
      continue;
    }
    events.push({
      occurredAt,
      amountMinor: Math.abs(amountMinor),
      direction: r.direction,
      status: r.status ?? "success",
      counterpartyName: appearsIn(hay, r.counterparty) ? r.counterparty!.trim() : null,
      counterpartyVpa: null,
      narration: appearsIn(hay, r.description) ? r.description.trim() : null,
      referenceId: appearsIn(hay, r.reference) ? r.reference!.replace(/\s/g, "") : null,
      appTransactionId: null,
      balanceMinor: null,
      note: null,
    });
  }
  return { events, dropped };
}

/**
 * Reads one chunk. `columnsReference` is the statement's column header (found on page 1 or
 * wherever the table starts) so parts without a header of their own are read the same way.
 */
export async function readPdfChunkWithLlm(userId: string, lines: string[], first: boolean, columnsReference?: string | null) {
  const text = redactForExtraction(lines.join("\n"));
  const reference = columnsReference ? `\nThe statement's columns, from its header: ${columnsReference}` : "";
  const out = await runLlmTask({
    userId,
    task: "pdf_extraction",
    schema: chunkSchema,
    instructions: `${INSTRUCTIONS}${reference}${first ? "" : "\nThis is not the first part; leave source empty and isStatement true."}`,
    data: text,
  });
  if (first && out.isStatement === false) throw new AppError("NOT_A_STATEMENT");
  return { source: out.source ?? null, ...verifyLlmRows(text, out.rows) };
}
