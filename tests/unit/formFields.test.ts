import { describe, expect, it } from "vitest";
import { accountFormSchema, accountInputSchema } from "@/shared/schemas/accounts";
import { rupeesField } from "@/shared/schemas/formFields";
import { safeNextPath } from "@/frontend/lib/safeRedirect";

describe("account form → API input", () => {
  it("converts raw form strings into a valid API payload", () => {
    const parsed = accountFormSchema.parse({
      label: "HDFC Salary",
      sourceKind: "bank",
      sourceApp: "hdfc",
      maskedNumber: "",
      upiIds: "Rahul@OKHDFCBANK, 9876543210@ybl",
      isPrimary: "true",
    });
    expect(parsed).toEqual({
      label: "HDFC Salary",
      sourceKind: "bank",
      sourceApp: "hdfc",
      maskedNumber: undefined,
      upiIds: ["rahul@okhdfcbank", "9876543210@ybl"],
      isPrimary: true,
    });
    expect(accountInputSchema.safeParse(parsed).success).toBe(true);
  });

  it("rejects full account numbers and malformed UPI IDs", () => {
    const result = accountFormSchema.safeParse({ label: "x", sourceKind: "bank", sourceApp: "sbi", maskedNumber: "123456789012", upiIds: "not-a-vpa" });
    expect(result.success).toBe(false);
  });
});

describe("rupeesField", () => {
  it("parses rupees into paise", () => {
    expect(rupeesField.parse("1,250.50")).toBe(125050);
  });
  it.each(["0", "-5", "abc", ""])("rejects %s", (v) => {
    expect(rupeesField.safeParse(v).success).toBe(false);
  });
});

describe("safeNextPath", () => {
  it.each([
    ["/transactions", "/transactions"],
    ["//evil.com", "/dashboard"],
    ["https://evil.com", "/dashboard"],
    ["/\\evil.com", "/dashboard"],
    [null, "/dashboard"],
  ])("%s → %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});
