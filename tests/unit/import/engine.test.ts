import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectConfig, extract } from "@/backend/import/engine";
import { readCsv } from "@/backend/import/readers/csv";
import { PRESETS } from "@/backend/import/presets";
import type { TextRead } from "@/backend/import/types";

const fixture = (name: string) => readFileSync(join(process.cwd(), "tests/fixtures/synthetic", name));
const lines = (name: string): TextRead => ({ kind: "text", lines: fixture(name).toString("utf8").split("\n").filter(Boolean) });

describe("HDFC CSV (table preset)", () => {
  const read = readCsv(fixture("hdfc.csv"));
  const config = detectConfig(read, "csv", [...PRESETS], "hdfc");

  it("detects the HDFC preset past the statement preamble", () => {
    expect(config?.id).toBe("bank.hdfc.table.v1");
  });

  it("extracts debits and credits, skipping footer rows", () => {
    const { rows, periodStart, periodEnd } = extract(read, config!);
    expect(rows.map((r) => r.parsed?.direction)).toEqual(["debit", "credit", "credit"]);
    expect(rows.map((r) => r.parsed?.amountMinor)).toEqual([35000, 50000, 8500000]);
    expect(periodStart).toBe("2024-10-05");
    expect(periodEnd).toBe("2024-10-07");
  });

  it("pulls UTR, VPA and payee from the UPI narration", () => {
    const first = extract(read, config!).rows[0].parsed!;
    expect(first.referenceId).toBe("427912345678");
    expect(first.counterpartyVpa).toBe("swiggy.stores@axisbank");
    expect(first.counterpartyName).toBe("SWIGGY");
    expect(first.balanceMinor).toBe(1200000);
    expect(first.occurredAt).toBe("2024-10-04T18:30:00.000Z"); // 5 Oct 00:00 IST
  });
});

describe("Paytm CSV (signed amounts, separate time column)", () => {
  const read = readCsv(fixture("paytm.csv"));
  const config = detectConfig(read, "csv", [...PRESETS]);

  it("detects Paytm without a hint", () => {
    expect(config?.id).toBe("upi.paytm.table.v1");
  });

  it("uses the sign for direction and combines date + time", () => {
    const [paid, received] = extract(read, config!).rows.map((r) => r.parsed!);
    expect(paid).toMatchObject({ direction: "debit", amountMinor: 35000, referenceId: "427912345678", counterpartyVpa: "swiggy@paytm" });
    expect(paid.occurredAt).toBe("2024-10-05T05:02:11.000Z");
    expect(received).toMatchObject({ direction: "credit", amountMinor: 50000, note: "dinner" });
  });
});

describe("PhonePe PDF (text preset)", () => {
  const read = lines("phonepe.lines.txt");
  const config = detectConfig(read, "pdf_text", [...PRESETS], "phonepe");

  it("detects PhonePe", () => {
    expect(config?.id).toBe("upi.phonepe.pdf.v1");
  });

  it("splits records at date lines and reads every field", () => {
    const rows = extract(read, config!).rows;
    expect(rows).toHaveLength(2);
    expect(rows[0].parsed).toMatchObject({
      direction: "debit",
      amountMinor: 35000,
      counterpartyName: "Swiggy",
      referenceId: "427912345678",
      appTransactionId: "T2410051032123456789",
      occurredAt: "2024-10-05T05:02:00.000Z",
    });
    expect(rows[1].parsed).toMatchObject({ direction: "credit", amountMinor: 50000, counterpartyName: "Rahul Sharma" });
  });
});

describe("Bank PDF (balance-delta direction)", () => {
  const read = lines("sbi.pdf.lines.txt");
  const config = detectConfig(read, "pdf_text", [...PRESETS], "sbi");

  it("detects SBI's PDF preset over the generic fallback", () => {
    expect(config?.id).toBe("bank.sbi.pdf.v1");
  });

  it("derives direction from balance changes, with keywords for the first row", () => {
    const rows = extract(read, config!).rows.map((r) => r.parsed!);
    expect(rows.map((r) => [r.direction, r.amountMinor])).toEqual([
      ["debit", 35000],
      ["credit", 50000],
      ["debit", 200000],
    ]);
    expect(rows[1].referenceId).toBe("427998765432");
  });

  it("falls back to the generic PDF parser for unknown banks", () => {
    const unknown: TextRead = { kind: "text", lines: read.lines.filter((l) => !/State Bank/i.test(l)) };
    expect(detectConfig(unknown, "pdf_text", [...PRESETS])?.id).toBe("generic.pdf.v1");
  });
});
