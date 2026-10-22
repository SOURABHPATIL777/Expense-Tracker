import "server-only";
import { z } from "zod";
import { withHandler, created, noContent, paged } from "@/backend/http/withHandler";
import { AUTH_MODES } from "@/backend/constants/enums.constants";
import { splitsService } from "@/backend/services/splits.service";
import { idParamsSchema, uuidSchema } from "@/shared/schemas/common";
import { claimActionSchema, createSplitSchema, recordPaymentSchema, splitListQuerySchema, splitStatusSchema, updateSplitSchema } from "@/shared/schemas/splits";

const USER = AUTH_MODES.USER;
const byId = { auth: USER, params: idParamsSchema } as const;
const participantParams = z.object({ id: uuidSchema, participantId: uuidSchema });
const claimParams = z.object({ id: uuidSchema, claimId: uuidSchema });

export const splitsController = {
  list: withHandler({ auth: USER, query: splitListQuerySchema }, async ({ db, auth, query }) => {
    const { items, meta } = await splitsService(db).list(auth.userId, query);
    return paged(items, meta);
  }),
  create: withHandler({ auth: USER, body: createSplitSchema }, async ({ db, auth, body }) => created(await splitsService(db).create(auth.userId, body))),
  get: withHandler(byId, async ({ db, auth, params }) => splitsService(db).detail(auth.userId, params.id)),
  update: withHandler({ ...byId, body: updateSplitSchema }, async ({ db, auth, params, body }) => splitsService(db).update(auth.userId, params.id, body)),
  status: withHandler({ ...byId, body: splitStatusSchema }, async ({ db, auth, params, body }) => splitsService(db).setStatus(auth.userId, params.id, body.action)),
  issueInvite: withHandler({ auth: USER, params: participantParams }, async ({ db, auth, params }) =>
    created(await splitsService(db).issueInvite(auth.userId, params.id, params.participantId)),
  ),
  revokeInvite: withHandler({ auth: USER, params: participantParams }, async ({ db, auth, params }) => {
    await splitsService(db).revokeInvite(auth.userId, params.id, params.participantId);
    return noContent();
  }),
  resolveClaim: withHandler({ auth: USER, params: claimParams, body: claimActionSchema }, async ({ db, auth, params, body }) =>
    splitsService(db).resolveClaim(auth.userId, params.id, params.claimId, body.action, body.matchTransactionId),
  ),
  recordPayment: withHandler({ ...byId, body: recordPaymentSchema }, async ({ db, auth, params, body }) => splitsService(db).recordPayment(auth.userId, params.id, body)),
};
