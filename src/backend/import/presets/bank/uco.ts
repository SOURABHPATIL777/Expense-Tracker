import "server-only";
import { bankPreset, split } from "./bankPreset";

// UCO Bank (UCO mBanking) → Account statement.
export const uco = bankPreset({
  bank: "uco",
  headerMatch: ["particulars", "withdrawals", "deposits"],
  columns: { date: ["date", "txn date"], narration: ["particulars"], reference: ["chq no"], balance: ["balance"] },
  amount: split(["withdrawals"], ["deposits"]),
  dateFormats: ["dd/MM/yyyy", "dd-MM-yyyy", "dd-MMM-yyyy"],
});
