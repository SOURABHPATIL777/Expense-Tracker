import "server-only";
import { TABLES } from "@/backend/constants/db.constants";
import { unwrap, unwrapMaybe } from "@/backend/errors/AppError";
import { BaseRepository, type OrderBy } from "./BaseRepository";
import type { ClaimRow, ExpenseEventRow, GuestAccessRow, InviteRow, ParticipantRow, SharedExpenseRow } from "./types";

export class SharedExpensesRepository extends BaseRepository<SharedExpenseRow> {
  protected readonly table = TABLES.SHARED_EXPENSES;
}

/** Child rows of a shared expense; all queries are by expense id(s) within the owner's scope. */
abstract class ExpenseChildRepository<Row extends { id: string; user_id: string }> extends BaseRepository<Row> {
  protected abstract readonly parentColumn: "expense_id" | "participant_id";

  forParents(userId: string, parentIds: string[]): Promise<Row[]> {
    if (parentIds.length === 0) return Promise.resolve([]);
    return this.listAll(userId, (q) => q.in(this.parentColumn, parentIds));
  }
}

export class ParticipantsRepository extends ExpenseChildRepository<ParticipantRow> {
  protected readonly table = TABLES.EXPENSE_PARTICIPANTS;
  protected readonly parentColumn = "expense_id" as const;
  protected readonly defaultOrder: OrderBy = { column: "created_at", ascending: true };
}

export class InvitesRepository extends ExpenseChildRepository<InviteRow> {
  protected readonly table = TABLES.SHARE_INVITES;
  protected readonly parentColumn = "participant_id" as const;

  /** Revokes every outstanding link and guest session for a participant (reissue or revoke). */
  async revokeAll(userId: string, participantId: string): Promise<void> {
    const now = new Date().toISOString();
    unwrapMaybe(await this.from().update({ revoked_at: now }).eq("user_id", userId).eq("participant_id", participantId).is("revoked_at", null), "invites.revoke");
    unwrapMaybe(
      await this.db.from(TABLES.GUEST_ACCESS).update({ revoked_at: now }).eq("user_id", userId).eq("participant_id", participantId).is("revoked_at", null),
      "guestAccess.revoke",
    );
  }

  async activeAccess(userId: string, participantIds: string[]): Promise<GuestAccessRow[]> {
    if (participantIds.length === 0) return [];
    return unwrap(
      await this.db.from(TABLES.GUEST_ACCESS).select("*").eq("user_id", userId).in("participant_id", participantIds).is("revoked_at", null),
      "guestAccess.active",
    ) as GuestAccessRow[];
  }
}

export class ClaimsRepository extends ExpenseChildRepository<ClaimRow> {
  protected readonly table = TABLES.PAYMENT_CLAIMS;
  protected readonly parentColumn = "participant_id" as const;
  protected readonly defaultOrder: OrderBy = { column: "reported_at", ascending: false };
}

export class ExpenseEventsRepository extends BaseRepository<ExpenseEventRow & { id: string }> {
  protected readonly table = TABLES.EXPENSE_EVENTS;
  protected readonly defaultOrder: OrderBy = { column: "created_at", ascending: true };

  async log(userId: string, e: Pick<ExpenseEventRow, "expense_id" | "participant_id" | "action" | "version"> & { metadata?: Record<string, unknown> }) {
    unwrapMaybe(await this.from().insert({ ...e, user_id: userId, actor: "owner", metadata: e.metadata ?? {} }), "expenseEvents.log");
  }
}
