import "server-only";
import { getDocumentProxy } from "unpdf";
import { AppError } from "@/backend/errors/AppError";
import { buildPdfTable, lineText, toLines, type PdfItem } from "@/backend/import/pdfTable";
import type { TextRead } from "@/backend/import/types";

type RawTextItem = { str?: string; transform?: number[]; width?: number };

/**
 * Text-based PDFs only (no OCR). Pages are read one at a time and released (page.cleanup()) as
 * soon as their positioned text is captured. Returns the visual lines (for the AI reader) and,
 * when the statement is laid out as a table, the rebuilt table. The password, if any, is used in
 * memory for this call and never stored.
 */
export async function readPdfText(buffer: Buffer, password?: string): Promise<TextRead> {
  let doc;
  try {
    doc = await getDocumentProxy(new Uint8Array(buffer), { password });
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === "PasswordException") throw new AppError("PASSWORD_REQUIRED", { message: password ? "That password is incorrect." : undefined });
    throw new AppError("IMPORT_UNREADABLE", { cause: err });
  }
  try {
    const pages: PdfItem[][] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      try {
        const content = await page.getTextContent();
        pages.push(
          (content.items as RawTextItem[])
            .filter((i) => i.str?.trim() && i.transform)
            .map((i) => ({ str: i.str!, x: i.transform![4], y: i.transform![5], w: i.width ?? 0 })),
        );
      } finally {
        page.cleanup();
      }
    }
    const lines = pages.flatMap((items) => toLines(items).map(lineText));
    if (lines.length === 0) {
      throw new AppError("IMPORT_UNREADABLE", { message: "This PDF has no selectable text (it may be a scanned image)." });
    }
    return { kind: "text", lines, table: buildPdfTable(pages) ?? undefined };
  } finally {
    await doc.destroy();
  }
}
