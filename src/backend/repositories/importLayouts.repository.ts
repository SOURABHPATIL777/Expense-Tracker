import "server-only";
import { getAdminClient } from "@/backend/supabase/clients";
import { PG_ERROR, TABLES } from "@/backend/constants/db.constants";
import { AppError, unwrap } from "@/backend/errors/AppError";
import { logger } from "@/backend/logger/logger";
import type { ImportConfig } from "@/backend/import/types";
import type { ImportLayoutKind, ImportLayoutRow } from "./types";

const CACHE_TTL_MS = 60_000;
let cache: { at: number; rows: ImportLayoutRow[] } | null = null;

export type NewLayout = Pick<ImportLayoutRow, "kind" | "signature" | "label" | "source_kind" | "source_app" | "config">;

/**
 * Statement layouts shared by every user (server-only table). Seeded from the former presets;
 * the LLM adds a layout the first time it works out an unknown file, so the next file skips it.
 */
export class ImportLayoutsRepository {
  private readonly db = getAdminClient();

  async all(): Promise<ImportLayoutRow[]> {
    if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows;
    const rows = unwrap(
      await this.db.from(TABLES.IMPORT_LAYOUTS).select("*").order("priority", { ascending: true }),
      "importLayouts.all",
    ) as ImportLayoutRow[];
    cache = { at: Date.now(), rows };
    return rows;
  }

  /** Layouts that can parse a file deterministically, with their configs. */
  async parsers(): Promise<Array<{ layout: ImportLayoutRow; config: ImportConfig }>> {
    return (await this.all()).filter((l) => l.kind !== "llm_extract").map((layout) => ({ layout, config: layout.config as ImportConfig }));
  }

  async find(kind: ImportLayoutKind, signature: string): Promise<ImportLayoutRow | null> {
    return (await this.all()).find((l) => l.kind === kind && l.signature === signature) ?? null;
  }

  /** Saves a newly learned layout; if another import learned it first, returns that one. */
  async save(layout: NewLayout): Promise<ImportLayoutRow> {
    const { data, error } = await this.db.from(TABLES.IMPORT_LAYOUTS).insert({ ...layout, origin: "llm" }).select().single();
    cache = null;
    if (!error) return data as ImportLayoutRow;
    if (error.code !== PG_ERROR.UNIQUE_VIOLATION) throw new AppError("INTERNAL", { internal: error });
    const existing = await this.find(layout.kind, layout.signature);
    if (!existing) throw new AppError("INTERNAL", { internal: { reason: "layout conflict without row" } });
    return existing;
  }

  /** Best-effort usage counter (helps spot which learned layouts are worth verifying). */
  async touch(layout: ImportLayoutRow): Promise<void> {
    const { error } = await this.db
      .from(TABLES.IMPORT_LAYOUTS)
      .update({ use_count: layout.use_count + 1, last_used_at: new Date().toISOString() })
      .eq("id", layout.id);
    if (error) logger.warn({ err: error }, "layout usage update failed");
  }
}
