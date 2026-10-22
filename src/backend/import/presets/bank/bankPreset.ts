import "server-only";
import type { Bank } from "@/backend/constants/enums.constants";
import { SOURCE_APP_LABELS } from "@/shared/constants/labels";
import type { AmountSpec, ImportConfig, TableColumns, TextSpec } from "@/backend/import/types";

type BankPresetInput = {
  bank: Bank;
  /** Normalised header tokens that identify this bank's CSV/Excel export. */
  headerMatch: string[];
  columns: TableColumns;
  amount: AmountSpec;
  dateFormats: string[];
  /** Text that identifies this bank's PDF statement; defaults to the bank's name. */
  pdfDetect?: string[];
  verified?: boolean;
};

const COMMON_DATE_FORMATS = ["dd/MM/yyyy", "dd-MM-yyyy", "dd/MM/yy", "dd-MM-yy", "d MMM yyyy", "dd MMM yyyy", "dd-MMM-yyyy", "dd-MMM-yy"];

const DATE = "\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4}";
const MONEY = "[\\d,]+\\.\\d{2}";

/** Bank PDFs print their own name in the first lines; deeper lines mention other banks in narrations. */
const HEADER_LINES = 15;

/**
 * Bank PDFs are tables flattened to text: "05/10/24 UPI/DR/412345678901/SWIGGY/... 350.00 12,000.00".
 * The last two amounts on the line are the transaction amount and the running balance; the balance
 * change decides debit vs credit, with narration keywords as a fallback for the first row.
 */
export function bankPdfSpec(detect: string[], dateFormats: string[]): TextSpec {
  return {
    detect,
    detectWithinLines: HEADER_LINES,
    recordStart: `^(?:${DATE})\\b`,
    ignoreLines: ["^Page \\d+", "^(?:Txn|Tran|Transaction|Value|Post)?\\s*Date\\b", "statement of account", "computer generated"],
    fields: {
      date: `^(?<date>${DATE})`,
      amount: `(?<amount>${MONEY})\\s*(?:Dr|Cr)?\\s+(?<balance>${MONEY})\\s*(?:Dr|Cr)?\\s*$`,
      narration: `^(?:${DATE})\\s+(?:(?:${DATE})\\s+)?(?<narration>.+?)\\s+${MONEY}`,
      debitWhen: "UPI/DR|\\bDR\\b|TO TRANSFER|WITHDRAWAL|\\bATM\\b|\\bPOS\\b|DEBIT",
      creditWhen: "UPI/CR|\\bCR\\b|BY TRANSFER|DEPOSIT|REFUND|REVERSAL|SALARY|INTEREST|CREDIT",
    },
    dateFormats: [...new Set([...dateFormats, ...COMMON_DATE_FORMATS])],
    directionFromBalance: true,
  };
}

const nameRegex = (s: string) => `\\b${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}\\b`;

/** Every bank gets a CSV/Excel preset and a PDF preset from one small definition. */
export function bankPreset(input: BankPresetInput): ImportConfig[] {
  const label = SOURCE_APP_LABELS[input.bank];
  const base = { sourceKind: "bank" as const, sourceApp: input.bank, verified: input.verified ?? false };
  return [
    {
      ...base,
      id: `bank.${input.bank}.table.v1`,
      label: `${label} statement (CSV/Excel)`,
      reader: "table",
      table: {
        headerMatch: input.headerMatch,
        columns: input.columns,
        amount: input.amount,
        dateFormats: [...new Set([...input.dateFormats, ...COMMON_DATE_FORMATS])],
      },
    },
    {
      ...base,
      id: `bank.${input.bank}.pdf.v1`,
      label: `${label} statement (PDF)`,
      reader: "pdf_text",
      text: bankPdfSpec(input.pdfDetect ?? [nameRegex(label)], input.dateFormats),
    },
  ];
}

export const split = (debit: string[], credit: string[]): AmountSpec => ({ mode: "split", debit, credit });
