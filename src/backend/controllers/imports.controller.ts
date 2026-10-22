import "server-only";
import { withHandler, created, noContent, paged } from "@/backend/http/withHandler";
import { AUTH_MODES } from "@/backend/constants/enums.constants";
import { RATE_LIMITS } from "@/backend/constants/security.constants";
import { importsService } from "@/backend/services/imports.service";
import { readIdempotencyKey, withIdempotency } from "@/backend/services/idempotency";
import { idParamsSchema } from "@/shared/schemas/common";
import { createImportSchema, deleteImportQuerySchema, importListQuerySchema, passwordSchema, rowsQuerySchema } from "@/shared/schemas/imports";

const USER = AUTH_MODES.USER;
const byId = { auth: USER, params: idParamsSchema } as const;

export const importsController = {
  list: withHandler({ auth: USER, query: importListQuerySchema }, async ({ db, log, auth, query }) => {
    const { items, meta } = await importsService(db, log).list(auth.userId, query);
    return paged(items, meta);
  }),

  create: withHandler(
    { auth: USER, body: createImportSchema, rateLimit: { bucket: "upload", policy: RATE_LIMITS.UPLOAD } },
    async ({ db, log, auth, body, req }) => {
      const key = readIdempotencyKey(req);
      return created(await withIdempotency(db, auth.userId, "imports.create", key, () => importsService(db, log).create(auth.userId, body)));
    },
  ),

  get: withHandler(byId, async ({ db, log, auth, params }) => importsService(db, log).get(auth.userId, params.id)),

  uploaded: withHandler(byId, async ({ db, log, auth, params }) => importsService(db, log).markUploaded(auth.userId, params.id)),

  password: withHandler(
    { ...byId, body: passwordSchema, rateLimit: { bucket: "import-password", policy: RATE_LIMITS.AUTH } },
    async ({ db, log, auth, params, body }) => importsService(db, log).submitPassword(auth.userId, params.id, body.password),
  ),

  rows: withHandler({ ...byId, query: rowsQuerySchema }, async ({ db, log, auth, params, query }) => {
    const { items, meta } = await importsService(db, log).rows(auth.userId, params.id, query);
    return paged(items, meta);
  }),

  remove: withHandler({ ...byId, query: deleteImportQuerySchema }, async ({ db, log, auth, params, query }) => {
    await importsService(db, log).remove(auth.userId, params.id, query.mode);
    return noContent();
  }),
};
