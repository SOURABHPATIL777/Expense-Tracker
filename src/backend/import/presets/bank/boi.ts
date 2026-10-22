import "server-only";
import { bankPreset, split } from "./bankPreset";

// Bank of India (BOI Mobile / Star Connect) → Account statement.
export const boi = bankPreset({
  bank: "boi",
  headerMatch: ["txn date", "description", "withdrawal", "deposit"],
  columns: { date: ["txn date"], narration: ["description"], reference: ["cheque no"], balance: ["balance"] },
  amount: split(["withdrawal dr", "withdrawal"], ["deposit cr", "deposit"]),
  dateFormats: ["dd/MM/yyyy", "dd-MM-yyyy"],
});
