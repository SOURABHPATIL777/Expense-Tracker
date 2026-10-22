import "server-only";
import { bankPreset, split } from "./bankPreset";

// Bank of Baroda (bob World) → Account statement.
export const bob = bankPreset({
  bank: "bob",
  headerMatch: ["tran date", "narration", "withdrawal", "deposit"],
  columns: { date: ["tran date", "value date"], narration: ["narration"], reference: ["chqno", "cheque no"], balance: ["balance"] },
  amount: split(["withdrawal dr", "withdrawal"], ["deposit cr", "deposit"]),
  dateFormats: ["dd/MM/yyyy", "dd-MM-yyyy"],
});
