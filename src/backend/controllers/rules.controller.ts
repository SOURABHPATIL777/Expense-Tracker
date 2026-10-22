import "server-only";
import { withHandler, created, noContent } from "@/backend/http/withHandler";
import { AUTH_MODES } from "@/backend/constants/enums.constants";
import { rulesService } from "@/backend/services/categorization.service";
import { ruleBaseSchema, ruleInputSchema } from "@/shared/schemas/categories";
import { idParamsSchema } from "@/shared/schemas/common";

const USER = AUTH_MODES.USER;

export const rulesController = {
  list: withHandler({ auth: USER }, async ({ db, auth }) => rulesService(db).list(auth.userId)),
  create: withHandler({ auth: USER, body: ruleInputSchema }, async ({ db, auth, body }) => created(await rulesService(db).create(auth.userId, body))),
  // Partial edits skip the "category or type" refinement; the DB check constraint still enforces it.
  update: withHandler({ auth: USER, params: idParamsSchema, body: ruleBaseSchema.partial() }, async ({ db, auth, params, body }) =>
    rulesService(db).update(auth.userId, params.id, body),
  ),
  remove: withHandler({ auth: USER, params: idParamsSchema }, async ({ db, auth, params }) => {
    await rulesService(db).remove(auth.userId, params.id);
    return noContent();
  }),
  /** Re-runs rules and learned merchants over existing transactions in the background. */
  apply: withHandler({ auth: USER }, async ({ db, auth }) => {
    await rulesService(db).apply(auth.userId);
    return noContent();
  }),
};
