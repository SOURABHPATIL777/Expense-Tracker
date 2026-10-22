import "server-only";
import { randomUUID } from "node:crypto";
import { getAdminClient, type Db } from "@/backend/supabase/clients";
import type { Logger } from "@/backend/logger/logger";
import { AppError, invalidState } from "@/backend/errors/AppError";
import { AUDIT_ACTIONS, type ImportStatus } from "@/backend/constants/enums.constants";
import type { ImportDeleteMode } from "@/shared/constants/enums";
import { ImportsRepository } from "@/backend/repositories/imports.repository";
import { RawEventsRepository } from "@/backend/repositories/rawEvents.repository";
import { toImportDto, toImportRowDto } from "@/backend/mappers/imports.mapper";
import type { ImportRow } from "@/backend/repositories/types";
import { enqueueJob } from "@/backend/jobs/queue";
import { kickWorker } from "@/backend/jobs/worker";
import { pageMeta } from "./paginate";
import { audit } from "./auditLog";
import { statementBucket, statementKey, statementStorage } from "./storage";
import { UploadedFilesRepository } from "@/backend/repositories/uploadedFiles.repository";
import { importPipeline } from "./importPipeline.service";
import type { PaginationQuery } from "@/shared/schemas/common";
import { ACTIVE_IMPORT_STATUSES, type CreateImportInput, type CreateImportResultDto, type ImportDto, type ImportListQuery } from "@/shared/schemas/imports";

/** An import still "uploaded" after this long was abandoned by the browser. */
const UPLOAD_STALL_MS = 2 * 60_000;

/** Why the same file can't be uploaded again, by the existing import's status. */
const DUPLICATE_MESSAGES: Partial<Record<ImportStatus, string>> = {
  completed: "You've already imported this exact file.",
  needs_password: "This file is waiting for its password. Open it from Imports to unlock it.",
};
const IN_PROGRESS_MESSAGE = "This file is already being imported.";

/** Which job stage follows an extract result: more PDF chunks to read, or matching. */
const NEXT_STAGE: Partial<Record<ImportStatus, "extract" | "process">> = { parsing: "extract", processing: "process" };

export function importsService(db: Db, log: Logger) {
  const imports = new ImportsRepository(db);
  const rawEvents = new RawEventsRepository(db);
  const files = new UploadedFilesRepository();

  /** Removes the statement from storage and marks its file record deleted. */
  async function removeStoredFile(row: ImportRow) {
    await statementStorage.remove(row.file_path);
    await files.setStatus(row.user_id, row.file_path, "deleted");
  }

  /** Deletes the import and every transaction that came only from it, then its file. */
  async function removeAll(row: ImportRow) {
    await imports.deleteCascade(row.id);
    if (!row.file_deleted_at) await removeStoredFile(row);
  }

  /** Jobs are service-role only, so enqueueing uses the admin client; the worker starts right after the response. */
  async function queueExtract(userId: string, importId: string, stage: "extract" | "process" = "extract") {
    await enqueueJob(getAdminClient(), { type: "parse_import", userId, payload: { importId, stage }, idempotencyKey: `import:${importId}:${stage}:${randomUUID()}` });
    kickWorker();
  }

  return {
    async list(userId: string, page: ImportListQuery) {
      const { rows, total } = await imports.list(userId, page, (q) => {
        // An upload the browser never finished isn't "in progress" once it has gone quiet.
        if (page.active === "true") {
          const stalledBefore = new Date(Date.now() - UPLOAD_STALL_MS).toISOString();
          const working = ACTIVE_IMPORT_STATUSES.filter((s) => s !== "uploaded").join(",");
          return q.or(`status.in.(${working}),and(status.eq.uploaded,created_at.gt.${stalledBefore})`);
        }
        return page.status ? q.eq("status", page.status) : q;
      });
      return { items: rows.map(toImportDto), meta: pageMeta(page, total) };
    },

    async get(userId: string, id: string): Promise<ImportDto> {
      return toImportDto(await imports.findById(userId, id));
    },

    async create(userId: string, input: CreateImportInput): Promise<CreateImportResultDto> {
      let existing = await imports.findBySha(userId, input.sha256);
      // A failed import doesn't block the same file: it is replaced (with anything it partly imported).
      if (existing?.status === "failed") {
        await removeAll(existing);
        await audit(db, { userId, action: AUDIT_ACTIONS.IMPORT_REPLACED, entityType: "import", entityId: existing.id, metadata: { fileName: existing.file_name } });
        existing = null;
      }
      if (existing && existing.status !== "uploaded") {
        throw new AppError("CONFLICT", { message: DUPLICATE_MESSAGES[existing.status] ?? IN_PROGRESS_MESSAGE, details: { importId: existing.id } });
      }
      const row =
        existing ??
        (await (async () => {
          const id = randomUUID();
          return imports.insert(userId, {
            id,
            // Source (bank/UPI app) and account are detected while the file is read.
            file_name: input.fileName,
            file_path: statementKey(userId, id, input.fileName),
            file_size: input.fileSize,
            file_sha256: input.sha256,
            status: "uploaded",
          });
        })());
      await audit(db, { userId, action: AUDIT_ACTIONS.IMPORT_CREATED, entityType: "import", entityId: row.id, metadata: { fileName: row.file_name } });
      return { import: toImportDto(row), upload: { url: await statementStorage.createUploadUrl(row.file_path) } };
    },

    async markUploaded(userId: string, id: string): Promise<ImportDto> {
      const row = await imports.findById(userId, id);
      if (row.status !== "uploaded") return toImportDto(row);
      const stored = await statementStorage.head(row.file_path);
      if (!stored) throw invalidState("The file hasn't finished uploading yet.");
      if (stored.sizeBytes !== row.file_size) throw invalidState("The uploaded file is incomplete. Please upload it again.");
      await files.record(userId, {
        import_id: id,
        file_name: row.file_name,
        file_key: row.file_path,
        bucket: statementBucket(),
        content_type: stored.contentType,
        size_bytes: stored.sizeBytes,
        sha256: row.file_sha256,
      });
      const updated = await imports.update(userId, id, { status: "queued" });
      await queueExtract(userId, id);
      return toImportDto(updated);
    },

    /** Runs extraction inline so the password is used once, in memory, and never queued or stored. */
    async submitPassword(userId: string, id: string, password: string): Promise<ImportDto> {
      const row = await imports.findById(userId, id);
      if (row.status !== "needs_password") throw invalidState();
      // Unknown PDFs are only unlocked here (text saved); the AI reads them in background steps.
      const status = await importPipeline(db, log).extractStage(userId, id, { password, maxPdfChunks: 0 });
      const next = NEXT_STAGE[status];
      if (next) await queueExtract(userId, id, next);
      return toImportDto(await imports.findById(userId, id));
    },

    async rows(userId: string, id: string, page: PaginationQuery & { status?: string }) {
      await imports.findById(userId, id);
      const { rows, total } = await rawEvents.list(userId, page, (q) => {
        const scoped = q.eq("import_id", id);
        return page.status ? scoped.eq("status", page.status) : scoped;
      });
      return { items: rows.map(toImportRowDto), meta: pageMeta(page, total) };
    },

    /**
     * `all`: the import, its rows and the transactions that came only from it.
     * `file`: only the stored statement of a completed import; its transactions stay.
     */
    async remove(userId: string, id: string, mode: ImportDeleteMode = "all"): Promise<void> {
      const row = await imports.findById(userId, id);
      if (mode === "file") {
        if (row.status !== "completed") throw invalidState("Only a completed import can keep its transactions without the file.");
        if (row.file_deleted_at) return;
        await removeStoredFile(row);
        await imports.update(userId, id, { file_deleted_at: new Date().toISOString() });
      } else {
        await removeAll(row);
      }
      await audit(db, { userId, action: AUDIT_ACTIONS.IMPORT_DELETED, entityType: "import", entityId: id, metadata: { mode } });
    },
  };
}
