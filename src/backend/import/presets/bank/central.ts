import "server-only";
import { bankPreset, split } from "./bankPreset";

// Central Bank of India (Cent Mobile) → Account statement.
export const central = bankPreset({
  bank: "central",
  headerMatch: ["post date", "account description", "debit", "credit"],
  columns: { date: ["post date", "value date"], narration: ["account description"], reference: ["cheque number"], balance: ["balance"] },
  amount: split(["debit"], ["credit"]),
  dateFormats: ["dd/MM/yyyy", "dd-MM-yyyy"],
});
