import "server-only";
import { extractTextItems, getDocumentProxy } from "unpdf";
import { AppError } from "@/backend/errors/AppError";
import type { TextRead } from "@/backend/import/types";

/** Items whose baselines differ by less than this (PDF units) are on the same visual line. */
const LINE_TOLERANCE = 2.5;

type Item = { str: string; x: number; y: number };

/** Rebuilds visual lines from positioned text items (top-to-bottom, left-to-right). */
function toLines(items: Item[]): string[] {
  const sorted = items.filter((i) => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Item[][] = [];
  for (const item of sorted) {
    const current = lines.at(-1);
    if (current && Math.abs(current[0].y - item.y) <= LINE_TOLERANCE) current.push(item);
    else lines.push([item]);
  }
  return lines.map((line) =>
    line
      .sort((a, b) => a.x - b.x)
      .map((i) => i.str.trim())
      .join(" ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

/**
 * Text-based PDFs only (no OCR). The password, if any, is used in memory for this call and never stored.
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
    const { items } = await extractTextItems(doc);
    const lines = items.flatMap((pageItems) => toLines(pageItems));
    if (lines.length === 0) {
      throw new AppError("IMPORT_UNREADABLE", { message: "This PDF has no selectable text (it may be a scanned image)." });
    }
    return { kind: "text", lines };
  } finally {
    await doc.destroy();
  }
}
