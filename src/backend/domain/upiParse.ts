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

const TRANSFER = /^\s*\/?\s*(NEFT|RTGS|IMPS)\b/i;
const TRANSFER_NOISE = /^(neft|rtgs|imps)(\s+(cr|dr))?$|^(cr|dr|p2a|p2m|upi|na|null|transfer|inft|mob|ib)$/i;

/**
 * The other party of a NEFT/RTGS/IMPS narration, e.g.
 *   Axis  "NEFT/IN42627353946068/JIGSAW FINANCIAL TECHNOLOGY/ICICI BANK LIMITED/Salary Sept 2026"
 *   AU    "NEFT CR- HDFCN52025081108659761 - YELLOW WINDOWS COMMUNICATIONS LLP - HDFC0000001 -0001-INVESTMENT"
 *   Kotak "NEFT-ZEPTO PRIVATE LIMITE- CMS2742541845650"
 *   Axis  "IMPS/P2A/624614497257/Mr.SourabhPatil/X030 278/IDFCBank/"
 * The first segment after the transfer reference that reads as a name (not a reference, IFSC,
 * bank or code).
 */
export function parseTransferNarration(narration: string | null | undefined): { name: string | null } {
  const text = (narration ?? "").trim();
  if (!TRANSFER.test(text)) return { name: null };
  const segments = text
    .split(/\s*[/\\|]\s*|\s+-\s*|\s*-\s+|-(?=[A-Z0-9])/)
    .map((s) => s.trim())
    .filter(Boolean);
  const name =
    segments.find((s, i) => {
      if (i === 0 || TRANSFER_NOISE.test(s)) return false;
      if (/\d{5,}/.test(s.replace(/\s/g, ""))) return false; // a reference, UTR or account number
      if (IFSC.test(s.toUpperCase()) || VPA.test(s)) return false;
      if (/bank\b|^bank/i.test(s)) return false;
      return /[a-z]{3,}/i.test(s) && s.replace(/[^a-z]/gi, "").length >= 3;
    }) ?? null;
  return { name };
}

/** An optional amount between the verb and "to"/"from" ("Paid ₹350.00 to Swiggy"). */
const AMT = String.raw`(?:\s+(?:₹|rs\.?|inr)?\s*[\d,]+(?:\.\d{1,2})?)?`;
const STOP = String.raw`(?=\s+(?:(?:using|on|via|debit|credit|upi|from|to)\b|note:)|\s+[-+]?\s*(?:₹|rs\.|rs\s|inr\s)|[;|]|$)`;
const PAID_TO = new RegExp(String.raw`(?:paid|sent|money sent|transferred|transfer|payment)${AMT}\s+to\s+(.+?)${STOP}`, "im");
const RECEIVED_FROM = new RegExp(String.raw`(?:received|money received|credited|payment)${AMT}\s+(?:from|by)\s+(.+?)${STOP}`, "im");
/** The user's own account in a "Your Account" column ("HDFC Bank - 12"), trailing a payee name. */
const OWN_ACCOUNT = /\s+\S+\s+bank(?:\s+[a-z]{1,4})?(?:\s+-\s*\d+)?\s*$/i;

/**
 * The payee in UPI-app wording: "Paid to Indian Railways UTS", "Money sent to Ravi Kumar",
 * "Received ₹500 from Asha". The phrase matching the direction is tried first.
 */
export function payeeFromText(text: string | null | undefined, direction: "debit" | "credit"): string | null {
  if (!text) return null;
  const [first, second] = direction === "debit" ? [PAID_TO, RECEIVED_FROM] : [RECEIVED_FROM, PAID_TO];
  const raw = first.exec(text)?.[1] ?? second.exec(text)?.[1] ?? null;
  const name = raw?.replace(/\s+/g, " ").replace(OWN_ACCOUNT, "").trim().slice(0, 120);
  return name && /[a-z]{2,}/i.test(name) ? name : null;
}
