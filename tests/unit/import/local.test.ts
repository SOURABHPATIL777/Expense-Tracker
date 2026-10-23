import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mapColumnsLocally, inferDateFormat } from "@/backend/import/headerMapping";
import { configFromMapping } from "@/backend/import/mapping";
import { proveMapping } from "@/backend/import/proveMapping";
import { extract } from "@/backend/import/engine";
import { balanceVerdict, directionsFromBalance } from "@/backend/import/balanceCheck";
import { parseTextRecords } from "@/backend/import/textRecords";
import { detectSource } from "@/backend/import/detectSource";
import { readCsv } from "@/backend/import/readers/csv";
import type { ExtractedRow, ParsedEvent, TableRead } from "@/backend/import/types";

const fixture = (name: string) => readFileSync(join(process.cwd(), "tests/fixtures/synthetic", name));
const source = { sourceKind: "bank" as const, sourceApp: "other_bank" as const, label: "Statement" };

/** Maps a table locally and proves it, like the pipeline does (no AI anywhere). */
function readLocally(read: TableRead) {
  const mapping = mapColumnsLocally(read);
  if (!mapping) return null;
  const config = configFromMapping(mapping, read.rows[mapping.headerRowIndex], source);
  const proof = proveMapping(read, config);
  return proof.ok ? { mapping, rows: extract(read, proof.config).rows } : null;
}

describe("mapColumnsLocally", () => {
  it("maps the HDFC CSV from its header names", () => {
    const out = readLocally(readCsv(fixture("hdfc.csv")))!;
    expect(out.mapping.amount).toEqual({ mode: "split", debit: 4, credit: 5 });
    expect(out.mapping.dateFormat).toBe("dd/MM/yy");
    expect(out.rows.map((r) => r.parsed && [r.parsed.direction, r.parsed.amountMinor, r.parsed.referenceId])).toEqual([
      ["debit", 35000, "427912345678"],
      ["credit", 50000, "427998765432"],
      ["credit", 8500000, "N280241234567"],
    ]);
  });

  it("maps the Paytm CSV: signed amounts, time, UPI ID and UPI Ref columns", () => {
    const out = readLocally(readCsv(fixture("paytm.csv")))!;
    expect(out.mapping.amount.mode).toBe("signed");
    expect(out.mapping.columns).toMatchObject({ time: 1, narration: 2, vpa: 3, reference: 6, appTransactionId: 7, note: 10 });
    expect(out.rows[0].parsed).toMatchObject({ direction: "debit", amountMinor: 35000, referenceId: "427912345678", counterpartyVpa: "swiggy@paytm" });
  });

  it.each([
    [["Tran Date", "Chq No", "Particulars", "Debit", "Credit", "Balance", "Init. Br"], ["05-10-2024", "", "UPI/SWIGGY", "350.00", "", "1000.00", "4002"], "split"],
    [["#", "TRANSACTION DATE", "VALUE DATE", "TRANSACTION DETAILS", "CHQ / REF NO.", "DEBIT/CREDIT(₹)", "BALANCE(₹)"], ["1", "01 Nov 2025", "01 Nov 2025", "UPI/SHOP", "427912345678", "-350.00", "1,000.00"], "signed"],
    [["Txn Date", "Description", "Amount", "Type", "Balance"], ["2026-04-01", "ATM", "2,000.00", "DR", "8,000.00"], "typed"],
  ])("maps %j", (header, row, mode) => {
    // A second row with the opposite type, so both type values are seen.
    const other = row.map((c) => (c === "DR" ? "CR" : c));
    const read: TableRead = { kind: "table", rows: [header, row, other] };
    expect(mapColumnsLocally(read)?.amount.mode).toBe(mode);
  });

  it("returns null when the header doesn't say which column is which", () => {
    expect(mapColumnsLocally({ kind: "table", rows: [["Col A", "Col B"], ["x", "1"]] })).toBeNull();
  });

  it("infers the date format from the values", () => {
    expect(inferDateFormat(["05-10-2024", "31-10-2024"])).toBe("dd-MM-yyyy");
    expect(inferDateFormat(["2026-04-01", "2026-04-30"])).toBe("yyyy-MM-dd");
    expect(inferDateFormat(["01 Nov 2025", "30 Nov 2025"])).toBe("dd MMM yyyy");
    expect(inferDateFormat(["05/10/24"])).toBe("dd/MM/yy");
  });
});

const ev = (direction: "debit" | "credit", amountMinor: number, balanceMinor: number) => ({ direction, amountMinor, balanceMinor });

describe("balance check", () => {
  const oldestFirst = [ev("credit", 100000, 100000), ev("debit", 35000, 65000), ev("credit", 50000, 115000), ev("debit", 15000, 100000)];

  it("reconciles statements in either order", () => {
    expect(balanceVerdict(oldestFirst)).toBe("ok");
    expect(balanceVerdict([...oldestFirst].reverse())).toBe("ok");
  });

  it("spots debit and credit mapped the wrong way round, and misaligned columns", () => {
    const swapped = oldestFirst.map((e) => ({ ...e, direction: e.direction === "debit" ? ("credit" as const) : ("debit" as const) }));
    expect(balanceVerdict(swapped)).toBe("swapped");
    expect(balanceVerdict(oldestFirst.map((e, i) => ({ ...e, amountMinor: 1000 * (i + 7) })))).toBe("mismatch");
  });

  it("says nothing with too few balances", () => {
    expect(balanceVerdict([ev("debit", 100, 900)])).toBe("unknown");
  });

  it("swaps a split mapping automatically when balances say so", () => {
    const read: TableRead = {
      kind: "table",
      rows: [["Date", "Narration", "Deposit", "Withdrawal", "Balance"], ["01/10/2024", "SALARY", "", "1,000.00", "1,000.00"], ["02/10/2024", "SWIGGY", "350.00", "", "650.00"], ["03/10/2024", "RAHUL", "", "500.00", "1,150.00"], ["04/10/2024", "OLA", "150.00", "", "1,000.00"]],
    };
    // Headers say Deposit then Withdrawal, but the amounts sit in the other columns.
    const mapping = { ...mapColumnsLocally(read)!, amount: { mode: "split" as const, debit: 3, credit: 2 } };
    const proof = proveMapping(read, configFromMapping(mapping, read.rows[0], source));
    expect(proof.ok).toBe(true);
    const rows = proof.ok ? extract(read, proof.config).rows.map((r) => r.parsed!.direction) : [];
    expect(rows).toEqual(["credit", "debit", "credit", "debit"]);
  });

  it("takes direction from balance changes for unsigned amounts", () => {
    const row = (amountMinor: number, balanceMinor: number): ExtractedRow => ({ rowIndex: 0, raw: "", error: null, parsed: { direction: "debit", amountMinor, balanceMinor } as ParsedEvent });
    const fixed = directionsFromBalance([row(100000, 100000), row(35000, 65000), row(50000, 115000)]);
    expect(fixed.map((r) => r.parsed?.direction ?? r.error)).toEqual(["Could not tell debit from credit", "debit", "credit"]);
  });
});

describe("parseTextRecords", () => {
  it("reads the PhonePe statement text with no AI", () => {
    const rows = parseTextRecords(fixture("phonepe.lines.txt").toString("utf8").split("\n"));
    expect(rows.map((r) => r.parsed && [r.parsed.direction, r.parsed.amountMinor, r.parsed.counterpartyName, r.parsed.referenceId, r.parsed.appTransactionId])).toEqual([
      ["debit", 35000, "Swiggy", "427912345678", "T2410051032123456789"],
      ["credit", 50000, "Rahul Sharma", "427998765432", "T2410062005987654321"],
    ]);
    expect(rows[0].parsed?.occurredAt).toBe("2024-10-05T05:02:00.000Z");
  });

  it("reads activity pages where the date follows each entry, and JSON lines", () => {
    const takeout = parseTextRecords(["Paid ₹350.00 to Swiggy using Bank Account XXXX1234", "Oct 5, 2024, 10:32:11 AM IST", "Received ₹500.00 from Rahul Sharma", "Oct 6, 2024, 8:05:00 PM IST"]);
    expect(takeout.map((r) => r.parsed && [r.parsed.direction, r.parsed.amountMinor, r.parsed.counterpartyName])).toEqual([["debit", 35000, "Swiggy"], ["credit", 50000, "Rahul Sharma"]]);
    const json = parseTextRecords(["time: 2024-10-05T05:02:11.000Z; title: Paid ₹350.00 to Swiggy", "time: 2024-10-06T14:35:00.000Z; title: Received ₹500.00 from Rahul"]);
    expect(json.map((r) => r.parsed?.occurredAt)).toEqual(["2024-10-05T05:02:11.000Z", "2024-10-06T14:35:00.000Z"]);
  });

  it("gives year-less dates (Paytm PDFs) the year from the statement period", () => {
    const lines = [
      "Passbook Payments History",
      "1 Nov'23 - 31 Oct'24 - Rs.9,999.00 + Rs.500",
      "05 Dec Paid to Swiggy Limited HDFC Bank - 12 - Rs.350",
      "9:41 PM",
      "UPI ID: swiggy@ybl",
      "UPI Ref No: 427912345678",
      "12 Feb Received from Rahul Sharma HDFC Bank - 12 + Rs.1,500.50",
      "10:05 AM",
      "UPI Ref No: 427998765432",
      "Page 1 of 1",
    ];
    const rows = parseTextRecords(lines).filter((r) => r.parsed);
    expect(rows.map((r) => [r.parsed!.occurredAt.slice(0, 10), r.parsed!.direction, r.parsed!.amountMinor, r.parsed!.counterpartyName, r.parsed!.referenceId])).toEqual([
      ["2023-12-05", "debit", 35000, "Swiggy Limited", "427912345678"],
      ["2024-02-12", "credit", 150050, "Rahul Sharma", "427998765432"],
    ]);
  });

  it("finds nothing on a page with no transactions", () => {
    expect(parseTextRecords(["Page 1 of 1", "This is a system generated statement."])).toEqual([]);
  });
});

describe("detectSource", () => {
  it("recognises the bank from an IFSC code or its name at the top, and apps by name", () => {
    expect(detectSource("statement.pdf", ["Account Statement", "IFSC: UTIB0000123 Branch: Pune"])).toEqual({ sourceKind: "bank", sourceApp: "axis" });
    expect(detectSource("statement.pdf", ["Kotak Mahindra Bank", "Savings account"])).toEqual({ sourceKind: "bank", sourceApp: "kotak" });
    expect(detectSource("Paytm_UPI_Statement.xlsx", [])).toEqual({ sourceKind: "upi_app", sourceApp: "paytm" });
    const phonepe = ["Transaction Statement for 98XXXXXX10", "Oct 05, 2024 Paid to Swiggy DEBIT ₹350.00", "This is a system generated statement. PhonePe Private Limited."];
    expect(detectSource("x.pdf", phonepe)).toBeNull();
    expect(detectSource("x.pdf", phonepe, "document")).toEqual({ sourceKind: "upi_app", sourceApp: "phonepe" });
  });

  it("ignores banks mentioned in narrations further down", () => {
    const lines = ["Account Statement", ...Array.from({ length: 30 }, () => "05/10/24 UPI-SWIGGY-SWIGGY@AXISBANK-UTIB0000000-427912345678 350.00")];
    expect(detectSource("statement.pdf", lines)).toBeNull();
  });
});
