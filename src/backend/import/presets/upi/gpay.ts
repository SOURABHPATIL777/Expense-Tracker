import "server-only";
import type { ImportConfig } from "@/backend/import/types";

const MONTH = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*";

/**
 * Google Pay → Transaction history → Download statement (PDF). Rows look like:
 *   "05 Oct, 2024 Paid to Swiggy ₹250"
 *   "10:32 AM UPI Transaction ID: 427912345678"
 *   "Paid by HDFC Bank 1234"
 */
export const gpayPdf: ImportConfig = {
  id: "upi.gpay.pdf.v1",
  label: "Google Pay statement (PDF)",
  sourceKind: "upi_app",
  sourceApp: "gpay",
  reader: "pdf_text",
  verified: false,
  text: {
    detect: ["google pay", "upi transaction id"],
    recordStart: `^\\d{1,2} ${MONTH},? \\d{4}\\b`,
    ignoreLines: ["^Page \\d+", "^Date\\s*(?:&|and)?\\s*time", "^Transaction statement"],
    fields: {
      date: `^(?<date>\\d{1,2} ${MONTH},? \\d{4})`,
      time: "(?<time>\\d{1,2}:\\d{2}\\s?[AaPp][Mm])",
      amount: "(?:₹|INR|Rs\\.?)\\s?(?<amount>[\\d,]+(?:\\.\\d{1,2})?)",
      debitWhen: "\\b(?:Paid to|Sent to)\\b",
      creditWhen: "\\b(?:Received from|Refund from)\\b",
      narration: `^\\d{1,2} ${MONTH},? \\d{4}\\s+(?<narration>.+?)\\s+(?:₹|INR|Rs)`,
      counterparty: "(?:Paid to|Sent to|Received from|Refund from)\\s+(?<counterparty>.+?)\\s+(?:₹|INR|Rs)",
      reference: "UPI Transaction ID:?\\s*(?<reference>\\d{10,})",
    },
    status: [
      { when: "\\b(?:Failed|Declined)\\b", status: "failed" },
      { when: "\\bPending\\b", status: "pending" },
    ],
    dateFormats: ["dd MMM, yyyy", "d MMM, yyyy", "dd MMM yyyy", "d MMM yyyy", "dd MMMM, yyyy", "d MMMM, yyyy"],
  },
};
