import "server-only";
import type { ImportConfig } from "@/backend/import/types";

const MONTH = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)";

/**
 * PhonePe app → History → Download statement (PDF, often password-protected with your phone number).
 * Each transaction starts with a date line such as:
 *   "Oct 05, 2024 Paid to Swiggy DEBIT ₹350"
 *   "10:32 am Transaction ID T2410051032123456789"
 *   "UTR No. 427912345678"
 *   "Paid by XXXXXXXX1234"
 */
export const phonepePdf: ImportConfig = {
  id: "upi.phonepe.pdf.v1",
  label: "PhonePe statement (PDF)",
  sourceKind: "upi_app",
  sourceApp: "phonepe",
  reader: "pdf_text",
  verified: false,
  text: {
    detect: ["phonepe", "transaction id"],
    recordStart: `^${MONTH} \\d{1,2},? \\d{4}\\b`,
    ignoreLines: ["^Page \\d+ of \\d+", "^Date\\s+Transaction Details", "system generated", "^Transaction Statement", `^${MONTH} \\d{1,2},? \\d{4}\\s*-\\s*${MONTH}`],
    fields: {
      date: `^(?<date>${MONTH} \\d{1,2},? \\d{4})`,
      time: "(?<time>\\d{1,2}:\\d{2}\\s?[ap]m)",
      amount: "(?:₹|INR|Rs\\.?)\\s?(?<amount>[\\d,]+(?:\\.\\d{1,2})?)",
      debitWhen: "\\bDEBIT\\b",
      creditWhen: "\\bCREDIT\\b",
      narration: `^${MONTH} \\d{1,2},? \\d{4}\\s+(?<narration>.+?)\\s+(?:DEBIT|CREDIT)\\b`,
      counterparty:
        "(?:Paid to|Received from|Payment to|Transfer to|Refund from|Sent to|Bill paid -|Mobile recharged)\\s+(?<counterparty>.+?)\\s+(?:DEBIT|CREDIT)\\b",
      appTransactionId: "Transaction ID\\s*:?\\s*(?<appTransactionId>[A-Z0-9]{8,})",
      reference: "UTR No\\.?\\s*:?\\s*(?<reference>\\d{10,})",
    },
    status: [
      { when: "\\bFailed\\b", status: "failed" },
      { when: "\\bPending\\b", status: "pending" },
    ],
    dateFormats: ["MMM dd, yyyy", "MMM d, yyyy", "MMM dd yyyy", "MMM d yyyy"],
  },
};
