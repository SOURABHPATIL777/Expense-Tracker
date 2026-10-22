import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { readXlsx } from "@/backend/import/readers/xlsx";
import { looksLikeTransactionRow } from "@/backend/import/text";

const workbook = (sheets: Record<string, string[][]>) => {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
};

const summary = [["Test User"], ["Statement period :", "01 Oct'24 - 31 Oct'24"], ["Money Paid (Amount in Rs.)", "-850.00"], ["Money Paid (No. of Payments)", "2"]];
const passbook = [
  ["Date", "Time", "Transaction Details", "Other Transaction Details (UPI ID or A/c No)", "Your Account", "Amount", "UPI Ref No."],
  ["05/10/2024", "10:32:11", "Paid to Swiggy", "swiggy@paytm", "HDFC Bank - 12", "-350.00", "427912345678"],
  ["06/10/2024", "20:05:00", "Received from Rahul Sharma", "rahul.s@okhdfcbank", "HDFC Bank - 12", "+500.00", "427998765432"],
];

describe("readXlsx", () => {
  it("reads the transactions sheet when a summary sheet comes first (Paytm)", () => {
    const read = readXlsx(workbook({ Summary: summary, "Passbook Payment History": passbook }));
    expect(read.rows[0][0]).toBe("Date");
    expect(read.rows).toHaveLength(3);
  });

  it("still reads a single-sheet workbook, and the first sheet when none looks like transactions", () => {
    expect(readXlsx(workbook({ Statement: passbook })).rows).toHaveLength(3);
    expect(readXlsx(workbook({ Summary: summary, Notes: [["hello"]] })).rows[0][0]).toBe("Test User");
  });
});

describe("looksLikeTransactionRow", () => {
  it.each([
    [["05/10/2024", "Paid to Swiggy", "-350.00"], true],
    [["05 Oct 2024", "UPI-SWIGGY", "350.00", "12,000.00"], true],
    [["Oct 05, 2024", "₹350"], true],
    [["Money Paid (Amount in Rs.)", "-850.00"], false],
    [["Statement period :", "01 Oct'24 - 31 Oct'24"], false],
    [["05/10/2024"], false],
  ])("%j → %s", (cells, expected) => {
    expect(looksLikeTransactionRow(cells)).toBe(expected);
  });
});
