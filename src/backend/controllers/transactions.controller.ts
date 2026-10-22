import "server-only";
import { withHandler, paged } from "@/backend/http/withHandler";
import { AUTH_MODES } from "@/backend/constants/enums.constants";
import { transactionsService } from "@/backend/services/transactions.service";
import { idParamsSchema } from "@/shared/schemas/common";
import { transactionListQuerySchema, updateTransactionSchema } from "@/shared/schemas/transactions";

const USER = AUTH_MODES.USER;

export const transactionsController = {
  list: withHandler({ auth: USER, query: transactionListQuerySchema }, async ({ db, auth, query }) => {
    const { items, meta } = await transactionsService(db).list(auth.userId, query);
    return paged(items, meta);
  }),
  get: withHandler({ auth: USER, params: idParamsSchema }, async ({ db, auth, params }) => transactionsService(db).get(auth.userId, params.id)),
  update: withHandler({ auth: USER, params: idParamsSchema, body: updateTransactionSchema }, async ({ db, auth, params, body }) =>
    transactionsService(db).update(auth.userId, params.id, body),
  ),
};
