import "server-only";
import { z } from "zod";
import { AppError } from "@/backend/errors/AppError";
import { COLUMN_MAPPING } from "@/backend/constants/llm.constants";
import { SOURCE_APPS, SOURCE_KINDS } from "@/backend/constants/enums.constants";
import { SOURCE_APP_LABELS } from "@/shared/constants/labels";
import { extract } from "@/backend/import/engine";
import { configFromMapping, mappingProblems, mappingSchema, parsedShare } from "@/backend/import/mapping";
import type { ImportConfig, TableRead } from "@/backend/import/types";
import { redactForLlm } from "./redact";
import { runLlmTask } from "./run";

const responseSchema = mappingSchema.extend({
  /** False for anything that isn't a transaction statement (invoice, payslip, price list, …). */
  isStatement: z.boolean().default(true),
  sourceKind: z.enum(SOURCE_KINDS),
  sourceApp: z.enum(SOURCE_APPS),
});

const INSTRUCTIONS = `You are given the first rows of a table from a file a user uploaded as their bank or UPI-app statement
(CSV, Excel, or a table read from a PDF, HTML or JSON file).
First decide isStatement: true only for a bank account, credit card or UPI app transaction statement (rows of dated
payments/receipts with amounts). Invoices, receipts, salary slips, price lists, resumes and other documents are not statements.
If it is a statement, work out:
- sourceKind: "upi_app" (PhonePe, Google Pay, Paytm, other UPI app) or "bank";
- sourceApp: the app or bank that produced it. Look first at documentStart (the top of the document: bank name, logo
  text, IFSC prefix such as UTIB=Axis, KKBK=Kotak, AUBL=AU, HDFC=HDFC, ICIC=ICICI, SBIN=SBI) and the file name; the
  rows' narrations mention other banks and apps, so never decide from them alone. Use "other_upi" / "other_bank" if unsure;
- headerRowIndex: zero-based index of the row holding the column names (statements often start with account details);
- columns: zero-based column index for each field present (date is required; omit fields that aren't there);
- amount: "split" if withdrawals and deposits are separate columns, "signed" if one amount column uses -/+ or Dr/Cr, or "typed" if an amount column is paired with a type column (give the exact type values meaning money out/in);
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
export async function mapColumnsWithLlm(
  userId: string,
  fileName: string,
  read: TableRead,
  formatLabel = "CSV/Excel",
  /** The first lines of the whole document (title, bank name, account header), to tell which bank it is. */
  documentStart: readonly string[] = [],
): Promise<LlmMappingResult> {
  const start = documentStart.slice(0, COLUMN_MAPPING.DOCUMENT_START_LINES).map((l) => redactForLlm(l).slice(0, COLUMN_MAPPING.CELL_CHARS * 2));
  const sample = read.rows.slice(0, COLUMN_MAPPING.SAMPLE_ROWS).map((r, i) => ({
    row: i,
    cells: r.map((c) => redactForLlm(c).slice(0, COLUMN_MAPPING.CELL_CHARS)),
  }));
  let feedback: string | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const out: z.infer<typeof responseSchema> = await runLlmTask({
      userId,
      task: "column_mapping",
      schema: responseSchema,
      instructions: INSTRUCTIONS,
      data: JSON.stringify({ fileName: redactForLlm(fileName), documentStart: start, rows: sample, ...(feedback && { problemsWithPreviousAnswer: feedback }) }),
    });
    if (out.isStatement === false) throw new AppError("NOT_A_STATEMENT");
    const header = read.rows[out.headerRowIndex];
    if (!header) {
      feedback = `headerRowIndex ${out.headerRowIndex} does not exist`;
      continue;
    }
    let config: ImportConfig;
    try {
      config = configFromMapping(out, header, {
        sourceKind: out.sourceKind,
        sourceApp: out.sourceApp,
        label: `${SOURCE_APP_LABELS[out.sourceApp]} statement (${formatLabel})`,
      });
    } catch (err) {
      feedback = err instanceof Error ? err.message : "invalid column choice";
      continue;
    }
    const quality = parsedShare(extract(read, config));
    if (quality.parsed === 0 || quality.share < COLUMN_MAPPING.MIN_PARSED_SHARE) {
      feedback = `only ${quality.parsed} of ${quality.total} rows parsed; examples: ${quality.failures.join("; ") || "none"}`;
      continue;
    }
    const problems = mappingProblems(out, read);
    if (problems.length === 0) return { config, sourceKind: out.sourceKind, sourceApp: out.sourceApp };
    feedback = problems.join("; ");
  }
  throw new AppError("IMPORT_UNREADABLE", { message: "We couldn't work out this file's columns. Try exporting it again, or as a different format." });
}
