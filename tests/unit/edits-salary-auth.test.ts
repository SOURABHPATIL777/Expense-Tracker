import { describe, expect, it } from "vitest";
import { counterpartyKey } from "@/backend/domain/counterparty";
import { looksLikeSalary, similarEarlierCredits } from "@/backend/domain/salary";
import { readEmailLink } from "@/backend/services/auth.service";
import { callTimeoutMs } from "@/backend/llm/run";
import { exceededAttempts } from "@/backend/jobs/worker";
import { LLM } from "@/backend/constants/llm.constants";

describe("counterpartyKey", () => {
  it("prefers the UPI ID, then the cleaned merchant name", () => {
    expect(counterpartyKey({ counterparty_vpa: " Rahul.S@OKHDFCBANK ", merchant_normalized: "Rahul" })).toEqual({ field: "vpa", value: "rahul.s@okhdfcbank" });
    expect(counterpartyKey({ counterparty_vpa: null, merchant_normalized: "ACME TECH" })).toEqual({ field: "merchant", value: "ACME TECH" });
    expect(counterpartyKey({ counterparty_vpa: null, merchant_normalized: null })).toBeNull();
  });
});

describe("salary", () => {
  const credit = (narration: string, over = {}) => ({ direction: "credit" as const, status: "success", narration, merchant_raw: null, merchant_normalized: null, ...over });

  it.each(["NEFT CR-SALARY ACME TECH PVT LTD", "SAL OCT 2026 ACME", "PAYROLL CREDIT ACME", "IMPS/SAL/ACME"])("recognises %s", (n) => {
    expect(looksLikeSalary(credit(n))).toBe(true);
  });

  it("never treats debits, failed credits or unrelated words as salary", () => {
    expect(looksLikeSalary(credit("UPI/rahul/salary split", { direction: "debit" }))).toBe(false);
    expect(looksLikeSalary(credit("NEFT CR-SALARY ACME", { status: "failed" }))).toBe(false);
    expect(looksLikeSalary(credit("UPI/412345678901/SALSA DANCE CLASS"))).toBe(false);
  });

  it("counts earlier similar credits from the same payer", () => {
    const base = { counterparty_vpa: null, merchant_normalized: "ACME TECH" };
    const t = { ...base, id: "now", direction: "credit" as const, amount_minor: 8_500_000, occurred_at: "2026-10-01T05:00:00Z" };
    const history = [
      { ...base, id: "sep", amount_minor: 8_400_000, occurred_at: "2026-09-01T05:00:00Z" },
      { ...base, id: "aug", amount_minor: 8_500_000, occurred_at: "2026-08-01T05:00:00Z" },
      { ...base, id: "bonus", amount_minor: 20_000_000, occurred_at: "2026-07-15T05:00:00Z" },
      { ...base, id: "later", amount_minor: 8_500_000, occurred_at: "2026-11-01T05:00:00Z" },
      { counterparty_vpa: "friend@ybl", merchant_normalized: null, id: "friend", amount_minor: 8_500_000, occurred_at: "2026-09-02T05:00:00Z" },
    ];
    expect(similarEarlierCredits(t, history)).toBe(2);
    expect(similarEarlierCredits({ ...t, direction: "debit" }, history)).toBe(0);
  });
});

describe("readEmailLink", () => {
  const read = (q: string) => readEmailLink(new URLSearchParams(q));

  it("reads a PKCE code, a token hash, or Supabase's error", () => {
    expect(read("code=abc")).toEqual({ kind: "code", code: "abc" });
    expect(read("token_hash=h123&type=email")).toEqual({ kind: "token", tokenHash: "h123", type: "email" });
    expect(read("error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid")).toEqual({ kind: "error", reason: "otp_expired" });
  });

  it("rejects unknown token types and empty links", () => {
    expect(read("token_hash=h&type=evil")).toEqual({ kind: "error", reason: "missing_code" });
    expect(read("")).toEqual({ kind: "error", reason: "missing_code" });
  });
});

describe("background time limits", () => {
  it("shortens an LLM call to fit before the job's deadline, and refuses one that can't", () => {
    expect(callTimeoutMs(Number.POSITIVE_INFINITY)).toBe(LLM.TIMEOUT_MS);
    expect(callTimeoutMs(30_000)).toBe(30_000 - LLM.DEADLINE_MARGIN_MS);
    expect(() => callTimeoutMs(LLM.MIN_CALL_MS)).toThrow(/Not enough time/);
  });

  it("buries a job claimed again after its runs kept dying", () => {
    expect(exceededAttempts(5, 5)).toBe(false);
    expect(exceededAttempts(6, 5)).toBe(true);
  });
});
