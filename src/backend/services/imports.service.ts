import "server-only";
import { randomUUID } from "node:crypto";
import { getAdminClient, type Db } from "@/backend/supabase/clients";
import type { Logger } from "@/backend/logger/logger";
import { AppError, invalidState } from "@/backend/errors/AppError";
import { AUDIT_ACTIONS, type ImportStatus } from "@/backend/constants/enums.constants";
import { ImportsRepository, ImportTemplatesRepository } from "@/backend/repositories/imports.repository";
import { RawEventsRepository } from "@/backend/repositories/rawEvents.repository";
import { AccountsRepository } from "@/backend/repositories/accounts.repository";
import { toImportDto, toImportRowDto } from "@/backend/mappers/imports.mapper";
import { detectFormat, readerFor, readFile } from "@/backend/import/readers";
import { configFromMapping, suggestHeaderRow } from "@/backend/import/mapping";
import { headerSignature } from "@/backend/import/text";
import { enqueueJob } from "@/backend/jobs/queue";
import { kickWorker } from "@/backend/jobs/worker";
import { pageMeta } from "./paginate";
import { audit } from "./auditLog";
import { statementPath, statementStorage } from "./storage";
import { importPipeline } from "./importPipeline.service";
import { SOURCE_CONFIG } from "@/shared/constants/sources";
import type { PaginationQuery } from "@/shared/schemas/common";
import type { CreateImportInput, CreateImportResultDto, ImportDto, ImportPreviewDto, MappingInput } from "@/shared/schemas/imports";

const PREVIEW_ROWS = 25;
const PREVIEW_CELL_CHARS = 60;
const MAPPABLE = new Set<ImportStatus>(["needs_mapping", "failed"]);

export function importsService(db: Db, log: Logger) {
  const imports = new ImportsRepository(db);
  const templates = new ImportTemplatesRepository(db);
  const rawEvents = new RawEventsRepository(db);

  /** Jobs are service-role only, so enqueueing uses the admin client; the worker starts right after the response. */
  async function queueExtract(userId: string, importId: string, stage: "extract" | "process" = "extract") {
    await enqueueJob(getAdminClient(), { type: "parse_import", userId, payload: { importId, stage }, idempotencyKey: `import:${importId}:${stage}:${randomUUID()}` });
    kickWorker();
  }

  async function readTable(userId: string, importId: string) {
    const row = await imports.findById(userId, importId);
    const buffer = await statementStorage.download(db, row.file_path);
    const read = await readFile(readerFor(detectFormat(row.file_name, buffer)), buffer);
    if (read.kind !== "table") throw invalidState("Column mapping is only available for CSV and Excel files.");
    return { row, rows: read.rows };
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
      if (input.accountId) await new AccountsRepository(db).findById(userId, input.accountId);
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
            account_id: input.accountId ?? null,
            source_kind: SOURCE_CONFIG[input.sourceApp].kind,
            source_app: input.sourceApp,
            file_name: input.fileName,
            file_path: statementPath(userId, id, input.fileName),
            file_size: input.fileSize,
            file_sha256: input.sha256,
            status: "uploaded",
          });
        })());
      await audit(db, { userId, action: AUDIT_ACTIONS.IMPORT_CREATED, entityType: "import", entityId: row.id, metadata: { sourceApp: row.source_app } });
      return { import: toImportDto(row), upload: { url: await statementStorage.createUploadUrl(db, row.file_path) } };
    },

    async markUploaded(userId: string, id: string): Promise<ImportDto> {
      const row = await imports.findById(userId, id);
      if (row.status !== "uploaded") return toImportDto(row);
      if (!(await statementStorage.exists(db, row.file_path))) throw invalidState("The file hasn't finished uploading yet.");
      const updated = await imports.update(userId, id, { status: "queued" });
      await queueExtract(userId, id);
      return toImportDto(updated);
    },

    async preview(userId: string, id: string): Promise<ImportPreviewDto> {
      const { rows } = await readTable(userId, id);
      const head = rows.slice(0, PREVIEW_ROWS).map((r) => r.map((c) => c.slice(0, PREVIEW_CELL_CHARS)));
      return { rows: head, suggestedHeaderRow: suggestHeaderRow(rows) };
    },

    async applyMapping(userId: string, id: string, input: MappingInput): Promise<ImportDto> {
      const { row, rows } = await readTable(userId, id);
      if (!MAPPABLE.has(row.status)) throw invalidState();
      const header = rows[input.headerRowIndex];
      if (!header) throw new AppError("VALIDATION", { message: "That header row doesn't exist." });
      const source = { sourceKind: row.source_kind, sourceApp: row.source_app as ImportDto["sourceApp"] };
      let config = configFromMapping(input, header, source);
      let templateId: string | null = null;
      if (input.saveTemplate) {
        const template = await templates.upsert(userId, {
          name: input.templateName ?? `${row.file_name} layout`,
          source_kind: row.source_kind,
          source_app: row.source_app,
          header_signature: headerSignature(header),
          config,
        });
        templateId = template.id;
        config = configFromMapping(input, header, { ...source, templateId });
        await templates.update(userId, template.id, { config });
      }
      const updated = await imports.update(userId, id, { config, template_id: templateId, status: "queued", error_message: null, error_code: null });
      await queueExtract(userId, id);
      return toImportDto(updated);
    },

    /** Runs extraction inline so the password is used once, in memory, and never queued or stored. */
    async submitPassword(userId: string, id: string, password: string): Promise<ImportDto> {
      const row = await imports.findById(userId, id);
      if (row.status !== "needs_password") throw invalidState();
      const status = await importPipeline(db, log).extractStage(userId, id, { password });
      if (status === "processing") await queueExtract(userId, id, "process");
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
      await statementStorage.remove(db, row.file_path);
      await audit(db, { userId, action: AUDIT_ACTIONS.IMPORT_DELETED, entityType: "import", entityId: id });
    },
  };
}
