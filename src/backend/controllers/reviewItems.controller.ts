import "server-only";
import { withHandler, noContent, paged } from "@/backend/http/withHandler";
import { AUTH_MODES } from "@/backend/constants/enums.constants";
import { reviewService } from "@/backend/services/review.service";
import { idParamsSchema } from "@/shared/schemas/common";
import { resolveReviewSchema, reviewListQuerySchema } from "@/shared/schemas/review";

const USER = AUTH_MODES.USER;

export const reviewItemsController = {
  list: withHandler({ auth: USER, query: reviewListQuerySchema }, async ({ db, auth, query }) => {
    const { items, meta } = await reviewService(db).list(auth.userId, query);
    return paged(items, meta);
  }),
  resolve: withHandler({ auth: USER, params: idParamsSchema, body: resolveReviewSchema }, async ({ db, auth, params, body }) => {
    await reviewService(db).resolve(auth.userId, params.id, body);
    return noContent();
  }),
};
