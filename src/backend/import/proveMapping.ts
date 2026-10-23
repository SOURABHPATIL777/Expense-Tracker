import "server-only";
import { COLUMN_MAPPING } from "@/backend/constants/llm.constants";
import { balanceVerdict } from "./balanceCheck";
import { extract } from "./engine";
import { parsedShare } from "./mapping";
import type { ImportConfig, TableRead } from "./types";

export type Proof = { ok: true; config: ImportConfig } | { ok: false; problems: string };

/** The same layout with money in and out the other way round, when the layout allows it. */
function swapped(config: ImportConfig): ImportConfig | null {
  const a = config.table.amount;
  const amount =
    a.mode === "split"
      ? { ...a, debit: a.credit, credit: a.debit }
      : a.mode === "typed"
        ? { ...a, debitValues: a.creditValues, creditValues: a.debitValues }
        : null;
  return amount ? { ...config, table: { ...config.table, amount } } : null;
}

/**
 * Proves a column mapping (local or AI) on the file itself before it's used or stored: most rows
 * must parse, and when the statement has running balances they must reconcile
 * (previous balance ± amount = this balance). Debit and credit mapped the wrong way round are
 * swapped automatically; misaligned columns are rejected.
 */
export function proveMapping(read: TableRead, config: ImportConfig): Proof {
  const result = extract(read, config);
  const quality = parsedShare(result);
  if (quality.parsed === 0 || quality.share < COLUMN_MAPPING.MIN_PARSED_SHARE) {
    return { ok: false, problems: `only ${quality.parsed} of ${quality.total} rows parsed; examples: ${quality.failures.join("; ") || "none"}` };
  }
  const events = result.rows.flatMap((r) => (r.parsed ? [r.parsed] : []));
  const verdict = balanceVerdict(events);
  if (verdict === "ok" || verdict === "unknown") return { ok: true, config };
  if (verdict === "swapped") {
    const fixed = swapped(config);
    if (fixed) return { ok: true, config: fixed };
    return { ok: false, problems: "running balances only reconcile with money in and out the other way round" };
  }
  return { ok: false, problems: "running balances don't reconcile with these amounts (columns may be misaligned)" };
}
