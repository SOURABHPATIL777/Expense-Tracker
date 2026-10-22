import "server-only";
import type { Db } from "@/backend/supabase/clients";
import { BUCKETS } from "@/backend/constants/db.constants";
import { AppError } from "@/backend/errors/AppError";
import { logger } from "@/backend/logger/logger";

const bucket = (db: Db) => db.storage.from(BUCKETS.STATEMENTS);

/** Files live under `<user_id>/<import_id>/<name>` so storage RLS can scope by folder. */
export function statementPath(userId: string, importId: string, fileName: string): string {
  const safe = fileName.replace(/[^\w.-]+/g, "_").slice(-120);
  return `${userId}/${importId}/${safe}`;
}

export const statementStorage = {
  /** Browser uploads straight to Supabase Storage (avoids the 4.5 MB serverless body limit). */
  async createUploadUrl(db: Db, path: string): Promise<string> {
    // upsert: a retried upload for the same pending import overwrites the half-uploaded object.
    const { data, error } = await bucket(db).createSignedUploadUrl(path, { upsert: true });
    if (error || !data) throw new AppError("UPSTREAM", { internal: error });
    return data.signedUrl;
  },

  async exists(db: Db, path: string): Promise<boolean> {
    const { data, error } = await bucket(db).exists(path);
    if (error && data !== false) throw new AppError("UPSTREAM", { internal: error });
    return data;
  },

  async download(db: Db, path: string): Promise<Buffer> {
    const { data, error } = await bucket(db).download(path);
    if (error || !data) throw new AppError("UPSTREAM", { internal: error, message: "The uploaded file could not be read." });
    return Buffer.from(await data.arrayBuffer());
  },

  /** Best effort: a leftover file is a privacy issue to log, not a reason to fail the request. */
  async remove(db: Db, path: string): Promise<void> {
    const { error } = await bucket(db).remove([path]);
    if (error) logger.error({ err: error }, "statement file removal failed");
  },
};
