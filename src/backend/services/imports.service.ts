import "server-only";
import { randomUUID } from "node:crypto";
import { getAdminClient, type Db } from "@/backend/supabase/clients";
import type { Logger } from "@/backend/logger/logger";
import { AppError, invalidState } from "@/backend/errors/AppError";
import { AUDIT_ACTIONS, type ImportStatus } from "@/backend/constants/enums.constants";
import { ImportsRepository } from "@/backend/repositories/imports.repository";
import { RawEventsRepository } from "@/backend/repositories/rawEvents.repository";
import { toImportDto, toImportRowDto } from "@/backend/mappers/imports.mapper";
import { enqueueJob } from "@/backend/jobs/queue";
import { kickWorker } from "@/backend/jobs/worker";
import { pageMeta } from "./paginate";
import { audit } from "./auditLog";
import { statementBucket, statementKey, statementStorage } from "./storage";
import { UploadedFilesRepository } from "@/backend/repositories/uploadedFiles.repository";
import { importPipeline } from "./importPipeline.service";
import type { PaginationQuery } from "@/shared/schemas/common";
import type { CreateImportInput, CreateImportResultDto, ImportDto } from "@/shared/schemas/imports";

/** Which job stage follows an extract result: more PDF chunks to read, or matching. */
const NEXT_STAGE: Partial<Record<ImportStatus, "extract" | "process">> = { parsing: "extract", processing: "process" };

export function importsService(db: Db, log: Logger) {
  const imports = new ImportsRepository(db);
  const rawEvents = new RawEventsRepository(db);
  const files = new UploadedFilesRepository();

  /** Jobs are service-role only, so enqueueing uses the admin client; the worker starts right after the response. */
  async function queueExtract(userId: string, importId: string, stage: "extract" | "process" = "extract") {
    await enqueueJob(getAdminClient(), { type: "parse_import", userId, payload: { importId, stage }, idempotencyKey: `import:${importId}:${stage}:${randomUUID()}` });
    kickWorker();
  }

  return {
    async list(userId: string, page: PaginationQuery) {
      const { rows, total } = await imports.list(userId, page);
      return { items: rows.map(toImportDto), meta: pageMeta(page, total) };
    },

    async get(userId: string, id: string): Promise<ImportDto> {
      return toImportDto(await imports.findById(userId, id));
    },

    async create(userId: string, input: CreateImportInput): Promise<CreateImportResultDto> {
      const existing = await imports.findBySha(userId, input.sha256);
      if (existing && existing.status !== "uploaded") {
        throw new AppError("CONFLICT", { message: "You've already imported this exact file.", details: { importId: existing.id } });
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

    async remove(userId: string, id: string): Promise<void> {
      const row = await imports.findById(userId, id);
      await imports.deleteCascade(id);
      await statementStorage.remove(row.file_path);
      await files.setStatus(userId, row.file_path, "deleted");
      await audit(db, { userId, action: AUDIT_ACTIONS.IMPORT_DELETED, entityType: "import", entityId: id });
    },
  };
}
