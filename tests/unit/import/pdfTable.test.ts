import { describe, expect, it } from "vitest";
import { buildPdfTable, type PdfItem } from "@/backend/import/pdfTable";
import { splitSections } from "@/backend/import/sections";
import { configFromMapping, mappingSchema } from "@/backend/import/mapping";
import { extract } from "@/backend/import/engine";

/** A text item at (x, y); width ≈ 5 units per character, like a 9pt font. */
const at = (str: string, x: number, y: number, w = str.length * 5): PdfItem => ({ str, x, y, w });

// Axis-style: description above and on the date line, amounts on the date line.
const axisHeader = [at("Tran Date", 40, 600, 40), at("Chq No", 92, 600, 30), at("Particulars", 203, 600, 43), at("Debit", 339, 600, 21), at("Credit", 400, 600, 25), at("Balance", 473, 600, 31)];
const axisRecords = [
  at("OPENING BALANCE", 132, 592, 80), at("12350.00", 502, 592, 30),
  at("UPI/P2M/427912345678", 132, 572, 100),
  at("05-10-2024", 39, 563, 42), at("SWIGGY", 132, 563, 30), at("350.00", 354, 563, 25), at("12000.00", 502, 563, 30),
  at("UPI/P2A/427998765432", 132, 541, 100),
  at("06-10-2024", 39, 532, 42), at("RAHUL", 132, 532, 25), at("500.00", 405, 532, 20), at("12500.00", 502, 532, 30),
  at("NEFT CR-SALARY ACME", 132, 510, 100),
  at("07-10-2024", 39, 501, 42), at("TECH PVT LTD", 132, 501, 60), at("85000.00", 400, 501, 30), at("97500.00", 502, 501, 30),
  at("Page 1 of 1", 250, 300, 50),
];

describe("buildPdfTable", () => {
  it("rebuilds Axis-style rows: description lines above the date join in reading order", () => {
    const table = buildPdfTable([[...axisHeader, ...axisRecords]])!;
    expect(table.rows[0]).toEqual(["Tran Date", "Chq No", "Particulars", "Debit", "Credit", "Balance"]);
    expect(table.rows.slice(1)).toEqual([
      ["05-10-2024", "", "UPI/P2M/427912345678 SWIGGY", "350.00", "", "12000.00"],
      ["06-10-2024", "", "UPI/P2A/427998765432 RAHUL", "", "500.00", "12500.00"],
      ["07-10-2024", "", "NEFT CR-SALARY ACME TECH PVT LTD", "", "85000.00", "97500.00"],
    ]);
  });

  it("keeps a 3-line Axis row whole when its date is on the last line (lines 9pt apart, rows 13pt)", () => {
    // The first NEFT line is nearer the row above (13pt) than its own date line (18pt): spacing decides.
    const page = [
      ...axisHeader,
      at("UPI/P2A/529692371916/SOURABH PATIL", 132, 554, 170),
      at("23-10-2025", 39, 545, 42), at("/UPI/CANARA BANK", 132, 545, 80), at("500.00", 354, 545, 25), at("7536.72", 502, 545, 30),
      at("NEFT/IN42627353946068/JIGSAW FINANCIAL", 132, 532, 190),
      at("TECHNOLOGY/ICICI BANK LIMITED/Salary", 132, 523, 180),
      at("30-09-2026", 39, 514, 42), at("Sept 2026", 132, 514, 45), at("78015.00", 408, 514, 30), at("85551.72", 497, 514, 35),
      at("UPI/P2M/570648042760/URBAN TADKA", 132, 501, 160),
      at("06-10-2026", 39, 492, 42), at("/UPI/Kotak Mahindra Bank", 132, 492, 110), at("81.00", 359, 492, 20), at("85470.72", 497, 492, 35),
    ];
    const rows = buildPdfTable([page])!.rows.slice(1);
    expect(rows.map((r) => r[2])).toEqual([
      "UPI/P2A/529692371916/SOURABH PATIL /UPI/CANARA BANK",
      "NEFT/IN42627353946068/JIGSAW FINANCIAL TECHNOLOGY/ICICI BANK LIMITED/Salary Sept 2026",
      "UPI/P2M/570648042760/URBAN TADKA /UPI/Kotak Mahindra Bank",
    ]);
  });

  it("puts a time under the date into its own column (Kotak-style)", () => {
    const header = [at("#", 62, 520, 4), at("TRANSACTION DATE", 75, 520, 67), at("VALUE DATE", 153, 520, 41), at("TRANSACTION DETAILS", 202, 520, 77), at("CHQ / REF NO.", 329, 520, 46), at("DEBIT/CREDIT(₹)", 407, 520, 54), at("BALANCE(₹)", 483, 520, 40)];
    const rec = (n: number, y: number, amount: string) => [
      at(String(n), 62, y, 4), at("01 Nov 2025", 75, y, 40), at("01 Nov 2025", 153, y, 38), at(`UPI/41234567890${n}/SHOP`, 202, y, 70), at(`42791234567${n}`, 329, y, 47), at(amount, 430, y, 31), at("12,000.00", 476, y, 47),
      at("10:32 am", 75, y - 9, 26),
    ];
    const table = buildPdfTable([[...header, ...rec(1, 500, "-350.00"), ...rec(2, 470, "+500.00"), ...rec(3, 440, "-99.00")]])!;
    expect(table.rows[0].at(-1)).toBe("Time");
    expect(table.rows[1]).toEqual(["1", "01 Nov 2025", "01 Nov 2025", "UPI/412345678901/SHOP", "427912345671", "-350.00", "12,000.00", "10:32 am"]);
  });

  it("attaches amounts printed on a record's last line to that record (AccStmt-style)", () => {
    const header = [at("Trans Date", 62, 466, 41), at("Value Date", 118, 466, 40), at("Description/Narration", 174, 466, 81), at("Chq./Ref.No.", 314, 466, 48), at("Debit(Dr.)", 385, 466, 36), at("Credit(Cr.)", 438, 466, 39), at("Balance", 487, 466, 46)];
    const page = [
      ...header,
      at("2026-04-01", 62, 449, 40), at("2026-04-01", 118, 449, 40), at("UPI IN-", 174, 449, 38), at("REF111", 314, 449, 48),
      at("RAHUL SHARMA", 174, 441, 60),
      at("dinner split", 174, 433, 55),
      at("-", 419, 425, 2), at("500.00", 437, 425, 40), at("9,000.00", 487, 425, 46),
      at("2026-04-02", 62, 415, 40), at("2026-04-02", 118, 415, 40), at("ATM WITHDRAWAL", 174, 415, 70), at("-", 316, 415, 2), at("2,000.00", 385, 415, 36), at("-", 475, 415, 2), at("7,000.00", 487, 415, 46),
      at("2026-04-03", 62, 405, 40), at("2026-04-03", 118, 405, 40), at("SALARY", 174, 405, 30), at("-", 316, 405, 2), at("-", 419, 405, 2), at("50,000.00", 437, 405, 40), at("57,000.00", 487, 405, 46),
    ];
    const rows = buildPdfTable([page])!.rows.slice(1);
    expect(rows[0]).toEqual(["2026-04-01", "2026-04-01", "UPI IN- RAHUL SHARMA dinner split", "REF111", "-", "500.00", "9,000.00"]);
    expect(rows[1][4]).toBe("2,000.00");
    expect(rows[2][5]).toBe("50,000.00");
  });

  it("reuses page 1's columns on later pages and skips repeated headers", () => {
    const page2 = [...axisHeader.map((i) => ({ ...i, y: 800 })), at("08-10-2024", 39, 780, 42), at("ZOMATO", 132, 780, 30), at("250.00", 354, 780, 25), at("97250.00", 502, 780, 30)];
    const page3 = [at("09-10-2024", 39, 780, 42), at("OLA", 132, 780, 15), at("120.00", 354, 780, 25), at("97130.00", 502, 780, 30)];
    const table = buildPdfTable([[...axisHeader, ...axisRecords], page2, page3])!;
    expect(table.rows.filter((r) => r[0] === "Tran Date")).toHaveLength(1);
    expect(table.rows.map((r) => r[0]).slice(-2)).toEqual(["08-10-2024", "09-10-2024"]);
    expect(splitSections(table)).toHaveLength(1);
  });

  it("is not a table without a header or with too few records", () => {
    expect(buildPdfTable([[at("Oct 05, 2024 Paid to Swiggy DEBIT ₹350", 40, 600)]])).toBeNull();
    expect(buildPdfTable([[...axisHeader, at("05-10-2024", 39, 563, 42), at("350.00", 354, 563, 25)]])).toBeNull();
  });

  it("feeds the normal table pipeline end to end", () => {
    const table = buildPdfTable([[...axisHeader, ...axisRecords]])!;
    const mapping = mappingSchema.parse({ headerRowIndex: 0, columns: { date: 0, narration: 2, balance: 5 }, amount: { mode: "split", debit: 3, credit: 4 }, dateFormat: "dd-MM-yyyy" });
    const config = configFromMapping(mapping, table.rows[0], { sourceKind: "bank", sourceApp: "axis", label: "Axis Bank statement (PDF)" });
    const parsed = extract(table, config).rows.map((r) => r.parsed && [r.parsed.direction, r.parsed.amountMinor]);
    expect(parsed).toEqual([["debit", 35000], ["credit", 50000], ["credit", 8500000]]);
  });
});
