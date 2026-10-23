import "server-only";
import { IFSC_BANKS, SOURCE_NAMES } from "@/backend/constants/app.constants";
import { SOURCE_CONFIG } from "@/shared/constants/sources";
import type { SourceApp, SourceKind } from "@/backend/constants/enums.constants";
import { lineLooksLikeTransaction } from "./statementCheck";

export type Source = { sourceKind: SourceKind; sourceApp: SourceApp };

/** At most this many lines of preamble are read. */
const TOP_LINES = 25;
const IFSC = /\b([A-Z]{4})0[A-Z0-9]{6}\b/g;

const sourceOf = (app: string): Source | null => {
  const config = SOURCE_CONFIG[app as SourceApp];
  return config ? { sourceKind: config.kind, sourceApp: app as SourceApp } : null;
};

const normalise = (text: string) => ` ${text.toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ")} `;

function byName(text: string, names: ReadonlyArray<readonly [string, string]>): Source | null {
  const haystack = normalise(text);
  for (const [name, app] of names) {
    if (new RegExp(`(^|[^a-z])${name.replace(/[&]/g, "\\&")}([^a-z]|$)`).test(haystack)) return sourceOf(app);
  }
  return null;
}

/**
 * The bank or UPI app a statement comes from, decided locally from an IFSC code or a bank/app
 * name in its preamble (the lines before the first transaction: title, account header) or its
 * file name. Transactions are never read for this: narrations carry the payee's IFSC and other
 * banks' names. With `scope: "document"` (UPI-app statements that name themselves only in a
 * footer), app names in any non-transaction line also count. Null when nothing is recognised.
 */
export function detectSource(fileName: string, lines: readonly string[], scope: "top" | "document" = "top"): Source | null {
  const firstTx = lines.findIndex(lineLooksLikeTransaction);
  const preamble = lines.slice(0, Math.min(firstTx < 0 ? lines.length : firstTx, TOP_LINES)).join("\n");
  for (const [, code] of preamble.matchAll(IFSC)) {
    const bank = IFSC_BANKS[code as keyof typeof IFSC_BANKS];
    if (bank) return sourceOf(bank);
  }
  const found = byName(`${fileName}\n${preamble}`, SOURCE_NAMES);
  if (found || scope === "top") return found;
  const appNames = SOURCE_NAMES.filter(([, app]) => SOURCE_CONFIG[app as SourceApp]?.kind === "upi_app");
  return byName(lines.filter((l) => !lineLooksLikeTransaction(l)).join("\n"), appNames);
}
