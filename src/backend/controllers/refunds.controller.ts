import "server-only";
import { withHandler, created, paged } from "@/backend/http/withHandler";
import { AUTH_MODES } from "@/backend/constants/enums.constants";
import { RATE_LIMITS } from "@/backend/constants/security.constants";
import { refundsService } from "@/backend/services/refunds.service";
import { idParamsSchema } from "@/shared/schemas/common";
import { createRefundSchema, refundActionSchema, refundListQuerySchema } from "@/shared/schemas/refunds";

const USER = AUTH_MODES.USER;
const byId = { auth: USER, params: idParamsSchema } as const;

export const refundsController = {
  list: withHandler({ auth: USER, query: refundListQuerySchema }, async ({ db, auth, query }) => {
    const { items, meta } = await refundsService(db).list(auth.userId, query);
    return paged(items, meta);
  }),
  create: withHandler({ auth: USER, body: createRefundSchema }, async ({ db, auth, body }) => created(await refundsService(db).create(auth.userId, body))),
  get: withHandler(byId, async ({ db, auth, params }) => refundsService(db).get(auth.userId, params.id)),
  act: withHandler({ ...byId, body: refundActionSchema }, async ({ db, auth, params, body }) => refundsService(db).act(auth.userId, params.id, body)),
  message: withHandler({ ...byId, rateLimit: { bucket: "llm-refund", policy: RATE_LIMITS.LLM } }, async ({ db, auth, params }) =>
    refundsService(db).draftMessage(auth.userId, params.id),
  ),
};
