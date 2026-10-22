import "server-only";
import { AppError } from "@/backend/errors/AppError";
import type { ReaderId, ReadResult } from "@/backend/import/types";
import { formatForFileName, type FileFormat } from "@/shared/constants/sources";
import { readCsv } from "./csv";
import { readXlsx } from "./xlsx";
import { readPdfText } from "./pdfText";

const READER_FOR_FORMAT: Record<FileFormat, ReaderId> = { csv: "csv", excel: "xlsx", pdf: "pdf_text" };

/** Detects the real format from magic bytes (extensions lie), falling back to the extension for CSV. */
export function detectFormat(fileName: string, buffer: Buffer): FileFormat {
  const head = buffer.subarray(0, 8);
  if (head.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  const isZip = head[0] === 0x50 && head[1] === 0x4b; // .xlsx
  const isOle = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0; // legacy .xls
  if (isZip || isOle) return "excel";
  const byName = formatForFileName(fileName);
  // Some banks export an HTML/text table named .xls; SheetJS reads those as well.
  if (byName === "excel") return "excel";
  if (byName === "csv") return "csv";
  throw new AppError("UNSUPPORTED_FILE");
}

export const readerFor = (format: FileFormat): ReaderId => READER_FOR_FORMAT[format];

export async function readFile(reader: ReaderId, buffer: Buffer, password?: string): Promise<ReadResult> {
  switch (reader) {
    case "csv":
      return readCsv(buffer);
    case "xlsx":
      return readXlsx(buffer);
    case "pdf_text":
      return readPdfText(buffer, password);
  }
}
