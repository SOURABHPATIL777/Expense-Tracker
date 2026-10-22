import { describe, expect, it, vi } from "vitest";
import { firstMatchingRule, type Rule } from "@/backend/domain/rules";
import { categorizeData, categorizeSchema } from "@/backend/llm/prompts/categorize";
import { ruleFormSchema } from "@/shared/schemas/categories";
import { istDateRange } from "@/backend/domain/period";

const rule = (over: Partial<Rule>): Rule => ({
  id: crypto.randomUUID(),
  field: "merchant",
  operator: "contains",
  pattern: "swiggy",
  categoryId: "food",
  transactionKind: null,
  priority: 100,
  ...over,
});

describe("firstMatchingRule", () => {
  const target = { merchant: "Swiggy Instamart", vpa: "swiggy.stores@axisbank", narration: "UPI/SWIGGY" };

  it("matches case-insensitively and respects priority", () => {
    const groceries = rule({ pattern: "instamart", categoryId: "groceries", priority: 10 });
    expect(firstMatchingRule(target, [rule({}), groceries])?.categoryId).toBe("groceries");
  });

  it.each([
    [rule({ field: "vpa", operator: "equals", pattern: "SWIGGY.STORES@AXISBANK" }), true],
    [rule({ field: "vpa", operator: "equals", pattern: "swiggy@ybl" }), false],
    [rule({ field: "narration", operator: "starts_with", pattern: "upi/" }), true],
    [rule({ field: "narration", operator: "starts_with", pattern: "neft" }), false],
  ])("%#", (r, matched) => {
    expect(Boolean(firstMatchingRule(target, [r]))).toBe(matched);
  });

  it("treats patterns as literal text, not regex", () => {
    expect(firstMatchingRule({ merchant: "a.b", vpa: null, narration: null }, [rule({ pattern: "." })])).not.toBeNull();
    expect(firstMatchingRule({ merchant: "abc", vpa: null, narration: null }, [rule({ pattern: "a.c" })])).toBeNull();
  });
});

describe("categorize prompt", () => {
  it("redacts account numbers, phones and emails before data reaches a model", () => {
    const data = categorizeData(["Food"], [
      { index: 0, direction: "debit", amountRupees: 350, merchant: "Swiggy", upiHandle: "9876543210@ybl", narration: "UPI/427912345678/acct XX1234 me@mail.com" },
    ]);
    expect(data).not.toMatch(/9876543210|427912345678|XX1234|me@mail\.com/);
    expect(data).toContain("Swiggy");
  });

  it("only accepts category names from the user's list", () => {
    const schema = categorizeSchema(["Food", "Travel"]);
    const item = { index: 0, isIndividual: false, keyword: "swiggy", kind: "expense", confidence: 0.9 };
    expect(schema.safeParse({ items: [{ ...item, category: "Food" }] }).success).toBe(true);
    expect(schema.safeParse({ items: [{ ...item, category: "Crypto" }] }).success).toBe(false);
  });
});

describe("Ollama configuration", () => {
  it("defaults to Ollama Cloud and needs a key there; a local URL needs none", async () => {
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.OLLAMA_API_KEY;
    vi.resetModules();
    let env = await import("@/backend/config/env");
    let registry = await import("@/backend/llm/registry");
    expect(env.getEnv().OLLAMA_BASE_URL).toBe("https://ollama.com/api");
    expect(registry.llmAvailable()).toBe(false);

    process.env.OLLAMA_BASE_URL = "http://localhost:11434/api/";
    vi.resetModules();
    env = await import("@/backend/config/env");
    registry = await import("@/backend/llm/registry");
    expect(env.getEnv().OLLAMA_BASE_URL).toBe("http://localhost:11434/api");
    expect(registry.llmAvailable()).toBe(true);
    delete process.env.OLLAMA_BASE_URL;
  });

  it("keeps prompts inside the configured input-token budget", async () => {
    const { inputBudgetChars, truncateForBudget } = await import("@/backend/llm/run");
    const { LLM } = await import("@/backend/constants/llm.constants");
    const budget = inputBudgetChars("categorize");
    expect(budget).toBeLessThan(LLM.MAX_INPUT_TOKENS * LLM.CHARS_PER_TOKEN);
    expect(truncateForBudget("x".repeat(budget + 500), budget)).toHaveLength(budget);
  });
});

describe("rule form", () => {
  it("needs a category or a type", () => {
    const base = { field: "merchant", operator: "contains", pattern: "rent", categoryId: "", transactionKind: "", priority: "100", isActive: "true" };
    expect(ruleFormSchema.safeParse(base).success).toBe(false);
    expect(ruleFormSchema.safeParse({ ...base, transactionKind: "self_transfer" }).success).toBe(true);
  });
});


describe("istDateRange", () => {
  it("turns inclusive IST dates into a half-open UTC range", () => {
    expect(istDateRange("2024-10-01", "2024-10-31")).toEqual({ fromIso: "2024-09-30T18:30:00.000Z", toIso: "2024-10-31T18:30:00.000Z" });
  });
});
