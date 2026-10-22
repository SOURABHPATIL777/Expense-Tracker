import "server-only";
import { bankPreset, split } from "./bankPreset";

// Canara Bank (Canara ai1) → Account statement.
export const canara = bankPreset({
  bank: "canara",
  headerMatch: ["txn date", "description", "branch code", "debit", "credit"],
  columns: { date: ["txn date", "value date"], narration: ["description"], reference: ["cheque no"], balance: ["balance"] },
  amount: split(["debit"], ["credit"]),
  dateFormats: ["dd-MM-yyyy HH:mm:ss", "dd-MM-yyyy", "dd/MM/yyyy"],
});
