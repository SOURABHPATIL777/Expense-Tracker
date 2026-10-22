import { describe, expect, it } from "vitest";
import { formatInr, minorToMajorString, parseAmountToMinor } from "@/shared/utils/money";

describe("parseAmountToMinor", () => {
  it.each([
    ["500", 50000],
    ["1,23,456.7", 12345670],
    ["₹ 2,000.00", 200000],
    ["Rs.99.5", 9950],
    ["-12.50", -1250],
    ["(450.00)", -45000],
    ["450.00 Dr", 45000],
    ["1200 CR", 120000],
    [" 0.01 ", 1],
  ])("parses %s", (raw, expected) => {
    expect(parseAmountToMinor(raw)).toBe(expected);
  });

  it.each(["", "abc", "1.234", "12,34.5.6", "--5"])("rejects %s", (raw) => {
    expect(parseAmountToMinor(raw)).toBeNull();
  });

  it("handles numeric spreadsheet cells without float drift", () => {
    expect(parseAmountToMinor(1234.56)).toBe(123456);
    expect(parseAmountToMinor(0.1 + 0.2)).toBe(30);
    expect(parseAmountToMinor(Number.NaN)).toBeNull();
    expect(parseAmountToMinor(null)).toBeNull();
  });
});

describe("formatting", () => {
  it("formats paise as INR with Indian grouping", () => {
    expect(formatInr(12345678)).toBe("₹1,23,456.78");
  });

  it("round-trips minor units to a decimal string", () => {
    expect(minorToMajorString(5)).toBe("0.05");
    expect(minorToMajorString(-123456)).toBe("-1234.56");
  });
});
