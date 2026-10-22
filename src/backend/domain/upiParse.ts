import "server-only";

export type UpiNarration = {
  isUpi: boolean;
  utr: string | null;
  vpa: string | null;
  name: string | null;
};

const UTR = /(?<!\d)(\d{12})(?!\d)/;
// Hyphens are excluded: several banks use "-" as the narration delimiter (HDFC "UPI-NAME-vpa@bank-IFSC-UTR").
const VPA = /[a-z0-9._]{2,}@[a-z][a-z0-9.]{1,}/i;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const NOISE = new Set([
  "upi", "dr", "cr", "p2m", "p2a", "to transfer", "by transfer", "transfer", "payment", "pay", "upi payment", "sent using paytm upi",
  "payment from ph", "paid via cred", "na", "null", "collect", "intent", "upiintent", "upi intent", "ref", "rrn",
]);

/**
 * Pulls the UTR, counterparty VPA and name out of bank UPI narrations, e.g.
 *   SBI   "TO TRANSFER-UPI/DR/412345678901/SWIGGY LIMITED/YESB/swiggy@ybl/UPI"
 *   HDFC  "UPI-SWIGGY-SWIGGY.STORES@AXISBANK-UTIB0000000-412345678901-PAYMENT"
 *   ICICI "UPI/412345678901/Payment from Ph/rahul@ybl/HDFC BANK LTD"
 */
export function parseUpiNarration(narration: string | null | undefined): UpiNarration {
  const text = (narration ?? "").trim();
  if (!/\bUPI\b/i.test(text)) return { isUpi: false, utr: null, vpa: null, name: null };

  const utr = UTR.exec(text)?.[1] ?? null;
  const vpa = VPA.exec(text)?.[0]?.toLowerCase() ?? null;

  const segments = text
    .split(/[/\\|-]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const name =
    segments.find((s) => {
      const lower = s.toLowerCase();
      if (NOISE.has(lower)) return false;
      if (utr && s.includes(utr)) return false;
      if (VPA.test(s)) return false;
      if (IFSC.test(s) || /^[A-Z]{4}$/.test(s)) return false; // IFSC or bank short code
      if (/^\d+$/.test(s)) return false;
      if (/bank\b|ltd$/i.test(s) && segments.indexOf(s) > 2) return false; // trailing "HDFC BANK LTD"
      return /[a-z]{2,}/i.test(s);
    }) ?? null;

  return { isUpi: true, utr, vpa, name };
}
