import "server-only";
import { bankPreset, split } from "./bankPreset";

// ICICI iMobile / NetBanking → Detailed statement (XLS).
export const icici = bankPreset({
  bank: "icici",
  headerMatch: ["transaction date", "transaction remarks", "withdrawal amount", "deposit amount"],
  columns: { date: ["transaction date", "value date"], narration: ["transaction remarks"], reference: ["cheque number"], balance: ["balance"] },
  amount: split(["withdrawal amount"], ["deposit amount"]),
  dateFormats: ["dd/MM/yyyy", "dd-MM-yyyy"],
});
