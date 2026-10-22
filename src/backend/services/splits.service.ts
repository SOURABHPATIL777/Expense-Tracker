import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import type { Db } from "@/backend/supabase/clients";
import { getEnv } from "@/backend/config/env";
import { AppError, invalidState, unwrap } from "@/backend/errors/AppError";
import { RPC } from "@/backend/constants/db.constants";
import { MATCHING } from "@/backend/constants/app.constants";
import { INVITES } from "@/backend/constants/security.constants";
import { AUDIT_ACTIONS } from "@/backend/constants/enums.constants";
import { PAGE_ROUTES } from "@/backend/constants/routes.constants";
import {
  ClaimsRepository,
  ExpenseEventsRepository,
  InvitesRepository,
  ParticipantsRepository,
  SharedExpensesRepository,
} from "@/backend/repositories/splits.repository";
import { TransactionsRepository } from "@/backend/repositories/transactions.repository";
import type { ClaimRow, ParticipantRow, SharedExpenseRow, TransactionRow } from "@/backend/repositories/types";
import { toTransactionSummary } from "@/backend/mappers/transactions.mapper";
import { rankSettlementCandidates } from "@/backend/domain/matcher";
import { sha256Hex } from "@/backend/domain/fingerprint";
import { pageMeta } from "./paginate";
import { audit } from "./auditLog";
import { allocateSplit } from "@/shared/utils/splitAllocation";
import type { PaginationQuery } from "@/shared/schemas/common";
import type {
  ClaimDto,
  CreateSplitInput,
  InviteDto,
  ParticipantDto,
  SplitDetailDto,
  SplitSummaryDto,
  UpdateSplitInput,
} from "@/shared/schemas/splits";
import type { SharedExpenseStatus } from "@/shared/constants/enums";

const DAY_MS = 86_400_000;
const ACTIVE_CLAIMS = new Set(["reported", "confirmed"]);

/** Paid (confirmed), pending (reported) and still-owed amounts for one participant. */
function balances(p: ParticipantRow, claims: ClaimRow[]) {
  const mine = claims.filter((c) => c.participant_id === p.id);
  const confirmed = mine.filter((c) => c.status === "confirmed").reduce((s, c) => s + c.amount_minor, 0);
  const reported = mine.filter((c) => c.status === "reported").reduce((s, c) => s + c.amount_minor, 0);
  return { confirmed, reported, outstanding: p.is_owner ? 0 : Math.max(0, p.share_minor - confirmed) };
}

export function splitsService(db: Db) {
  const expenses = new SharedExpensesRepository(db);
  const participants = new ParticipantsRepository(db);
  const invites = new InvitesRepository(db);
  const claims = new ClaimsRepository(db);
  const events = new ExpenseEventsRepository(db);
  const transactions = new TransactionsRepository(db);

  async function save(userId: string, expenseId: string | null, input: CreateSplitInput | UpdateSplitInput): Promise<string> {
    const shares = allocateSplit(input.totalMinor, input.method, input.participants.map((p) => p.value));
    const result = await db.rpc(RPC.SAVE_SPLIT, {
      p_expense_id: expenseId,
      p_transaction_id: "transactionId" in input ? (input.transactionId ?? null) : null,
      p_title: input.title,
      p_method: input.method,
      p_total_minor: input.totalMinor,
      p_participants: input.participants.map((p, i) => ({ id: p.id ?? null, displayName: p.displayName, isOwner: p.isOwner, shareMinor: shares[i] })),
      p_note: input.note ?? null,
    });
    return unwrap(result, "splits.save") as string;
  }

  /** Closes the expense once nobody owes anything (owner can reopen). */
  async function closeIfSettled(userId: string, expense: SharedExpenseRow) {
    const parts = await participants.forParents(userId, [expense.id]);
    const cl = await claims.forParents(userId, parts.map((p) => p.id));
    if (expense.status === "open" && parts.every((p) => balances(p, cl).outstanding === 0)) {
      await expenses.update(userId, expense.id, { status: "closed" });
      await events.log(userId, { expense_id: expense.id, participant_id: null, action: "settled", version: expense.version });
    }
  }

  async function repaymentSuggestions(userId: string, expense: SharedExpenseRow, parts: ParticipantRow[], cl: ClaimRow[], tx: TransactionRow | null) {
    const owing = parts.map((p) => ({ p, outstanding: balances(p, cl).outstanding })).filter((x) => x.outstanding > 0);
    if (expense.status !== "open" || owing.length === 0) return [];
    const since = tx?.occurred_at ?? expense.created_at;
    const until = new Date(Date.parse(since) + MATCHING.REPAYMENT_WINDOW_DAYS * DAY_MS).toISOString();
    const used = new Set(cl.flatMap((c) => (c.matched_transaction_id ? [c.matched_transaction_id] : [])));
    const credits = (
      await transactions.listAll(userId, (q) =>
        q.eq("direction", "credit").eq("status", "success").in("amount_minor", owing.map((o) => o.outstanding)).gte("occurred_at", since).lte("occurred_at", until),
      )
    ).filter((c) => !used.has(c.id));
    const pool = credits.map((c) => ({ id: c.id, amountMinor: c.amount_minor, direction: c.direction, occurredAt: c.occurred_at, referenceId: c.reference_id }));
    const byId = new Map(credits.map((c) => [c.id, c]));
    return owing.flatMap(({ p, outstanding }) =>
      rankSettlementCandidates({ amountMinor: outstanding, since, windowDays: MATCHING.REPAYMENT_WINDOW_DAYS }, pool)
        .slice(0, 2)
        .map((c) => ({ participantId: p.id, transaction: toTransactionSummary(byId.get(c.id)!) })),
    );
  }

  async function detail(userId: string, id: string): Promise<SplitDetailDto> {
    const e = await expenses.findById(userId, id);
    const parts = await participants.forParents(userId, [id]);
    const ids = parts.map((p) => p.id);
    const [cl, inv, access, evts, tx] = await Promise.all([
      claims.forParents(userId, ids),
      invites.forParents(userId, ids),
      invites.activeAccess(userId, ids),
      events.listAll(userId, (q) => q.eq("expense_id", id)),
      e.transaction_id ? transactions.findOptional(userId, (q) => q.eq("id", e.transaction_id!)) : Promise.resolve(null),
    ]);
    const now = new Date().toISOString();
    const nameOf = new Map(parts.map((p) => [p.id, p.display_name]));
    const participantDtos: ParticipantDto[] = parts.map((p) => {
      const b = balances(p, cl);
      const live = inv.find((i) => i.participant_id === p.id && !i.revoked_at && i.expires_at > now);
      return {
        id: p.id,
        displayName: p.display_name,
        isOwner: p.is_owner,
        shareMinor: p.share_minor,
        response: p.response_status,
        needsReconfirm: !p.is_owner && p.response_status === "agreed" && (p.accepted_version ?? 0) < e.version,
        confirmedMinor: b.confirmed,
        reportedMinor: b.reported,
        outstandingMinor: b.outstanding,
        link: { active: Boolean(live) || access.some((a) => a.participant_id === p.id), expiresAt: live?.expires_at ?? null, opened: access.some((a) => a.participant_id === p.id) },
      };
    });
    const owner = parts.find((p) => p.is_owner);
    return {
      id: e.id,
      title: e.title,
      totalMinor: e.total_minor,
      status: e.status,
      createdAt: e.created_at,
      transactionId: e.transaction_id,
      ownerShareMinor: owner?.share_minor ?? 0,
      outstandingMinor: participantDtos.reduce((s, p) => s + p.outstandingMinor, 0),
      method: e.split_method,
      version: e.version,
      note: e.note,
      transaction: tx ? toTransactionSummary(tx) : null,
      participants: participantDtos,
      claims: cl.map(
        (c): ClaimDto => ({ id: c.id, participantId: c.participant_id, amountMinor: c.amount_minor, status: c.status, reportedBy: c.reported_by, note: c.note, reportedAt: c.reported_at }),
      ),
      events: evts.map((ev) => ({
        action: ev.action,
        actor: ev.actor,
        participantName: ev.participant_id ? (nameOf.get(ev.participant_id) ?? null) : null,
        version: ev.version,
        at: ev.created_at,
        message: typeof ev.metadata?.message === "string" ? ev.metadata.message : null,
      })),
      repaymentSuggestions: await repaymentSuggestions(userId, e, parts, cl, tx),
    };
  }

  async function confirmRepayment(userId: string, matchTransactionId: string | undefined) {
    if (!matchTransactionId) return;
    const credit = await transactions.findById(userId, matchTransactionId);
    if (credit.direction !== "credit") throw new AppError("VALIDATION", { message: "A repayment must be money you received." });
    // Money a friend pays back is not income.
    if (!credit.user_locked) await transactions.update(userId, credit.id, { transaction_kind: "reimbursable" });
  }

  return {
    detail,

    async list(userId: string, query: PaginationQuery & { status?: SharedExpenseStatus }) {
      const { rows, total } = await expenses.list(userId, query, (q) => (query.status ? q.eq("status", query.status) : q));
      const parts = await participants.forParents(userId, rows.map((r) => r.id));
      const cl = await claims.forParents(userId, parts.map((p) => p.id));
      const items: SplitSummaryDto[] = rows.map((e) => {
        const mine = parts.filter((p) => p.expense_id === e.id);
        return {
          id: e.id,
          title: e.title,
          totalMinor: e.total_minor,
          status: e.status,
          createdAt: e.created_at,
          transactionId: e.transaction_id,
          ownerShareMinor: mine.find((p) => p.is_owner)?.share_minor ?? 0,
          outstandingMinor: mine.reduce((s, p) => s + balances(p, cl).outstanding, 0),
          participantCount: mine.length,
          agreedCount: mine.filter((p) => !p.is_owner && p.response_status === "agreed").length,
        };
      });
      return { items, meta: pageMeta(query, total) };
    },

    /** Money others still owe the user across open splits. */
    async owedToYou(userId: string): Promise<number> {
      const open = await expenses.listAll(userId, (q) => q.eq("status", "open"));
      const parts = await participants.forParents(userId, open.map((e) => e.id));
      const cl = await claims.forParents(userId, parts.map((p) => p.id));
      return parts.reduce((s, p) => s + balances(p, cl).outstanding, 0);
    },

    async create(userId: string, input: CreateSplitInput): Promise<SplitDetailDto> {
      const id = await save(userId, null, input);
      await audit(db, { userId, action: AUDIT_ACTIONS.SPLIT_CREATED, entityType: "shared_expense", entityId: id });
      return detail(userId, id);
    },

    async update(userId: string, id: string, input: UpdateSplitInput): Promise<SplitDetailDto> {
      await save(userId, id, input);
      await audit(db, { userId, action: AUDIT_ACTIONS.SPLIT_UPDATED, entityType: "shared_expense", entityId: id });
      return detail(userId, id);
    },

    async setStatus(userId: string, id: string, action: "close" | "cancel" | "reopen"): Promise<SplitDetailDto> {
      const e = await expenses.findById(userId, id);
      const next: SharedExpenseStatus = action === "reopen" ? "open" : action === "close" ? "closed" : "cancelled";
      if (action === "reopen" ? e.status === "open" : e.status !== "open") throw invalidState();
      await expenses.update(userId, id, { status: next });
      if (action === "cancel" && e.transaction_id) {
        // A cancelled split means the whole payment is the owner's again.
        await transactions.update(userId, e.transaction_id, { personal_share_minor: null });
        for (const p of await participants.forParents(userId, [id])) await invites.revokeAll(userId, p.id);
      }
      await events.log(userId, { expense_id: id, participant_id: null, action, version: e.version });
      return detail(userId, id);
    },

    /** Issues a fresh private link for one participant; earlier links and guest sessions stop working. */
    async issueInvite(userId: string, expenseId: string, participantId: string): Promise<InviteDto> {
      const e = await expenses.findById(userId, expenseId);
      if (e.status !== "open") throw invalidState("Reopen the split to share it.");
      const p = await participants.findById(userId, participantId);
      if (p.expense_id !== expenseId || p.is_owner) throw invalidState();
      await invites.revokeAll(userId, participantId);
      const token = randomBytes(INVITES.TOKEN_BYTES).toString("base64url");
      const expiresAt = new Date(Date.now() + INVITES.TTL_DAYS * DAY_MS).toISOString();
      await invites.insert(userId, { participant_id: participantId, token_hash: sha256Hex(token), expires_at: expiresAt });
      await events.log(userId, { expense_id: expenseId, participant_id: participantId, action: "link_issued", version: e.version });
      await audit(db, { userId, action: AUDIT_ACTIONS.INVITE_ISSUED, entityType: "expense_participant", entityId: participantId });
      // The raw token exists only in this response; we store its hash.
      return { url: `${getEnv().APP_URL}${PAGE_ROUTES.guestLanding(token)}`, expiresAt };
    },

    async revokeInvite(userId: string, expenseId: string, participantId: string): Promise<void> {
      const p = await participants.findById(userId, participantId);
      if (p.expense_id !== expenseId) throw invalidState();
      await invites.revokeAll(userId, participantId);
      const e = await expenses.findById(userId, expenseId);
      await events.log(userId, { expense_id: expenseId, participant_id: participantId, action: "link_revoked", version: e.version });
      await audit(db, { userId, action: AUDIT_ACTIONS.INVITE_REVOKED, entityType: "expense_participant", entityId: participantId });
    },

    /** Only the owner can turn a reported payment into a confirmed one. */
    async resolveClaim(userId: string, expenseId: string, claimId: string, action: "confirm" | "reject", matchTransactionId?: string): Promise<SplitDetailDto> {
      const claim = await claims.findById(userId, claimId);
      const p = await participants.findById(userId, claim.participant_id);
      if (p.expense_id !== expenseId) throw invalidState();
      if (claim.status !== "reported") throw invalidState("This payment was already resolved.");
      if (action === "confirm") await confirmRepayment(userId, matchTransactionId);
      await claims.update(userId, claimId, {
        status: action === "confirm" ? "confirmed" : "rejected",
        resolved_at: new Date().toISOString(),
        matched_transaction_id: action === "confirm" ? (matchTransactionId ?? null) : null,
      });
      const e = await expenses.findById(userId, expenseId);
      await events.log(userId, { expense_id: expenseId, participant_id: p.id, action: action === "confirm" ? "payment_confirmed" : "payment_not_received", version: e.version, metadata: { amountMinor: claim.amount_minor } });
      await audit(db, { userId, action: AUDIT_ACTIONS.CLAIM_RESOLVED, entityType: "payment_claim", entityId: claimId, metadata: { action } });
      if (action === "confirm") await closeIfSettled(userId, e);
      return detail(userId, expenseId);
    },

    /** Owner records money received directly (cash, or a credit they recognise). */
    async recordPayment(userId: string, expenseId: string, input: { participantId: string; amountMinor: number; matchTransactionId?: string }): Promise<SplitDetailDto> {
      const e = await expenses.findById(userId, expenseId);
      if (e.status !== "open") throw invalidState();
      const p = await participants.findById(userId, input.participantId);
      if (p.expense_id !== expenseId || p.is_owner) throw invalidState();
      const cl = (await claims.forParents(userId, [p.id])).filter((c) => ACTIVE_CLAIMS.has(c.status));
      const outstanding = p.share_minor - cl.reduce((s, c) => s + c.amount_minor, 0);
      if (input.amountMinor > outstanding) throw new AppError("VALIDATION", { message: "That's more than they still owe." });
      await confirmRepayment(userId, input.matchTransactionId);
      await claims.insert(userId, {
        participant_id: p.id,
        amount_minor: input.amountMinor,
        status: "confirmed",
        reported_by: "owner",
        matched_transaction_id: input.matchTransactionId ?? null,
        idempotency_key: `owner-${randomUUID()}`,
        resolved_at: new Date().toISOString(),
      });
      await events.log(userId, { expense_id: expenseId, participant_id: p.id, action: "payment_recorded", version: e.version, metadata: { amountMinor: input.amountMinor } });
      await closeIfSettled(userId, e);
      return detail(userId, expenseId);
    },
  };
}
