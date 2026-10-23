import "server-only";
import { headerSignature, looksLikeHeaderRow, looksLikeTransactionRow } from "./text";
import type { TableRead } from "./types";

/**
 * One table inside a file: its header and the rows under it, each with its position in the
 * original file (so row numbers stay unique across sections, sheets and pages).
 */
export type Section = { read: TableRead; rowIndexes: number[]; signature: string };

const sectionOf = (header: string[], headerIndex: number, rows: Array<{ index: number; cells: string[] }>): Section => ({
  read: { kind: "table", rows: [header, ...rows.map((r) => r.cells)] },
  rowIndexes: [headerIndex, ...rows.map((r) => r.index)],
  signature: headerSignature(header),
});

/**
 * Splits a sheet (or several sheets / PDF pages laid end to end) into its tables. Each header row
 * starts a section; a repeated identical header (page or sheet break) continues the current one,
 * and rows without a header of their own join the section before them. Rows before the first
 * header (account details, summaries) are skipped. Sections without transaction rows are dropped.
 *
 * With no recognisable header at all, the whole table is one section: the column-mapping step
 * finds the header itself, as it always has.
 */
export function splitSections(read: TableRead): Section[] {
  const sections: Array<{ header: string[]; headerIndex: number; rows: Array<{ index: number; cells: string[] }> }> = [];
  read.rows.forEach((cells, index) => {
    if (cells.every((c) => !c.trim())) return;
    const current = sections.at(-1);
    if (looksLikeHeaderRow(cells)) {
      if (current && headerSignature(current.header) === headerSignature(cells)) return;
      sections.push({ header: cells, headerIndex: index, rows: [] });
      return;
    }
    current?.rows.push({ index, cells });
  });

  const useful = sections.filter((s) => s.rows.some((r) => looksLikeTransactionRow(r.cells)));
  if (useful.length === 0) return [{ read, rowIndexes: read.rows.map((_, i) => i), signature: "" }];
  return useful.map((s) => sectionOf(s.header, s.headerIndex, s.rows));
}
