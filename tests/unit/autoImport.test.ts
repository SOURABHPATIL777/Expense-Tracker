import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runLlmTask = vi.fn();
vi.mock("@/backend/llm/run", async (original) => ({ ...(await original<typeof import("@/backend/llm/run")>()), runLlmTask }));

const { matchCategory, normalizeKeyword, keywordAppearsIn, resolveCategory } = await import("@/backend/domain/categoryMap");
const { looksLikeIndividual } = await import("@/backend/domain/individual");
const { verifyLlmRows, chunkLines, readPdfChunkWithLlm } = await import("@/backend/llm/pdfExtraction");
const { mapColumnsWithLlm } = await import("@/backend/llm/columnMapping");
const { readCsv } = await import("@/backend/import/readers/csv");

/** Shared rows point at a catalog id; a user's own rows point at their category id. */
const shared = (keyword: string, defaultCategoryId: string) => ({ keyword, categoryId: null, defaultCategoryId, transactionKind: null, userScoped: false });
const own = (keyword: string, categoryId: string) => ({ keyword, categoryId, defaultCategoryId: null, transactionKind: null, userScoped: true });

describe("category keyword matching", () => {
  const entries = [shared("indmoney", "cat-investments"), shared("indmoney credit card repayment", "cat-cc-bill"), shared("ola", "cat-transport"), shared("zomato", "cat-food")];

  it("prefers the longest shared keyword", () => {
    expect(matchCategory(["INDMONEY CREDIT CARD REPAYMENT"], entries)?.defaultCategoryId).toBe("cat-cc-bill");
    expect(matchCategory(["Indmoney"], entries)?.defaultCategoryId).toBe("cat-investments");
  });

  it("lets the user's own mapping win over a longer shared one", () => {
    expect(matchCategory(["INDMONEY CREDIT CARD REPAYMENT"], [...entries, own("indmoney", "my-shopping")])?.categoryId).toBe("my-shopping");
  });

  it("matches whole words only, across merchant, narration and UPI handle", () => {
    expect(matchCategory(["Coca Cola"], entries)).toBeNull();
    expect(matchCategory([null, "UPI/412345678901/ZOMATO.ORDER@HDFCBANK"], entries)?.defaultCategoryId).toBe("cat-food");
    expect(keywordAppearsIn(["Apple Media Services"], "apple media")).toBe(true);
  });

  it("resolves to the user's own category, or their copy of the catalog one", () => {
    const categories = [
      { id: "my-food", default_category_id: "cat-food" },
      { id: "my-shopping", default_category_id: null },
    ];
    expect(resolveCategory(shared("zomato", "cat-food"), categories)?.id).toBe("my-food");
    expect(resolveCategory(own("indmoney", "my-shopping"), categories)?.id).toBe("my-shopping");
    // The user deleted their copy of the catalog category: no match, so the next step decides.
    expect(resolveCategory(shared("ola", "cat-transport"), categories)).toBeNull();
    expect(resolveCategory(own("x", "deleted"), categories)).toBeNull();
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

  it("reads a PDF chunk end to end, keeping real rows and dropping invented ones", async () => {
    const lines = readFileSync(join(process.cwd(), "tests/fixtures/synthetic/phonepe.lines.txt"), "utf8").split("\n").filter(Boolean);
    runLlmTask.mockReset().mockResolvedValueOnce({
      source: { sourceKind: "upi_app", sourceApp: "phonepe" },
      rows: [
        { date: "Oct 05, 2024", time: "10:32 am", description: "Paid to Swiggy", counterparty: "Swiggy", amount: "₹350", direction: "debit", reference: "427912345678" },
        { date: "Oct 06, 2024", time: "08:05 pm", description: "Received from Rahul Sharma", counterparty: "Rahul Sharma", amount: "₹500", direction: "credit", reference: "427998765432" },
        { date: "Oct 07, 2024", description: "Paid to Amazon", amount: "₹999", direction: "debit" },
      ],
    });
    const out = await readPdfChunkWithLlm("user-1", lines, true);
    expect(out.source).toEqual({ sourceKind: "upi_app", sourceApp: "phonepe" });
    expect(out.dropped).toBe(1);
    expect(out.events.map((e) => [e.direction, e.amountMinor, e.referenceId])).toEqual([
      ["debit", 35000, "427912345678"],
      ["credit", 50000, "427998765432"],
    ]);
    expect(out.events[0].occurredAt).toBe("2024-10-05T05:02:00.000Z");
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

  it("rejects a mapping that parses but puts the amount in the reference column", async () => {
    const amountAsReference = { ...good, columns: { ...good.columns, reference: 4 } };
    runLlmTask.mockResolvedValueOnce(amountAsReference).mockResolvedValueOnce(good);
    const out = await mapColumnsWithLlm("user-1", "statement.csv", read);
    expect(runLlmTask).toHaveBeenCalledTimes(2);
    expect(runLlmTask.mock.calls[1][0].data).toMatch(/column 4 was used for reference and debit/);
    expect(out.config.table.columns.reference).toEqual(["chq ref no"]);
  });

  it("rejects a reference column that holds money even when no column is reused", async () => {
    const balanceAsReference = { ...good, columns: { date: 0, narration: 1, reference: 6 } };
    runLlmTask.mockResolvedValue(balanceAsReference);
    await expect(mapColumnsWithLlm("user-1", "statement.csv", read)).rejects.toThrow(/couldn't work out/);
    expect(runLlmTask.mock.calls[1][0].data).toMatch(/reference column holds amounts/);
  });

  it("gives up after two mappings that don't parse", async () => {
    runLlmTask.mockResolvedValue(wrongDates);
    await expect(mapColumnsWithLlm("user-1", "statement.csv", read)).rejects.toThrow(/couldn't work out this file's columns/);
  });
});
