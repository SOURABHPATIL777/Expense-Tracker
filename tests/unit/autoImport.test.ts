import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runLlmTask = vi.fn();
vi.mock("@/backend/llm/run", async (original) => ({ ...(await original<typeof import("@/backend/llm/run")>()), runLlmTask }));

const { matchCategory, normalizeKeyword, keywordAppearsIn, resolveCategory } = await import("@/backend/domain/categoryMap");
const { looksLikeIndividual } = await import("@/backend/domain/individual");
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

describe("mapColumnsWithLlm", () => {
  const read = readCsv(readFileSync(join(process.cwd(), "tests/fixtures/synthetic/hdfc.csv")));
  const good = {
    // The model sees only the header and 5 rows, and counts from the header.
    headerRowIndex: 0,
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

  it("sends the model only the header and at most 5 rows, never the document's other lines", async () => {
    runLlmTask.mockResolvedValueOnce(good);
    await mapColumnsWithLlm("user-1", "statement.csv", read);
    const payload = JSON.parse(runLlmTask.mock.calls[0][0].data) as { rows: Array<{ cells: string[] }>; documentStart?: unknown };
    expect(payload.rows[0].cells[0]).toBe("Date");
    expect(payload.rows.length).toBeLessThanOrEqual(6);
    expect(payload.documentStart).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain("Statement of account");
  });

  it("gives up after two mappings that don't parse", async () => {
    runLlmTask.mockResolvedValue(wrongDates);
    await expect(mapColumnsWithLlm("user-1", "statement.csv", read)).rejects.toThrow(/couldn't work out this file's columns/);
  });
});
