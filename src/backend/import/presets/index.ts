import "server-only";
import type { ImportConfig } from "@/backend/import/types";
import { phonepePdf } from "./upi/phonepe";
import { gpayPdf } from "./upi/gpay";
import { paytmPdf, paytmTable } from "./upi/paytm";
import { hdfc } from "./bank/hdfc";
import { icici } from "./bank/icici";
import { sbi } from "./bank/sbi";
import { pnb } from "./bank/pnb";
import { bob } from "./bank/bob";
import { canara } from "./bank/canara";
import { union } from "./bank/union";
import { boi } from "./bank/boi";
import { indian } from "./bank/indian";
import { central } from "./bank/central";
import { iob } from "./bank/iob";
import { uco } from "./bank/uco";
import { bom } from "./bank/bom";
import { psb } from "./bank/psb";
import { genericPdf } from "./generic";

/**
 * Built-in presets: UPI apps first (the primary sources), then banks (CSV/Excel + PDF each), then
 * the generic PDF fallback. CSV/Excel files no preset recognises go to the column mapper.
 */
export const PRESETS: readonly ImportConfig[] = [
  phonepePdf,
  gpayPdf,
  paytmTable,
  paytmPdf,
  ...[hdfc, icici, sbi, pnb, bob, canara, union, boi, indian, central, iob, uco, bom, psb].flat(),
  genericPdf,
];

export const presetById = (id: string) => PRESETS.find((p) => p.id === id) ?? null;
