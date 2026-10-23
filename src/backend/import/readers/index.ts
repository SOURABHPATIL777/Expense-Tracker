import "server-only";
import { AppError } from "@/backend/errors/AppError";
import type { ReaderId, ReadResult } from "@/backend/import/types";
import { formatForFileName, type FileFormat } from "@/shared/constants/sources";
import { readCsv } from "./csv";
import { readXlsx } from "./xlsx";
import { readPdfText } from "./pdfText";
import { readHtml } from "./html";
import { readJson } from "./json";

const READER_FOR_FORMAT: Record<FileFormat, ReaderId> = { csv: "csv", excel: "xlsx", pdf: "pdf_text", html: "html", json: "json" };

/** How each reader's files are named in import labels ("HDFC Bank statement (PDF)"). */
export const READER_LABELS: Record<ReaderId, string> = { csv: "CSV", xlsx: "Excel", pdf_text: "PDF", html: "HTML", json: "JSON" };

/** Detects the real format from the content (extensions lie), falling back to the extension. */
export function detectFormat(fileName: string, buffer: Buffer): FileFormat {
  const head = buffer.subarray(0, 8);
  if (head.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  const isZip = head[0] === 0x50 && head[1] === 0x4b; // .xlsx
  const isOle = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0; // legacy .xls
  if (isZip || isOle) return "excel";
  const byName = formatForFileName(fileName);
  // Some banks export an HTML/text table named .xls; SheetJS reads those as well.
  if (byName === "excel") return "excel";
  const start = buffer.subarray(0, 512).toString("utf8").replace(/^\uFEFF/, "").trimStart().toLowerCase();
  if (start.startsWith("{") || start.startsWith("[")) return "json";
  if (start.startsWith("<!doctype html") || start.startsWith("<html") || /^<(table|body|div|meta|head)[\s>]/.test(start)) return "html";
  if (byName) return byName;
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
    case "html":
      return readHtml(buffer);
    case "json":
      return readJson(buffer);
  }
}
