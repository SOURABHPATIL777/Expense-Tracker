import "server-only";
import { getAdminClient } from "@/backend/supabase/clients";
import { TABLES } from "@/backend/constants/db.constants";
import type { FileStatus } from "@/backend/constants/enums.constants";
import { unwrap, unwrapMaybe } from "@/backend/errors/AppError";
import { BaseRepository } from "./BaseRepository";
import type { UploadedFileRow } from "./types";

export type NewUploadedFile = Pick<UploadedFileRow, "import_id" | "file_name" | "file_key" | "bucket" | "content_type" | "size_bytes" | "sha256">;

/**
 * Ledger of objects in R2. Users may only read it (RLS), so writes always go through the
 * service-role client, scoped explicitly by user id.
 */
export class UploadedFilesRepository extends BaseRepository<UploadedFileRow> {
  protected readonly table = TABLES.UPLOADED_FILES;

  constructor() {
    super(getAdminClient());
  }

  /** Records a file once its upload is confirmed. Re-confirming the same key is a no-op. */
  async record(userId: string, file: NewUploadedFile): Promise<UploadedFileRow> {
    const result = await this.from()
      .upsert({ ...file, user_id: userId, status: "uploaded" satisfies FileStatus }, { onConflict: "file_key", ignoreDuplicates: true })
      .select();
    const inserted = (unwrapMaybe(result, "uploadedFiles.record") as UploadedFileRow[] | null)?.[0];
    return inserted ?? (await this.findByKey(userId, file.file_key))!;
  }

  findByKey(userId: string, fileKey: string) {
    return this.findOptional(userId, (q) => q.eq("file_key", fileKey));
  }

  /** Moves a live file between states. A deleted file is final and never revived. */
  async setStatus(userId: string, fileKey: string, status: FileStatus): Promise<void> {
    const patch = status === "deleted" ? { status, deleted_at: new Date().toISOString() } : { status };
    unwrap(
      await this.from().update(patch).eq("user_id", userId).eq("file_key", fileKey).neq("status", "deleted").select("id"),
      "uploadedFiles.setStatus",
    );
  }
}
