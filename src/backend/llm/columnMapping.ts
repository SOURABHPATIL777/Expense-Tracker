import "server-only";
import { z } from "zod";
import { AppError } from "@/backend/errors/AppError";
import { COLUMN_MAPPING } from "@/backend/constants/llm.constants";
import { SOURCE_APPS, SOURCE_KINDS } from "@/backend/constants/enums.constants";
import { SOURCE_APP_LABELS } from "@/shared/constants/labels";
import { configFromMapping, mappingProblems, mappingSchema } from "@/backend/import/mapping";
import { proveMapping } from "@/backend/import/proveMapping";
import { looksLikeHeaderRow, looksLikeTransactionRow } from "@/backend/import/text";
import type { ImportConfig, TableRead } from "@/backend/import/types";
import { redactForLlm } from "./redact";
import { runLlmTask } from "./run";

const responseSchema = mappingSchema.extend({
  /** False for anything that isn't a transaction statement (invoice, payslip, price list, …). */
  isStatement: z.boolean().default(true),
  sourceKind: z.enum(SOURCE_KINDS),
  sourceApp: z.enum(SOURCE_APPS),
});

const INSTRUCTIONS = `You are given the column header and up to 5 redacted rows of a table from a file a user uploaded as
their bank or UPI-app statement (CSV, Excel, or a table read from a PDF, HTML or JSON file). You never see the file itself.
First decide isStatement: true only for a bank account, credit card or UPI app transaction statement (rows of dated
payments/receipts with amounts). Invoices, receipts, salary slips, price lists, resumes and other documents are not statements.
If it is a statement, work out:
- sourceKind: "upi_app" (PhonePe, Google Pay, Paytm, other UPI app) or "bank";
- sourceApp: the app or bank, only if the header or file name makes it clear; otherwise "other_upi" / "other_bank"
  (narrations mention other banks and apps, so never decide from them);
- headerRowIndex: zero-based index (within the rows given) of the row holding the column names;
- columns: zero-based column index for each field present (date is required; omit fields that aren't there);
- amount: "split" if withdrawals and deposits are separate columns, "signed" if one amount column uses -/+ or Dr/Cr,
  "typed" if an amount column is paired with a type column (give the exact type values meaning money out/in), or
  "balance" if amounts are unsigned and only the running balance shows the direction;
- dateFormat: the format of the date column, chosen from the allowed list.
Each column index may be used for one field only. reference is the UTR / UPI ref / cheque-ref column, never an amount.
Answer only from what is in the rows.`;

export type LlmMappingResult = { config: ImportConfig; sourceKind: ImportConfig["sourceKind"]; sourceApp: ImportConfig["sourceApp"] };

/**
 * Asks the LLM how to read an unknown CSV/Excel layout, then proves the answer on the file itself:
 * the mapping is accepted only if most data rows parse with valid dates and amounts, and no column
 * is used twice or holds the wrong kind of value (a learned layout is shared with every user).
 * One retry with the problems described; otherwise the import fails.
 */
export async function mapColumnsWithLlm(userId: string, fileName: string, read: TableRead, formatLabel = "CSV/Excel"): Promise<LlmMappingResult> {
  // Only the header and a handful of rows go to the model, never the file: from the header if
  // one is recognisable, else from just above the first transaction-like row.
  const header = read.rows.findIndex((r) => looksLikeHeaderRow(r));
  const firstTx = Math.max(0, read.rows.findIndex((r) => looksLikeTransactionRow(r)));
  const start = header >= 0 && header <= firstTx ? header : Math.max(0, firstTx - 2);
  const end = (header >= 0 && header <= firstTx ? header + 1 : firstTx) + COLUMN_MAPPING.SAMPLE_ROWS;
  const sample = read.rows.slice(start, end).map((r, i) => ({
    row: i,
    cells: r.map((c) => redactForLlm(c).slice(0, COLUMN_MAPPING.CELL_CHARS)),
  }));
  let feedback: string | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const answer: z.infer<typeof responseSchema> = await runLlmTask({
      userId,
      task: "column_mapping",
      schema: responseSchema,
      instructions: INSTRUCTIONS,
      data: JSON.stringify({ fileName: redactForLlm(fileName), rows: sample, ...(feedback && { problemsWithPreviousAnswer: feedback }) }),
    });
    if (answer.isStatement === false) throw new AppError("NOT_A_STATEMENT");
    // The model counted rows within the sample; translate back to the whole table.
    const out = { ...answer, headerRowIndex: answer.headerRowIndex + start };
    const headerRow = read.rows[out.headerRowIndex];
    if (!headerRow || answer.headerRowIndex >= sample.length) {
      feedback = `headerRowIndex ${answer.headerRowIndex} does not exist`;
      continue;
    }
    let config: ImportConfig;
    try {
      config = configFromMapping(out, headerRow, {
        sourceKind: out.sourceKind,
        sourceApp: out.sourceApp,
        label: `${SOURCE_APP_LABELS[out.sourceApp]} statement (${formatLabel})`,
      });
    } catch (err) {
      feedback = err instanceof Error ? err.message : "invalid column choice";
      continue;
    }
    const problems = mappingProblems(out, read);
    if (problems.length) {
      feedback = problems.join("; ");
      continue;
    }
    // Same proof as a local mapping: rows parse and running balances reconcile.
    const proof = proveMapping(read, config);
    if (proof.ok) return { config: proof.config, sourceKind: out.sourceKind, sourceApp: out.sourceApp };
    feedback = proof.problems;
  }
  throw new AppError("IMPORT_UNREADABLE", { message: "We couldn't work out this file's columns. Try exporting it again, or as a different format." });
}
