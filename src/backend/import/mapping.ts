import "server-only";
import { AppError } from "@/backend/errors/AppError";
import type { SourceApp, SourceKind } from "@/backend/constants/enums.constants";
import type { MappingInput } from "@/shared/schemas/imports";
import { findHeaderRow } from "./engine";
import { headerSignature, normalizeHeader } from "./text";
import type { AmountSpec, ImportConfig, TableColumns } from "./types";

const HEADER_SCAN_ROWS = 40;

/** Turns the column mapper's choices (column indexes) into the same declarative config presets use. */
export function configFromMapping(
  input: MappingInput,
  header: string[],
  source: { sourceKind: SourceKind; sourceApp: SourceApp; templateId?: string },
): ImportConfig {
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
    id: source.templateId ? `template:${source.templateId}` : "mapping:one-off",
    label: "Your column mapping",
    sourceKind: source.sourceKind,
    sourceApp: source.sourceApp,
    reader: "table",
    verified: true,
    table: { headerMatch: names.filter(Boolean), columns, amount, dateFormats: [input.dateFormat] },
  };
}

/** Candidate header signatures in a table's first rows, for looking up saved templates. */
export function headerSignatures(rows: string[][]): string[] {
  return rows.slice(0, HEADER_SCAN_ROWS).map(headerSignature).filter((s) => s.split("|").length >= 3);
}

/** Best guess at which row holds the column names: the first row with several text cells and no amounts. */
export function suggestHeaderRow(rows: string[][]): number {
  const limit = Math.min(rows.length, HEADER_SCAN_ROWS);
  for (let i = 0; i < limit; i++) {
    const cells = rows[i].filter(Boolean);
    if (cells.length >= 3 && cells.every((c) => !/^[-+]?[\d,]+(\.\d+)?$/.test(c))) {
      // Prefer a row that looks like a statement header over a title row.
      if (cells.some((c) => /date/i.test(c))) return i;
    }
  }
  return Math.max(0, findHeaderRow(rows, { headerMatch: ["date"] }));
}
