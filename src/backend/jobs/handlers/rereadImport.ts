import "server-only";
import { z } from "zod";
import { defineJob } from "@/backend/jobs/defineJob";
import { importPipeline } from "@/backend/services/importPipeline.service";
import { statementStorage } from "@/backend/services/storage";
import { ImportsRepository } from "@/backend/repositories/imports.repository";

export const rereadImportPayload = z.object({
  importId: z.uuid(),
  /** The statement was just uploaded again: read it (else names are worked out from the stored rows). */
  fromFile: z.boolean().default(false),
});

/** Brings an earlier import up to date with today's reader, then categorises its transactions again. */
export const rereadImportJob = defineJob({
  type: "reread_import",
  payload: rereadImportPayload,
  async run({ importId, fromFile }, ctx) {
    const outcome = await importPipeline(ctx.db, ctx.log).rereadImport(ctx.userId, importId, { fromFile });
    if (!outcome) return;
    // Better names and the cleaned-up keywords can change categories: redo what the user didn't set.
    await ctx.enqueue({ type: "classify_transactions", payload: { scope: "import", importId, redo: true }, idempotencyKey: `classify:reread:${ctx.jobId}` });
  },
  // A copy uploaded only to be read again never stays in storage.
  async onDead({ importId, fromFile }, ctx) {
    if (!fromFile) return;
    const row = await new ImportsRepository(ctx.db).findById(ctx.userId, importId);
    await statementStorage.remove(row.file_path);
  },
});
