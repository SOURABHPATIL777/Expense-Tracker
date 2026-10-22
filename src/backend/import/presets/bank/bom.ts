import "server-only";
import { bankPreset, split } from "./bankPreset";

// Bank of Maharashtra (Mahamobile) → Account statement.
export const bom = bankPreset({
  bank: "bom",
  headerMatch: ["particulars", "cheque reference no", "debit", "credit"],
  columns: { date: ["date"], narration: ["particulars"], reference: ["cheque reference no"], balance: ["balance"] },
  amount: split(["debit"], ["credit"]),
  dateFormats: ["dd/MM/yyyy", "dd-MM-yyyy"],
});
