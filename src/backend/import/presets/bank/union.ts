import "server-only";
import { bankPreset } from "./bankPreset";

// Union Bank of India (Vyom) → single amount column with Dr/Cr marker.
export const union = bankPreset({
  bank: "union",
  headerMatch: ["date", "tran id", "remarks", "amount"],
  columns: { date: ["date", "tran date"], narration: ["remarks"], reference: ["tran id"], balance: ["balance"] },
  amount: { mode: "signed", amount: ["amount rs", "amount"] },
  dateFormats: ["dd/MM/yyyy", "dd-MM-yyyy"],
});
