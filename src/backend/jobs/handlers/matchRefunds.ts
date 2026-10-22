import "server-only";
import { z } from "zod";
import { defineJob } from "@/backend/jobs/defineJob";
import { refundsService } from "@/backend/services/refunds.service";

/** After new credits arrive (an import), look for refunds the user is waiting on. */
export const matchRefundsJob = defineJob({
  type: "match_refunds",
  payload: z.object({ importId: z.uuid().optional() }),
  async run(_payload, ctx) {
    const suggested = await refundsService(ctx.db).refreshSuggestions(ctx.userId);
    ctx.log.info({ suggested }, "refund suggestions refreshed");
  },
});
