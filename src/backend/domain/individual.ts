import "server-only";

export type CounterpartyText = { merchant: string | null; vpa: string | null; narration: string | null };

const PERSON_TO_PERSON = /\b(P2A|P2P)\b/i;
const PERSON_TO_MERCHANT = /\bP2M\b/i;
const PHONE_HANDLE = /^(\+?91)?[6-9]\d{9}$/;
/** Words and gateways that indicate a business rather than a person. */
const MERCHANT_MARKERS =
  /\b(pvt|private|ltd|limited|llp|store|stores|shop|mart|enterprises?|services|technolog\w*|payments?|retail|traders?|restaurant|cafe|hotel|bank|merchant|razorpay|rzp|paytm|bharatpe|phonepe|billdesk|cashfree|payu|ccavenue|pinelabs|cred)\b/i;
const NAME_LIKE = /^[a-z]{2,}(?: [a-z.]{1,}){1,3}$/i;

/**
 * Person-to-person payment? Such payments get the "Individual" category and are never added to
 * the shared keyword map (a person's name or UPI ID is not a merchant).
 */
export function looksLikeIndividual(t: CounterpartyText): boolean {
  const narration = t.narration ?? "";
  if (PERSON_TO_PERSON.test(narration)) return true;
  if (PERSON_TO_MERCHANT.test(narration)) return false;
  const text = `${t.merchant ?? ""} ${t.vpa ?? ""}`;
  if (MERCHANT_MARKERS.test(text)) return false;
  const handle = t.vpa?.split("@")[0] ?? "";
  if (PHONE_HANDLE.test(handle)) return true;
  return Boolean(t.merchant && NAME_LIKE.test(t.merchant.trim()));
}
