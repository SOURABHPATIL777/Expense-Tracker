import "server-only";
import type { Db } from "@/backend/supabase/clients";
import type { TransactionKind } from "@/backend/constants/enums.constants";
import { TABLES } from "@/backend/constants/db.constants";
import { unwrap } from "@/backend/errors/AppError";
import { counterpartyKey, COUNTERPARTY_COLUMN } from "@/backend/domain/counterparty";
import { RulesRepository } from "@/backend/repositories/categorization.repository";
import { TransactionsRepository } from "@/backend/repositories/transactions.repository";
import type { TransactionRow } from "@/backend/repositories/types";

/** Auto rules run before the user's broader rules (lower number wins) but after anything more specific they set. */
const AUTO_RULE_PRIORITY = 50;

/**
 * "Treat this counterparty this way": after the user sets a transaction's category and/or type, the
 * same UPI ID / account (or exact merchant), in the same direction, gets the same answer — both for
 * existing transactions they haven't edited by hand and for future imports (via an auto rule).
 * Returns how many other transactions changed.
 */
export async function rememberCounterparty(
  db: Db,
  userId: string,
  tx: TransactionRow,
  outcome: { categoryId: string | null; kind: TransactionKind | null },
): Promise<number> {
  const key = counterpartyKey(tx);
  if (!key || (!outcome.categoryId && !outcome.kind)) return 0;

  const rules = new RulesRepository(db);
  const rule = { category_id: outcome.categoryId, transaction_kind: outcome.kind, is_active: true };
  const existing = await rules.findAuto(userId, key.field, key.value, tx.direction);
  if (existing) await rules.update(userId, existing.id, rule);
  else {
    await rules.insert(userId, { ...rule, field: key.field, operator: "equals", pattern: key.value, direction: tx.direction, origin: "auto", priority: AUTO_RULE_PRIORITY });
  }

  const patch: Partial<TransactionRow> = {
    ...(outcome.categoryId && { category_id: outcome.categoryId, category_source: "rule" as const, category_confidence: 1 }),
    ...(outcome.kind && { transaction_kind: outcome.kind }),
  };
  const updated = unwrap(
    await db
      .from(TABLES.TRANSACTIONS)
      .update(patch)
      .eq("user_id", userId)
      .eq(COUNTERPARTY_COLUMN[key.field], key.value)
      .eq("direction", tx.direction)
      .eq("user_locked", false)
      .neq("id", tx.id)
      .select("id"),
    "categorization.applySimilar",
  ) as Array<{ id: string }>;
  return updated.length;
}

/** After a manual edit has been saved: spreads it to the same counterparty (see rememberCounterparty). */
export async function spreadManualEdit(db: Db, userId: string, transactionId: string, edit: { categoryId?: string | null; kind?: TransactionKind }): Promise<number> {
  if (!edit.categoryId && !edit.kind) return 0;
  const tx = await new TransactionsRepository(db).findById(userId, transactionId);
  // A category change also fixes the type it resolved to, so similar payments count the same way.
  const kind = edit.kind ?? (edit.categoryId ? tx.transaction_kind : null);
  return rememberCounterparty(db, userId, tx, { categoryId: edit.categoryId ?? null, kind });
}
