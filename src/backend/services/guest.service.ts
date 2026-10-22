import "server-only";
import type { Db } from "@/backend/supabase/clients";
import { AppError, unwrap, unwrapMaybe } from "@/backend/errors/AppError";
import { RPC } from "@/backend/constants/db.constants";
import { sha256Hex } from "@/backend/domain/fingerprint";
import type { AuthContext } from "@/backend/http/middleware/auth";
import type { GuestShareDto } from "@/shared/schemas/splits";

/**
 * Guests act only through SECURITY DEFINER functions that check their guest_access row;
 * they never get table access. "No signup" still means a real (anonymous) session.
 */
export function guestService(db: Db) {
  return {
    /** Starts an anonymous session if needed, then binds the invite to it. Runs on an explicit POST, never on GET. */
    async redeem(token: string, auth: AuthContext | null): Promise<{ participantId: string }> {
      if (!auth) {
        const { error } = await db.auth.signInAnonymously();
        if (error) throw new AppError("UPSTREAM", { message: "Couldn't start a guest session. Try again.", internal: { code: error.code } });
      }
      const participantId = unwrap(await db.rpc(RPC.REDEEM_INVITE, { p_token_hash: sha256Hex(token) }), "guest.redeem") as string;
      return { participantId };
    },

    async shares(): Promise<GuestShareDto[]> {
      return unwrap(await db.rpc(RPC.GUEST_GET_SHARE), "guest.shares") as GuestShareDto[];
    },

    async respond(input: { participantId: string; response: "agreed" | "questioned"; version: number; message?: string }): Promise<void> {
      unwrapMaybe(
        await db.rpc(RPC.GUEST_RESPOND, { p_participant_id: input.participantId, p_response: input.response, p_version: input.version, p_message: input.message ?? null }),
        "guest.respond",
      );
    },

    async reportPayment(input: { participantId: string; amountMinor: number; note?: string }, idempotencyKey: string): Promise<{ claimId: string }> {
      const claimId = unwrap(
        await db.rpc(RPC.GUEST_REPORT_PAYMENT, { p_participant_id: input.participantId, p_amount_minor: input.amountMinor, p_idempotency_key: idempotencyKey, p_note: input.note ?? null }),
        "guest.reportPayment",
      ) as string;
      return { claimId };
    },
  };
}
