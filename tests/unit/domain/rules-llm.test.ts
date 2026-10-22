import { describe, expect, it } from "vitest";
import { firstMatchingRule, type Rule } from "@/backend/domain/rules";
import { categorizeData, categorizeSchema } from "@/backend/llm/prompts/categorize";
import { isCloudModel } from "@/backend/llm/registry";
import { llmConfigInputSchema } from "@/shared/schemas/llm";
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
    expect(schema.safeParse({ items: [{ index: 0, category: "Food", kind: "expense", confidence: 0.9 }] }).success).toBe(true);
    expect(schema.safeParse({ items: [{ index: 0, category: "Crypto", kind: "expense", confidence: 0.9 }] }).success).toBe(false);
  });
});

describe("cloud consent", () => {
  it.each([
    [{ provider: "openai", model: "gpt-5-mini" }, true],
    [{ provider: "ollama", model: "qwen3.5:9b" }, false],
    [{ provider: "ollama", model: "glm-5.2:cloud" }, true],
  ] as const)("%o → %s", (ref, cloud) => {
    expect(isCloudModel(ref)).toBe(cloud);
  });

  it("requires an endpoint name for Ollama configs", () => {
    const base = { task: "categorize", provider: "ollama", model: "qwen3.5:9b" };
    expect(llmConfigInputSchema.safeParse(base).success).toBe(false);
    expect(llmConfigInputSchema.safeParse({ ...base, endpointName: "local" }).success).toBe(true);
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
