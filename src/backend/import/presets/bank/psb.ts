import "server-only";
import { bankPreset, split } from "./bankPreset";

// Punjab & Sind Bank → Account statement. Its signature is a subset of SBI/Canara; detection prefers fuller matches.
export const psb = bankPreset({
  bank: "psb",
  headerMatch: ["txn date", "description", "debit", "credit"],
  columns: { date: ["txn date"], narration: ["description"], balance: ["balance"] },
  amount: split(["debit"], ["credit"]),
  dateFormats: ["dd/MM/yyyy", "dd-MM-yyyy"],
});
