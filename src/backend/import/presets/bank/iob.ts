import "server-only";
import { bankPreset, split } from "./bankPreset";

// Indian Overseas Bank → Account statement (note the bank's own "NARATION" spelling).
export const iob = bankPreset({
  bank: "iob",
  headerMatch: ["naration", "cod", "debit", "credit"],
  columns: { date: ["date", "value date"], narration: ["naration", "narration"], reference: ["chq no"], balance: ["balance"] },
  amount: split(["debit"], ["credit"]),
  dateFormats: ["dd/MM/yyyy", "dd-MM-yyyy", "dd-MMM-yyyy"],
});
