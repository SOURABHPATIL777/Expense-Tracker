import "server-only";
import { bankPreset, split } from "./bankPreset";

// SBI YONO / OnlineSBI → Account statement (Excel).
export const sbi = bankPreset({
  bank: "sbi",
  headerMatch: ["txn date", "description", "ref no", "debit", "credit"],
  columns: { date: ["txn date", "value date"], narration: ["description"], reference: ["ref no cheque no", "ref no"], balance: ["balance"] },
  amount: split(["debit"], ["credit"]),
  dateFormats: ["d MMM yyyy", "dd MMM yyyy", "dd/MM/yyyy"],
});
