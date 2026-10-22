import "server-only";
import { z } from "zod";
import { AppError } from "@/backend/errors/AppError";
import { COLUMN_MAPPING } from "@/backend/constants/llm.constants";
import { SOURCE_APPS, SOURCE_KINDS } from "@/backend/constants/enums.constants";
import { SOURCE_APP_LABELS } from "@/shared/constants/labels";
import { extract } from "@/backend/import/engine";
import { configFromMapping, mappingSchema, parsedShare } from "@/backend/import/mapping";
import type { ImportConfig, TableRead } from "@/backend/import/types";
import { redactForLlm } from "./redact";
import { runLlmTask } from "./run";

const responseSchema = mappingSchema.extend({
  sourceKind: z.enum(SOURCE_KINDS),
  sourceApp: z.enum(SOURCE_APPS),
});

const INSTRUCTIONS = `You are given the first rows of an Indian bank or UPI-app statement exported as CSV/Excel.
Work out:
- sourceKind: "upi_app" (PhonePe, Google Pay, Paytm, other UPI app) or "bank";
- sourceApp: the app or bank that produced it (use "other_upi" / "other_bank" if unsure);
- headerRowIndex: zero-based index of the row holding the column names (statements often start with account details);
- columns: zero-based column index for each field present (date is required; omit fields that aren't there);
- amount: "split" if withdrawals and deposits are separate columns, "signed" if one amount column uses -/+ or Dr/Cr, or "typed" if an amount column is paired with a type column (give the exact type values meaning money out/in);
- dateFormat: the format of the date column, chosen from the allowed list.
Answer only from what is in the rows.`;

export type LlmMappingResult = { config: ImportConfig; sourceKind: ImportConfig["sourceKind"]; sourceApp: ImportConfig["sourceApp"] };

/**
 * Asks the LLM how to read an unknown CSV/Excel layout, then proves the answer on the file itself:
 * the mapping is accepted only if most data rows parse with valid dates and amounts.
 * One retry with the problems described; otherwise the import fails.
 */
export async function mapColumnsWithLlm(userId: string, fileName: string, read: TableRead): Promise<LlmMappingResult> {
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
      data: JSON.stringify({ fileName: redactForLlm(fileName), rows: sample, ...(feedback && { problemsWithPreviousAnswer: feedback }) }),
    });
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
        label: `${SOURCE_APP_LABELS[out.sourceApp]} statement (CSV/Excel)`,
      });
    } catch (err) {
      feedback = err instanceof Error ? err.message : "invalid column choice";
      continue;
    }
    const quality = parsedShare(extract(read, config));
    if (quality.parsed > 0 && quality.share >= COLUMN_MAPPING.MIN_PARSED_SHARE) {
      return { config, sourceKind: out.sourceKind, sourceApp: out.sourceApp };
    }
    feedback = `only ${quality.parsed} of ${quality.total} rows parsed; examples: ${quality.failures.join("; ") || "none"}`;
  }
  throw new AppError("IMPORT_UNREADABLE", { message: "We couldn't work out this file's columns. Try exporting it again, or as a different format." });
}
