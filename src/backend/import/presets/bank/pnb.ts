import "server-only";
import { bankPreset, split } from "./bankPreset";

// Punjab National Bank internet banking → Account statement.
export const pnb = bankPreset({
  bank: "pnb",
  headerMatch: ["transaction date", "withdrawal", "deposit", "narration"],
  columns: { date: ["transaction date"], narration: ["narration"], reference: ["cheque number"], balance: ["balance"] },
  amount: split(["withdrawal"], ["deposit"]),
  dateFormats: ["dd/MM/yyyy", "dd-MM-yyyy"],
});
