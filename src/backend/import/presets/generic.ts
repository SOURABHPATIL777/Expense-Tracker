import "server-only";
import type { ImportConfig } from "@/backend/import/types";
import { bankPdfSpec } from "./bank/bankPreset";

/**
 * Last-resort parser for any text PDF laid out as "date … amount balance" rows (most bank and
 * many wallet statements). It has no detection signature, so every specific preset wins over it.
 * CSV/Excel files without a preset go to the column mapper instead.
 */
export const genericPdf: ImportConfig = {
  id: "generic.pdf.v1",
  label: "Generic statement (PDF)",
  sourceKind: "bank",
  sourceApp: "other_bank",
  reader: "pdf_text",
  verified: false,
  text: bankPdfSpec([], []),
};
