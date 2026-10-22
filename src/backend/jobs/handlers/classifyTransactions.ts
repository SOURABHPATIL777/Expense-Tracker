import "server-only";
import { z } from "zod";
import { defineJob } from "@/backend/jobs/defineJob";
import { classificationService, type ClassifyScope } from "@/backend/services/classification.service";

const payload = z.union([
  z.object({ scope: z.literal("all"), cursor: z.uuid().optional() }),
  // `scope` defaults to "import" so AFTER_IMPORT_JOBS can enqueue a bare `{ importId }`.
  z.object({ scope: z.literal("import").default("import"), importId: z.uuid(), cursor: z.uuid().optional() }),
]);

export const classifyTransactionsJob = defineJob({
  type: "classify_transactions",
  payload,
  async run(input, ctx) {
    const scope = input as ClassifyScope;
    const cursor = await classificationService(ctx.db, ctx.log).classifyStep(ctx.userId, scope);
    if (cursor) {
      await ctx.enqueue({ type: "classify_transactions", payload: { ...scope, cursor }, idempotencyKey: `classify:after:${ctx.jobId}` });
    }
  },
});
