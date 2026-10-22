import "server-only";
import { z } from "zod";
import { AppError } from "@/backend/errors/AppError";
import type { SourceApp, SourceKind } from "@/backend/constants/enums.constants";
import { headerSignature, normalizeHeader } from "./text";
import type { AmountSpec, ExtractResult, ImportConfig, TableColumns, TableRead } from "./types";

/** Date formats a mapping may choose (tokens understood by the date parser in ./dates). */
export const DATE_FORMAT_OPTIONS = [
  "dd/MM/yyyy",
  "dd-MM-yyyy",
  "dd/MM/yy",
  "dd-MM-yy",
  "MM/dd/yyyy",
  "yyyy-MM-dd",
  "d MMM yyyy",
  "dd MMM yyyy",
  "dd-MMM-yyyy",
  "dd-MMM-yy",
  "MMM dd, yyyy",
  "dd MMM, yyyy",
  "dd/MM/yyyy HH:mm:ss",
  "dd-MM-yyyy HH:mm:ss",
  "yyyy-MM-dd HH:mm:ss",
] as const;

const columnIndex = z.number().int().min(0).max(200);
const optionalColumn = columnIndex.nullish().transform((v) => v ?? undefined);

/** Which column holds what, by zero-based index into the header row. Produced by the LLM. */
export const mappingSchema = z.object({
  headerRowIndex: z.number().int().min(0).max(100),
  columns: z.object({
    date: columnIndex,
    time: optionalColumn,
    narration: optionalColumn,
    counterparty: optionalColumn,
    vpa: optionalColumn,
    reference: optionalColumn,
    appTransactionId: optionalColumn,
    balance: optionalColumn,
    note: optionalColumn,
  }),
  amount: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("split"), debit: columnIndex, credit: columnIndex }),
    z.object({ mode: z.literal("signed"), amount: columnIndex }),
    z.object({
      mode: z.literal("typed"),
      amount: columnIndex,
      type: columnIndex,
      debitValues: z.array(z.string().trim().min(1).max(40)).min(1).max(10),
      creditValues: z.array(z.string().trim().min(1).max(40)).min(1).max(10),
    }),
  ]),
  dateFormat: z.enum(DATE_FORMAT_OPTIONS),
});
export type MappingInput = z.infer<typeof mappingSchema>;

/** Turns a column mapping (indexes) into the same declarative config stored layouts use. */
export function configFromMapping(input: MappingInput, header: string[], source: { sourceKind: SourceKind; sourceApp: SourceApp; label: string }): ImportConfig {
  const names = header.map(normalizeHeader);
  const col = (i: number | undefined): string[] | undefined => {
    if (i === undefined) return undefined;
    const name = names[i];
    if (!name) throw new AppError("VALIDATION", { message: `Column ${i + 1} has no header name.` });
    return [name];
  };

  const columns: TableColumns = {
    date: col(input.columns.date)!,
    time: col(input.columns.time),
    narration: col(input.columns.narration),
    counterparty: col(input.columns.counterparty),
    vpa: col(input.columns.vpa),
    reference: col(input.columns.reference),
    appTransactionId: col(input.columns.appTransactionId),
    balance: col(input.columns.balance),
    note: col(input.columns.note),
  };

  const a = input.amount;
  const amount: AmountSpec =
    a.mode === "split"
      ? { mode: "split", debit: col(a.debit)!, credit: col(a.credit)! }
      : a.mode === "signed"
        ? { mode: "signed", amount: col(a.amount)! }
        : { mode: "typed", amount: col(a.amount)!, type: col(a.type)!, debitValues: a.debitValues, creditValues: a.creditValues };

  return {
    id: `llm:${headerSignature(header).slice(0, 80)}`,
    label: source.label,
    sourceKind: source.sourceKind,
    sourceApp: source.sourceApp,
    reader: "table",
    verified: false,
    table: { headerMatch: names.filter(Boolean), columns, amount, dateFormats: [input.dateFormat] },
  };
}

/** Share of candidate rows a config parsed; used to accept or reject an LLM-proposed mapping. */
export function parsedShare(result: ExtractResult): { share: number; parsed: number; total: number; failures: string[] } {
  const total = result.rows.length;
  const parsed = result.rows.filter((r) => r.parsed).length;
  const failures = result.rows.filter((r) => !r.parsed).slice(0, 3).map((r) => `row ${r.rowIndex + 1}: ${r.error}`);
  return { share: total ? parsed / total : 0, parsed, total, failures };
}

const AMOUNT_LIKE = /^[+-]?\s*(₹|rs\.?|inr)?\s*[\d,]+\.\d{1,2}(\s*(dr|cr))?$/i;

/**
 * Checks an LLM mapping beyond "the rows parse": each column holds one field, and identifier
 * columns don't hold money. Returns the problems found (empty when the mapping is sound).
 */
export function mappingProblems(input: MappingInput, read: TableRead): string[] {
  const problems: string[] = [];
  const a = input.amount;
  const amountColumns: Record<string, number> = a.mode === "split" ? { debit: a.debit, credit: a.credit } : a.mode === "signed" ? { amount: a.amount } : { amount: a.amount, type: a.type };
  const used = Object.entries({ ...input.columns, ...amountColumns });
  const byIndex = new Map<number, string[]>();
  for (const [field, index] of used) if (index !== undefined) byIndex.set(index, [...(byIndex.get(index) ?? []), field]);
  for (const [index, fields] of byIndex) if (fields.length > 1) problems.push(`column ${index} was used for ${fields.join(" and ")}; each column holds one field`);

  const dataRows = read.rows.slice(input.headerRowIndex + 1);
  for (const field of ["reference", "appTransactionId"] as const) {
    const index = input.columns[field];
    if (index === undefined) continue;
    const values = dataRows.map((r) => r[index]?.trim()).filter((v): v is string => Boolean(v));
    if (values.length && values.filter((v) => AMOUNT_LIKE.test(v)).length * 2 > values.length) {
      problems.push(`the ${field} column holds amounts (e.g. "${values[0]}"); choose the UTR/reference column or omit it`);
    }
  }
  return problems;
}
