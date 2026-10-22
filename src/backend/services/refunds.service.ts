import "server-only";
import { z } from "zod";
import type { Db } from "@/backend/supabase/clients";
import { AppError, invalidState } from "@/backend/errors/AppError";
import { MATCHING } from "@/backend/constants/app.constants";
import { RefundsRepository } from "@/backend/repositories/refunds.repository";
import { TransactionsRepository } from "@/backend/repositories/transactions.repository";
import type { RefundRow, TransactionRow } from "@/backend/repositories/types";
import { toRefundDto } from "@/backend/mappers/transactions.mapper";
import { rankSettlementCandidates, type MatchCandidate } from "@/backend/domain/matcher";
import { merchantKey } from "@/backend/domain/merchant";
import { daysBetween, todayIst } from "@/backend/domain/period";
import { runLlmTask } from "@/backend/llm/run";
import { redactForLlm } from "@/backend/llm/redact";
import { pageMeta } from "./paginate";
import { formatInr } from "@/shared/utils/money";
import type { PaginationQuery } from "@/shared/schemas/common";
import type { CreateRefundInput, RefundActionInput, RefundDto, RefundMessageDto } from "@/shared/schemas/refunds";
import type { RefundStatus } from "@/shared/constants/enums";

const MAX_SUGGESTIONS = 3;
const DAY_MS = 86_400_000;
/** Credits that can plausibly be a refund (income and own transfers are not). */
const REFUNDABLE_KINDS = ["refund", "reversal", "unknown"] as const;

const REFUND_MESSAGE_INSTRUCTIONS = `Write a short, polite customer-support message (under 120 words) asking a merchant or bank about a refund that has not arrived.
Use only the facts provided. Do not claim the merchant has failed to refund: say that no refund appears in the customer's records yet.
Leave [square-bracket placeholders] for anything not provided (for example an order number). No greeting signature with a name.`;

const toCandidate = (t: TransactionRow): MatchCandidate => ({
  id: t.id,
  amountMinor: t.amount_minor,
  direction: t.direction,
  occurredAt: t.occurred_at,
  referenceId: t.reference_id,
  counterpartyVpa: t.counterparty_vpa,
  merchantKey: merchantKey(t.merchant_normalized ?? t.merchant_raw, t.counterparty_vpa),
});

export function refundsService(db: Db) {
  const refunds = new RefundsRepository(db);
  const transactions = new TransactionsRepository(db);

  async function hydrate(userId: string, rows: RefundRow[]): Promise<RefundDto[]> {
    const ids = [...new Set(rows.flatMap((r) => [r.transaction_id, r.matched_transaction_id, ...r.suggested_transaction_ids].filter((v): v is string => Boolean(v))))];
    const txs = ids.length ? await transactions.listAll(userId, (q) => q.in("id", ids)) : [];
    const byId = new Map(txs.map((t) => [t.id, t]));
    const today = todayIst();
    return rows.map((r) => toRefundDto(r, byId, today));
  }

  /**
   * Suggests incoming credits for every waiting refund. Suggestions only: a refund is marked
   * received when the user confirms it, never automatically.
   */
  async function refreshSuggestions(userId: string, onlyIds?: string[]): Promise<number> {
    const waiting = (await refunds.listWaiting(userId)).filter((r) => !onlyIds || onlyIds.includes(r.id));
    if (waiting.length === 0) return 0;
    const originals = new Map((await transactions.listAll(userId, (q) => q.in("id", waiting.map((r) => r.transaction_id)))).map((t) => [t.id, t]));
    const since = Math.min(...[...originals.values()].map((t) => Date.parse(t.occurred_at)));
    const until = Math.max(...[...originals.values()].map((t) => Date.parse(t.occurred_at))) + MATCHING.REFUND_WINDOW_DAYS * DAY_MS;
    const [credits, taken] = await Promise.all([
      transactions.listAll(userId, (q) =>
        q
          .eq("direction", "credit")
          .eq("status", "success")
          .in("transaction_kind", [...REFUNDABLE_KINDS])
          .gte("occurred_at", new Date(since).toISOString())
          .lte("occurred_at", new Date(until).toISOString()),
      ),
      refunds.matchedCreditIds(userId),
    ]);
    const pool = credits.filter((c) => !taken.has(c.id)).map(toCandidate);

    let suggested = 0;
    for (const r of waiting) {
      const original = originals.get(r.transaction_id);
      if (!original) continue;
      const o = toCandidate(original);
      const ranked = rankSettlementCandidates(
        { amountMinor: r.expected_amount_minor, since: original.occurred_at, counterpartyVpa: o.counterpartyVpa, merchantKey: o.merchantKey, windowDays: MATCHING.REFUND_WINDOW_DAYS },
        pool,
      ).slice(0, MAX_SUGGESTIONS);
      const status: RefundStatus = ranked.length ? "suggested" : "open";
      await refunds.update(userId, r.id, { status, suggested_transaction_ids: ranked.map((c) => c.id) });
      if (ranked.length) suggested += 1;
    }
    return suggested;
  }

  return {
    refreshSuggestions,

    async list(userId: string, query: PaginationQuery & { status?: RefundStatus }) {
      const { rows, total } = await refunds.list(userId, query, (q) => (query.status ? q.eq("status", query.status) : q));
      return { items: await hydrate(userId, rows), meta: pageMeta(query, total) };
    },

    async get(userId: string, id: string): Promise<RefundDto> {
      return (await hydrate(userId, [await refunds.findById(userId, id)]))[0];
    },

    async create(userId: string, input: CreateRefundInput): Promise<RefundDto> {
      const tx = await transactions.findById(userId, input.transactionId);
      if (tx.direction !== "debit") throw invalidState("Only money you paid can have a refund expected.");
      if (await refunds.findActiveForTransaction(userId, tx.id)) throw new AppError("CONFLICT", { message: "You're already tracking a refund for this payment." });
      const expected = input.expectedAmountMinor ?? tx.amount_minor;
      if (expected > tx.amount_minor) throw new AppError("VALIDATION", { message: "The refund can't be more than the payment." });
      const row = await refunds.insert(userId, {
        transaction_id: tx.id,
        expected_amount_minor: expected,
        expected_by: input.expectedBy ?? null,
        order_ref: input.orderRef ?? null,
        note: input.note ?? null,
      });
      await refreshSuggestions(userId, [row.id]);
      return this.get(userId, row.id);
    },

    async act(userId: string, id: string, input: RefundActionInput): Promise<RefundDto> {
      const r = await refunds.findById(userId, id);
      if (input.action === "reopen") {
        if (r.status !== "closed" && r.status !== "matched") throw invalidState();
        await refunds.update(userId, id, { status: "open", matched_transaction_id: null, resolved_at: null });
        await refreshSuggestions(userId, [id]);
        return this.get(userId, id);
      }
      if (r.status === "closed" || r.status === "matched") throw invalidState("This refund is already resolved.");
      if (input.action === "close") {
        await refunds.update(userId, id, { status: "closed", resolved_at: new Date().toISOString() });
        return this.get(userId, id);
      }
      const credit = await transactions.findById(userId, input.matchTransactionId);
      if (credit.direction !== "credit") throw new AppError("VALIDATION", { message: "A refund must be money you received." });
      if ((await refunds.matchedCreditIds(userId)).has(credit.id)) throw new AppError("CONFLICT", { message: "That credit is already matched to another refund." });
      await refunds.update(userId, id, { status: "matched", matched_transaction_id: credit.id, resolved_at: new Date().toISOString() });
      // A confirmed refund is not income; record it as such unless the user set it by hand.
      if (!credit.user_locked) await transactions.update(userId, credit.id, { transaction_kind: "refund" });
      return this.get(userId, id);
    },

    async draftMessage(userId: string, id: string): Promise<RefundMessageDto> {
      const r = await refunds.findById(userId, id);
      const tx = await transactions.findById(userId, r.transaction_id);
      const schema = z.object({ message: z.string().min(1).max(1500) });
      const out = await runLlmTask({
        userId,
        task: "refund_message",
        schema,
        instructions: REFUND_MESSAGE_INSTRUCTIONS,
        data: JSON.stringify({
          merchant: redactForLlm(tx.merchant_normalized ?? tx.merchant_raw),
          paid_on: tx.occurred_at.slice(0, 10),
          amount_paid: formatInr(tx.amount_minor),
          refund_expected: formatInr(r.expected_amount_minor),
          payment_status_in_records: tx.status,
          upi_reference: tx.reference_id ? "provided below" : null,
          days_waiting: daysBetween(r.created_at, new Date().toISOString()),
          order_reference: r.order_ref ? redactForLlm(r.order_ref) : null,
        }),
      });
      // The UTR is added by us, not the model, so it is always exact.
      const message = tx.reference_id ? `${out.message}\n\nUPI reference (UTR): ${tx.reference_id}` : out.message;
      return { message };
    },
  };
}
