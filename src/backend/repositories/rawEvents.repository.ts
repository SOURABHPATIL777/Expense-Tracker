import "server-only";
import { TABLES } from "@/backend/constants/db.constants";
import { unwrap, unwrapMaybe } from "@/backend/errors/AppError";
import { BaseRepository, type OrderBy } from "./BaseRepository";
import type { RawEventRow, RawEventStatus } from "./types";

const WRITE_BATCH = 500;

export class RawEventsRepository extends BaseRepository<RawEventRow> {
  protected readonly table = TABLES.RAW_EVENTS;
  protected readonly defaultOrder: OrderBy = { column: "row_index", ascending: true };

  async replaceForImport(userId: string, importId: string, rows: Array<Omit<RawEventRow, "id" | "user_id" | "created_at">>): Promise<void> {
    unwrapMaybe(await this.from().delete().eq("user_id", userId).eq("import_id", importId), "rawEvents.clear");
    for (let i = 0; i < rows.length; i += WRITE_BATCH) {
      const batch = rows.slice(i, i + WRITE_BATCH).map((r) => ({ ...r, user_id: userId }));
      unwrapMaybe(await this.from().insert(batch), "rawEvents.insert");
    }
  }

  /** Adds rows without clearing earlier ones (PDFs read by the LLM arrive chunk by chunk). */
  async appendForImport(userId: string, rows: Array<Omit<RawEventRow, "id" | "user_id" | "created_at">>): Promise<void> {
    for (let i = 0; i < rows.length; i += WRITE_BATCH) {
      unwrapMaybe(await this.from().insert(rows.slice(i, i + WRITE_BATCH).map((r) => ({ ...r, user_id: userId }))), "rawEvents.append");
    }
  }

  listPending(userId: string, importId: string, limit: number): Promise<RawEventRow[]> {
    return this.listAll(userId, (q) => q.eq("import_id", importId).eq("status", "pending").limit(limit));
  }

  /** Fingerprints already turned into transactions by any other import. */
  async knownFingerprints(userId: string, importId: string, fingerprints: string[]): Promise<Set<string>> {
    if (fingerprints.length === 0) return new Set();
    const result = await this.from()
      .select("fingerprint")
      .eq("user_id", userId)
      .neq("import_id", importId)
      .in("status", ["accepted", "linked"] satisfies RawEventStatus[])
      .in("fingerprint", fingerprints);
    return new Set((unwrap(result, "rawEvents.knownFingerprints") as Array<{ fingerprint: string }>).map((r) => r.fingerprint));
  }

  /** Bulk status/link update; rows are full records so this is a single upsert round-trip. */
  async saveOutcomes(userId: string, rows: RawEventRow[]): Promise<void> {
    if (rows.length === 0) return;
    const payload = rows.map((r) => ({ ...r, user_id: userId }));
    unwrapMaybe(await this.from().upsert(payload, { onConflict: "id" }), "rawEvents.saveOutcomes");
  }
}
