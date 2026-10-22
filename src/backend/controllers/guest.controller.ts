import "server-only";
import { withHandler, noContent } from "@/backend/http/withHandler";
import { AUTH_MODES } from "@/backend/constants/enums.constants";
import { GUEST_HEADERS, RATE_LIMITS } from "@/backend/constants/security.constants";
import { guestService } from "@/backend/services/guest.service";
import { readIdempotencyKey } from "@/backend/services/idempotency";
import { guestPaymentSchema, guestRespondSchema, redeemSchema } from "@/shared/schemas/splits";

// Guest endpoints: no-referrer / no-store headers, rate limited, never touch tables directly.
const guest = { headers: GUEST_HEADERS } as const;

export const guestController = {
  redeem: withHandler(
    { ...guest, auth: AUTH_MODES.PUBLIC, body: redeemSchema, rateLimit: { bucket: "guest-redeem", policy: RATE_LIMITS.GUEST_REDEEM, by: "ip" } },
    async ({ db, auth, body }) => guestService(db).redeem(body.token, auth),
  ),
  shares: withHandler({ ...guest, auth: AUTH_MODES.SESSION }, async ({ db }) => guestService(db).shares()),
  respond: withHandler(
    { ...guest, auth: AUTH_MODES.SESSION, body: guestRespondSchema, rateLimit: { bucket: "guest-write", policy: RATE_LIMITS.GUEST_WRITE } },
    async ({ db, body }) => {
      await guestService(db).respond(body);
      return noContent();
    },
  ),
  payment: withHandler(
    { ...guest, auth: AUTH_MODES.SESSION, body: guestPaymentSchema, rateLimit: { bucket: "guest-write", policy: RATE_LIMITS.GUEST_WRITE } },
    async ({ db, body, req }) => guestService(db).reportPayment(body, readIdempotencyKey(req)),
  ),
};
