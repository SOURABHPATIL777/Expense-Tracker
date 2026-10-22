import "server-only";
import { z } from "zod";
import { defineJob } from "@/backend/jobs/defineJob";
import { AFTER_IMPORT_JOBS } from "@/backend/constants/app.constants";
import { importPipeline } from "@/backend/services/importPipeline.service";

export const parseImportPayload = z.object({
  importId: z.uuid(),
  stage: z.enum(["extract", "process"]).default("extract"),
});
export type ParseImportPayload = z.infer<typeof parseImportPayload>;

export const parseImportJob = defineJob({
  type: "parse_import",
  payload: parseImportPayload,
  async run({ importId, stage }, ctx) {
    const pipeline = importPipeline(ctx.db, ctx.log);
    // Keys derive from this job's id, so a retried job never schedules its successor twice.
    const next = () =>
      ctx.enqueue({ type: "parse_import", payload: { importId, stage: "process" }, idempotencyKey: `import:${importId}:after:${ctx.jobId}` });

    if (stage === "extract") {
      if ((await pipeline.extractStage(ctx.userId, importId)) === "processing") await next();
      return;
    }
    const { done } = await pipeline.processStep(ctx.userId, importId);
    if (!done) return next();
    for (const type of AFTER_IMPORT_JOBS) {
      await ctx.enqueue({ type, payload: { importId }, idempotencyKey: `${type}:import:${importId}` });
    }
  },
});
