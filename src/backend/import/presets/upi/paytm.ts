import "server-only";
import type { ImportConfig } from "@/backend/import/types";

/**
 * Paytm app → Balance & History → Download UPI statement (Excel/CSV).
 * Amounts are signed ("-350.00" paid, "+500.00" received).
 */
export const paytmTable: ImportConfig = {
  id: "upi.paytm.table.v1",
  label: "Paytm UPI statement (CSV/Excel)",
  sourceKind: "upi_app",
  sourceApp: "paytm",
  reader: "table",
  verified: false,
  table: {
    headerMatch: ["date", "transaction details", "your account", "amount", "upi ref no"],
    columns: {
      date: ["date"],
      time: ["time"],
      narration: ["transaction details"],
      counterparty: ["transaction details"],
      vpa: ["other transaction details upi id or a c no", "other transaction details"],
      reference: ["upi ref no"],
      appTransactionId: ["order id"],
      note: ["comment", "remarks"],
    },
    amount: { mode: "signed", amount: ["amount"] },
    status: { column: ["status"], map: { success: "success", successful: "success", failed: "failed", pending: "pending" } },
    dateFormats: ["dd/MM/yyyy", "d MMM yyyy", "dd MMM yyyy", "dd-MM-yyyy"],
  },
};

const MONTH = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)";

/**
 * Paytm UPI statement (PDF). Rows look like:
 *   "05 Oct 2024 Paid to Swiggy - Rs.350"
 *   "10:32 AM UPI Ref No: 427912345678 Order ID: 2024100512345"
 */
export const paytmPdf: ImportConfig = {
  id: "upi.paytm.pdf.v1",
  label: "Paytm UPI statement (PDF)",
  sourceKind: "upi_app",
  sourceApp: "paytm",
  reader: "pdf_text",
  verified: false,
  text: {
    detect: ["paytm", "upi ref"],
    recordStart: `^\\d{1,2} ${MONTH} \\d{4}\\b`,
    ignoreLines: ["^Page \\d+", "^Date\\s*(?:&|and)?\\s*Time", "^Passbook"],
    fields: {
      date: `^(?<date>\\d{1,2} ${MONTH} \\d{4})`,
      time: "(?<time>\\d{1,2}:\\d{2}\\s?[AaPp][Mm])",
      amount: "(?:₹|Rs\\.?|INR)\\s?[-+]?\\s?(?<amount>[\\d,]+(?:\\.\\d{1,2})?)",
      debitWhen: "\\b(?:Paid to|Sent to|Money sent to)\\b|-\\s?(?:₹|Rs)",
      creditWhen: "\\b(?:Received from|Refund from|Money received)\\b|\\+\\s?(?:₹|Rs)",
      narration: `^\\d{1,2} ${MONTH} \\d{4}\\s+(?<narration>.+?)\\s+[-+]?\\s?(?:₹|Rs)`,
      counterparty: "(?:Paid to|Sent to|Money sent to|Received from|Refund from)\\s+(?<counterparty>.+?)(?:\\s+[-+]?\\s?(?:₹|Rs)|$)",
      reference: "UPI Ref(?:erence)?\\s*(?:No\\.?|ID)?:?\\s*(?<reference>\\d{10,})",
      appTransactionId: "Order ID:?\\s*(?<appTransactionId>\\w{6,})",
    },
    status: [
      { when: "\\bFailed\\b", status: "failed" },
      { when: "\\bPending\\b", status: "pending" },
    ],
    dateFormats: ["dd MMM yyyy", "d MMM yyyy"],
  },
};
