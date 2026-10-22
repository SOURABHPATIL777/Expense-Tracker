import "server-only";
import { withHandler, created, noContent } from "@/backend/http/withHandler";
import { AUTH_MODES } from "@/backend/constants/enums.constants";
import { categoriesService } from "@/backend/services/categorization.service";
import { categoryInputSchema } from "@/shared/schemas/categories";
import { idParamsSchema } from "@/shared/schemas/common";

const USER = AUTH_MODES.USER;

export const categoriesController = {
  list: withHandler({ auth: USER }, async ({ db, auth }) => categoriesService(db).list(auth.userId)),
  create: withHandler({ auth: USER, body: categoryInputSchema }, async ({ db, auth, body }) => created(await categoriesService(db).create(auth.userId, body))),
  update: withHandler({ auth: USER, params: idParamsSchema, body: categoryInputSchema.partial() }, async ({ db, auth, params, body }) =>
    categoriesService(db).update(auth.userId, params.id, body),
  ),
  remove: withHandler({ auth: USER, params: idParamsSchema }, async ({ db, auth, params }) => {
    await categoriesService(db).remove(auth.userId, params.id);
    return noContent();
  }),
};
