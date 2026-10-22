import "server-only";
import * as XLSX from "xlsx";
import { AppError } from "@/backend/errors/AppError";
import { cleanCell, looksLikeTransactionRow } from "@/backend/import/text";
import type { TableRead } from "@/backend/import/types";

const pad = (n: number) => String(n).padStart(2, "0");

/** Converts an Excel date serial to `yyyy-MM-dd HH:mm:ss` without any timezone shifting. */
function serialToText(serial: number): string {
  const d = XLSX.SSF.parse_date_code(serial) as { y: number; m: number; d: number; H: number; M: number; S: number };
  return `${d.y}-${pad(d.m)}-${pad(d.d)} ${pad(d.H)}:${pad(d.M)}:${pad(Math.floor(d.S))}`;
}

function cellText(cell: XLSX.CellObject | undefined): string {
  if (!cell) return "";
  if (cell.t === "n" && typeof cell.v === "number") {
    if (cell.z && XLSX.SSF.is_date(cell.z)) return serialToText(cell.v);
    return String(cell.v);
  }
  if (cell.t === "d" && cell.v instanceof Date) return cell.v.toISOString().slice(0, 19).replace("T", " ");
  return cleanCell(cell.w ?? cell.v);
}

function sheetRows(sheet: XLSX.WorkSheet | undefined): string[][] {
  if (!sheet?.["!ref"]) return [];
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const rows: string[][] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) row.push(cellText(sheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined));
    if (row.some(Boolean)) rows.push(row);
  }
  return rows;
}

/**
 * The sheet holding the transactions: the one with the most date + amount rows. Exports often
 * put a summary first (Paytm: "Summary", then "Passbook Payment History"). Falls back to the
 * first non-empty sheet.
 */
export function readXlsx(buffer: Buffer): TableRead {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer", cellDates: false, cellNF: true, dense: false });
  } catch (err) {
    const message = (err as Error).message ?? "";
    if (/password|encrypt/i.test(message)) {
      throw new AppError("IMPORT_UNREADABLE", { message: "This Excel file is password protected. Open it, remove the password, save, and upload again." });
    }
    throw new AppError("IMPORT_UNREADABLE", { cause: err });
  }
  const sheets = workbook.SheetNames.map((name) => sheetRows(workbook.Sheets[name])).filter((rows) => rows.length > 0);
  let best = sheets[0] ?? [];
  let bestScore = 0;
  for (const rows of sheets) {
    const score = rows.filter(looksLikeTransactionRow).length;
    if (score > bestScore) [best, bestScore] = [rows, score];
  }
  return { kind: "table", rows: best };
}
