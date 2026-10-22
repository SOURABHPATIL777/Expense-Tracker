import "server-only";
import { bankPreset, split } from "./bankPreset";

// HDFC NetBanking → Account statement (Delimited / Excel).
export const hdfc = bankPreset({
  bank: "hdfc",
  headerMatch: ["date", "narration", "withdrawal amt", "deposit amt"],
  columns: { date: ["date"], narration: ["narration"], reference: ["chq ref no"], balance: ["closing balance"] },
  amount: split(["withdrawal amt"], ["deposit amt"]),
  dateFormats: ["dd/MM/yy", "dd/MM/yyyy"],
});
