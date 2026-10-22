import "server-only";
import { RPC, TABLES } from "@/backend/constants/db.constants";
import { unwrapMaybe } from "@/backend/errors/AppError";
import { BaseRepository } from "./BaseRepository";
import type { ImportRow, ImportTemplateRow } from "./types";

export class ImportsRepository extends BaseRepository<ImportRow> {
  protected readonly table = TABLES.IMPORTS;

  findBySha(userId: string, sha256: string) {
    return this.findOptional(userId, (q) => q.eq("file_sha256", sha256));
  }

  /** Adds to the running counters after each processing chunk. */
  async addCounts(
    userId: string,
    row: ImportRow,
    delta: Partial<Record<"imported_count" | "linked_count" | "duplicate_count" | "review_count" | "skipped_count", number>>,
  ): Promise<ImportRow> {
    const patch: Partial<ImportRow> = {};
    for (const [k, v] of Object.entries(delta) as Array<[keyof typeof delta, number]>) patch[k] = (row[k] ?? 0) + v;
    return this.update(userId, row.id, patch);
  }

  /** Deletes the import and transactions that exist only because of it (SQL function, RLS-scoped). */
  async deleteCascade(importId: string): Promise<void> {
    unwrapMaybe(await this.db.rpc(RPC.DELETE_IMPORT, { p_import_id: importId }), "imports.deleteCascade");
  }
}

export class ImportTemplatesRepository extends BaseRepository<ImportTemplateRow> {
  protected readonly table = TABLES.IMPORT_TEMPLATES;

  findBySignatures(userId: string, signatures: string[]) {
    if (signatures.length === 0) return Promise.resolve([]);
    return this.listAll(userId, (q) => q.in("header_signature", signatures));
  }

  async upsert(userId: string, values: Omit<ImportTemplateRow, "id" | "user_id" | "created_at" | "updated_at">): Promise<ImportTemplateRow> {
    const result = await this.from()
      .upsert({ ...values, user_id: userId }, { onConflict: "user_id,header_signature" })
      .select()
      .single();
    return unwrapMaybe(result, "importTemplates.upsert") as ImportTemplateRow;
  }
}
