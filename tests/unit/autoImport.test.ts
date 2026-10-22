import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runLlmTask = vi.fn();
vi.mock("@/backend/llm/run", async (original) => ({ ...(await original<typeof import("@/backend/llm/run")>()), runLlmTask }));

const { matchCategory, normalizeKeyword, keywordAppearsIn } = await import("@/backend/domain/categoryMap");
const { looksLikeIndividual } = await import("@/backend/domain/individual");
const { verifyLlmRows, chunkLines } = await import("@/backend/llm/pdfExtraction");
const { mapColumnsWithLlm } = await import("@/backend/llm/columnMapping");
const { readCsv } = await import("@/backend/import/readers/csv");

const entry = (keyword: string, categoryName: string, userScoped = false) => ({ keyword, categoryName, transactionKind: null, userScoped });

describe("category map matching", () => {
  const shared = [entry("indmoney", "Investments"), entry("indmoney credit card repayment", "Credit Card Bill"), entry("ola", "Transport"), entry("zomato", "Food & Dining")];

  it("prefers the longest shared keyword", () => {
    expect(matchCategory(["INDMONEY CREDIT CARD REPAYMENT"], shared)?.categoryName).toBe("Credit Card Bill");
    expect(matchCategory(["Indmoney"], shared)?.categoryName).toBe("Investments");
  });

  it("lets the user's own mapping win over a longer shared one", () => {
    const own = entry("indmoney", "Shopping", true);
    expect(matchCategory(["INDMONEY CREDIT CARD REPAYMENT"], [...shared, own])?.categoryName).toBe("Shopping");
  });

  it("matches whole words only, across merchant, narration and UPI handle", () => {
    expect(matchCategory(["Coca Cola"], shared)).toBeNull();
    expect(matchCategory([null, "UPI/412345678901/ZOMATO.ORDER@HDFCBANK"], shared)?.categoryName).toBe("Food & Dining");
    expect(keywordAppearsIn(["Apple Media Services"], "apple media")).toBe(true);
  });

  it("normalises keywords for storage and rejects junk", () => {
    expect(normalizeKeyword("  Apple Media! ")).toBe("apple media");
    expect(normalizeKeyword("x")).toBeNull();
    expect(normalizeKeyword(null)).toBeNull();
  });
});

describe("looksLikeIndividual", () => {
  it.each([
    [{ merchant: "Rahul Sharma", vpa: "rahul.s@okhdfcbank", narration: null }, true],
    [{ merchant: null, vpa: "9876543210@ybl", narration: null }, true],
    [{ merchant: "X", vpa: null, narration: "UPI/P2A/412345678901/X" }, true],
    [{ merchant: "Swiggy Stores", vpa: "swiggy.stores@axisbank", narration: null }, false],
    [{ merchant: "Sharma Enterprises", vpa: "9876543210@ybl", narration: null }, false],
    [{ merchant: "Zomato", vpa: "zomato@paytm", narration: "UPI/P2M/412345678901/ZOMATO" }, false],
  ])("%o → %s", (t, expected) => {
    expect(looksLikeIndividual(t)).toBe(expected);
  });
});

describe("verifyLlmRows (PDF anti-hallucination)", () => {
  const chunk = "05 Oct 2024 Paid to Swiggy ₹350.00\nUPI Ref 427912345678\n06 Oct 2024 Received from Rahul ₹500.00";
  const base = { time: null, counterparty: null, status: null, description: "Paid to Swiggy" };

  it("keeps rows whose date and amount appear verbatim and parse", () => {
    const { events, dropped } = verifyLlmRows(chunk, [{ ...base, date: "05 Oct 2024", amount: "₹350.00", direction: "debit", reference: "427912345678" }]);
    expect(dropped).toBe(0);
    expect(events[0]).toMatchObject({ amountMinor: 35000, direction: "debit", referenceId: "427912345678", narration: "Paid to Swiggy" });
  });

  it("drops rows with an amount or date that isn't in the text", () => {
    const { events, dropped } = verifyLlmRows(chunk, [
      { ...base, date: "05 Oct 2024", amount: "₹3,500.00", direction: "debit" },
      { ...base, date: "07 Oct 2024", amount: "₹500.00", direction: "credit" },
    ]);
    expect(events).toHaveLength(0);
    expect(dropped).toBe(2);
  });

  it("discards a reference the model made up but keeps the row", () => {
    const { events } = verifyLlmRows(chunk, [{ ...base, date: "06 Oct 2024", amount: "500.00", direction: "credit", reference: "999999999999" }]);
    expect(events[0].referenceId).toBeNull();
  });

  it("chunks long text by size", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i} ${"x".repeat(40)}`);
    const chunks = chunkLines(lines, 1_000);
    expect(chunks.length).toBeGreaterThan(4);
    expect(chunks.flat()).toEqual(lines);
  });
});

describe("mapColumnsWithLlm", () => {
  const read = readCsv(readFileSync(join(process.cwd(), "tests/fixtures/synthetic/hdfc.csv")));
  const good = {
    headerRowIndex: read.rows.findIndex((r) => r[0] === "Date"),
    columns: { date: 0, narration: 1, reference: 2, balance: 6 },
    amount: { mode: "split", debit: 4, credit: 5 },
    dateFormat: "dd/MM/yy",
    sourceKind: "bank",
    sourceApp: "hdfc",
  };
  const wrongDates = { ...good, dateFormat: "MM/dd/yyyy" };

  beforeEach(() => runLlmTask.mockReset());

  it("accepts a mapping that parses the file and reports the detected source", async () => {
    runLlmTask.mockResolvedValueOnce(good);
    const out = await mapColumnsWithLlm("user-1", "statement.csv", read);
    expect(out).toMatchObject({ sourceKind: "bank", sourceApp: "hdfc" });
    expect(out.config.label).toBe("HDFC Bank statement (CSV/Excel)");
    expect(runLlmTask).toHaveBeenCalledTimes(1);
  });

  it("retries once, telling the model what failed", async () => {
    runLlmTask.mockResolvedValueOnce(wrongDates).mockResolvedValueOnce(good);
    await mapColumnsWithLlm("user-1", "statement.csv", read);
    expect(runLlmTask).toHaveBeenCalledTimes(2);
    expect(runLlmTask.mock.calls[1][0].data).toContain("problemsWithPreviousAnswer");
  });

  it("gives up after two mappings that don't parse", async () => {
    runLlmTask.mockResolvedValue(wrongDates);
    await expect(mapColumnsWithLlm("user-1", "statement.csv", read)).rejects.toThrow(/couldn't work out this file's columns/);
  });
});
