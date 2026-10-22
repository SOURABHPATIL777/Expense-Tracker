import "server-only";
import { bankPreset, split } from "./bankPreset";

// Indian Bank (IndOASIS) → Account statement.
export const indian = bankPreset({
  bank: "indian",
  headerMatch: ["post date", "details", "debit", "credit"],
  columns: { date: ["post date", "value date"], narration: ["details"], balance: ["balance"] },
  amount: split(["debit"], ["credit"]),
  dateFormats: ["dd/MM/yyyy", "dd-MM-yyyy", "dd MMM yyyy"],
});
