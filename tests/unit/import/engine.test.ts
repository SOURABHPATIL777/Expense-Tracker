import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectConfig, extract, findHeaderRow } from "@/backend/import/engine";
import type { z } from "zod";
import { configFromMapping, mappingSchema } from "@/backend/import/mapping";
import { readCsv } from "@/backend/import/readers/csv";
import type { TableRead } from "@/backend/import/types";

const fixture = (name: string) => readFileSync(join(process.cwd(), "tests/fixtures/synthetic", name));

/** Builds the layout the LLM would learn for a file (what ends up in import_layouts). */
function learnedLayout(
  read: TableRead,
  headerText: string,
  mapping: Omit<z.input<typeof mappingSchema>, "headerRowIndex">,
  source: Parameters<typeof configFromMapping>[2],
) {
  const headerRowIndex = read.rows.findIndex((r) => r[0] === headerText);
  return configFromMapping(mappingSchema.parse({ ...mapping, headerRowIndex }), read.rows[headerRowIndex], source);
}

const hdfcRead = readCsv(fixture("hdfc.csv"));
const hdfc = learnedLayout(
  hdfcRead,
  "Date",
  { columns: { date: 0, narration: 1, balance: 6 }, amount: { mode: "split", debit: 4, credit: 5 }, dateFormat: "dd/MM/yy" },
  { sourceKind: "bank", sourceApp: "hdfc", label: "HDFC Bank statement (CSV/Excel)" },
);

const paytmRead = readCsv(fixture("paytm.csv"));
const paytm = learnedLayout(
  paytmRead,
  "Date",
  { columns: { date: 0, time: 1, narration: 2, vpa: 3, reference: 6, appTransactionId: 7, note: 10 }, amount: { mode: "signed", amount: 5 }, dateFormat: "dd/MM/yyyy" },
  { sourceKind: "upi_app", sourceApp: "paytm", label: "Paytm statement (CSV/Excel)" },
);

describe("HDFC CSV (split debit/credit columns)", () => {
  it("finds the header past the statement preamble", () => {
    expect(findHeaderRow(hdfcRead.rows, hdfc.table)).toBeGreaterThan(0);
  });

  it("extracts debits and credits, skipping footer rows", () => {
    const { rows, periodStart, periodEnd } = extract(hdfcRead, hdfc);
    expect(rows.map((r) => r.parsed?.direction)).toEqual(["debit", "credit", "credit"]);
    expect(rows.map((r) => r.parsed?.amountMinor)).toEqual([35000, 50000, 8500000]);
    expect(periodStart).toBe("2024-10-05");
    expect(periodEnd).toBe("2024-10-07");
  });

  it("pulls UTR, VPA and payee from the UPI narration", () => {
    const first = extract(hdfcRead, hdfc).rows[0].parsed!;
    expect(first.referenceId).toBe("427912345678");
    expect(first.counterpartyVpa).toBe("swiggy.stores@axisbank");
    expect(first.counterpartyName).toBe("SWIGGY");
    expect(first.balanceMinor).toBe(1200000);
    expect(first.occurredAt).toBe("2024-10-04T18:30:00.000Z"); // 5 Oct 00:00 IST
  });
});

describe("Paytm CSV (signed amounts, separate time column)", () => {
  it("uses the sign for direction and combines date + time", () => {
    const [paid, received] = extract(paytmRead, paytm).rows.map((r) => r.parsed!);
    expect(paid).toMatchObject({ direction: "debit", amountMinor: 35000, referenceId: "427912345678", counterpartyVpa: "swiggy@paytm" });
    expect(paid.occurredAt).toBe("2024-10-05T05:02:11.000Z");
    expect(received).toMatchObject({ direction: "credit", amountMinor: 50000, note: "dinner" });
  });
});

describe("detectConfig (stored layouts)", () => {
  it("recognises a file by a layout learned earlier", () => {
    expect(detectConfig(hdfcRead, [paytm, hdfc])?.sourceApp).toBe("hdfc");
    expect(detectConfig(paytmRead, [hdfc, paytm])?.sourceApp).toBe("paytm");
  });

  it("prefers the most specific header", () => {
    const loose = { ...hdfc, sourceApp: "other_bank" as const, table: { ...hdfc.table, headerMatch: hdfc.table.headerMatch.slice(0, 2) } };
    expect(detectConfig(hdfcRead, [loose, hdfc])?.sourceApp).toBe("hdfc");
  });

  it("matches nothing when no layout has been learned yet (the LLM works it out)", () => {
    expect(detectConfig(hdfcRead, [])).toBeNull();
    expect(detectConfig(hdfcRead, [paytm])).toBeNull();
  });
});
