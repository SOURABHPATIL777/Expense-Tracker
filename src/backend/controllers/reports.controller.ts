import "server-only";
import { withHandler } from "@/backend/http/withHandler";
import { AUTH_MODES } from "@/backend/constants/enums.constants";
import { RATE_LIMITS } from "@/backend/constants/security.constants";
import { reportsService } from "@/backend/services/reports.service";
import { reportRangeSchema } from "@/shared/schemas/reports";

export const reportsController = {
  overview: withHandler({ auth: AUTH_MODES.USER, query: reportRangeSchema }, async ({ db, auth, query }) => reportsService(db).overview(auth.userId, query)),
  summary: withHandler(
    { auth: AUTH_MODES.USER, body: reportRangeSchema, rateLimit: { bucket: "llm-summary", policy: RATE_LIMITS.LLM } },
    async ({ db, auth, body }) => reportsService(db).summary(auth.userId, body),
  ),
};
