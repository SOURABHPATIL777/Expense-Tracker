import "server-only";
import { withHandler, created, noContent } from "@/backend/http/withHandler";
import { AUTH_MODES } from "@/backend/constants/enums.constants";
import { accountsService } from "@/backend/services/accounts.service";
import { accountInputSchema } from "@/shared/schemas/accounts";
import { idParamsSchema } from "@/shared/schemas/common";

const USER = AUTH_MODES.USER;

export const accountsController = {
  list: withHandler({ auth: USER }, async ({ db, auth }) => accountsService(db).list(auth.userId)),

  create: withHandler({ auth: USER, body: accountInputSchema }, async ({ db, auth, body }) =>
    created(await accountsService(db).create(auth.userId, body)),
  ),

  update: withHandler({ auth: USER, params: idParamsSchema, body: accountInputSchema.partial() }, async ({ db, auth, params, body }) =>
    accountsService(db).update(auth.userId, params.id, body),
  ),

  remove: withHandler({ auth: USER, params: idParamsSchema }, async ({ db, auth, params }) => {
    await accountsService(db).remove(auth.userId, params.id);
    return noContent();
  }),
};
