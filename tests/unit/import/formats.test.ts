import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { splitSections } from "@/backend/import/sections";
import { readXlsx } from "@/backend/import/readers/xlsx";
import { readHtml, htmlToLines } from "@/backend/import/readers/html";
import { readJson } from "@/backend/import/readers/json";
import { detectFormat } from "@/backend/import/readers";
import { assertLooksLikeStatement } from "@/backend/import/statementCheck";
import { mapLimit } from "@/backend/llm/concurrency";
import type { TableRead } from "@/backend/import/types";

const header = ["Date", "Narration", "Withdrawal Amt.", "Deposit Amt.", "Closing Balance"];
const tx = (d: string, n: string, w: string, c: string) => [d, n, w, c, "1,000.00"];
const table = (rows: string[][]): TableRead => ({ kind: "table", rows });

describe("splitSections", () => {
  it("splits on different headers, continues across repeated ones, and keeps original row numbers", () => {
    const cardHeader = ["Txn Date", "Description", "Amount", "Dr/Cr"];
    const sections = splitSections(
      table([
        ["Account summary"],
        header,
        tx("05/10/24", "SWIGGY", "350.00", ""),
        header, // page break: same header again
        tx("06/10/24", "SALARY", "", "85,000.00"),
        cardHeader,
        ["07/10/24", "AMAZON", "1,299.00", "Dr"],
      ]),
    );
    expect(sections).toHaveLength(2);
    expect(sections[0].read.rows.map((r) => r[1])).toEqual(["Narration", "SWIGGY", "SALARY"]);
    expect(sections[0].rowIndexes).toEqual([1, 2, 4]);
    expect(sections[1].read.rows[1][1]).toBe("AMAZON");
    expect(sections[1].rowIndexes).toEqual([5, 6]);
  });

  it("treats a table without a recognisable header as one section", () => {
    const rows = [["foo", "bar"], ["05/10/2024", "350.00"], ["06/10/2024", "500.00"]];
    expect(splitSections(table(rows))).toEqual([{ read: table(rows), rowIndexes: [0, 1, 2], signature: "" }]);
  });
});

describe("Excel: every sheet with transactions", () => {
  it("reads the Oct and Nov sheets and skips the summary", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Summary"], ["Total paid", "-1,649.00"]]), "Summary");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, tx("05/10/24", "SWIGGY", "350.00", "")]), "Oct");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, tx("05/11/24", "ZOMATO", "299.00", "")]), "Nov");
    const read = readXlsx(Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" })));
    const sections = splitSections(read);
    expect(sections).toHaveLength(1);
    expect(sections[0].read.rows.map((r) => r[1])).toEqual(["Narration", "SWIGGY", "ZOMATO"]);
  });
});

describe("HTML", () => {
  it("reads a bank statement table", () => {
    const html = `<html><body><h1>Statement</h1><table><tr>${header.map((h) => `<th>${h}</th>`).join("")}</tr>
      <tr><td>05/10/24</td><td>SWIGGY &amp; CO</td><td>350.00</td><td></td><td>1,000.00</td></tr>
      <tr><td>06/10/24</td><td>SALARY</td><td></td><td>85,000.00</td><td>86,000.00</td></tr></table></body></html>`;
    const read = readHtml(Buffer.from(html));
    expect(read.kind).toBe("table");
    expect(read.kind === "table" && read.rows.some((r) => r.includes("SWIGGY & CO"))).toBe(true);
  });

  it("turns an activity page without tables into text lines", () => {
    const html = `<html><head><style>.x{}</style></head><body><div class="entry"><div>Paid &#8377;350.00 to Swiggy</div><div>Oct 5, 2024, 10:32:11 AM IST</div></div><script>var a=1</script></body></html>`;
    expect(htmlToLines(html)).toEqual(["Paid ₹350.00 to Swiggy", "Oct 5, 2024, 10:32:11 AM IST"]);
    expect(readHtml(Buffer.from(html)).kind).toBe("text");
  });
});

describe("JSON", () => {
  it("flattens the largest list of records into a table and text lines", () => {
    const doc = { meta: { v: 1 }, data: { items: [
      { time: "2024-10-05T05:02:11.000Z", title: "Paid ₹350.00 to Swiggy", details: [{ name: "UPI" }] },
      { time: "2024-10-06T14:35:00.000Z", title: "Received ₹500.00 from Rahul", details: [{ name: "UPI" }] },
    ] } };
    const read = readJson(Buffer.from(JSON.stringify(doc)));
    expect(read.table?.rows[0]).toEqual(["time", "title", "details"]);
    expect(read.table?.rows[1]).toEqual(["2024-10-05T05:02:11.000Z", "Paid ₹350.00 to Swiggy", "UPI"]);
    expect(read.lines[1]).toBe("time: 2024-10-06T14:35:00.000Z; title: Received ₹500.00 from Rahul; details: UPI");
  });

  it("rejects broken JSON", () => {
    expect(() => readJson(Buffer.from("{not json"))).toThrow(/couldn't be read/);
  });
});

describe("detectFormat", () => {
  it("sniffs JSON and HTML whatever the extension", () => {
    expect(detectFormat("export.txt", Buffer.from('  [{"a":1}]'))).toBe("json");
    expect(detectFormat("statement.csv", Buffer.from("<!DOCTYPE html><html></html>"))).toBe("html");
    expect(detectFormat("statement.csv", Buffer.from("Date,Amount\n05/10/2024,350.00"))).toBe("csv");
  });
});

describe("statement check", () => {
  it("turns away files without dated amounts before any AI call", () => {
    expect(() => assertLooksLikeStatement(table([["Product", "Price"], ["Shirt", "999.00"], ["Shoes", "2,499.00"]]))).toThrow(/doesn't look like a bank or UPI statement/);
    expect(() => assertLooksLikeStatement({ kind: "text", lines: ["Dear Sir,", "Please find my resume attached."] })).toThrow(/doesn't look like/);
  });

  it("accepts tables and text with dates and amounts, even on separate lines", () => {
    expect(() => assertLooksLikeStatement(table([header, tx("05/10/24", "SWIGGY", "350.00", ""), tx("06/10/24", "OLA", "120.00", "")]))).not.toThrow();
    expect(() => assertLooksLikeStatement({ kind: "text", lines: ["Paid ₹350.00 to Swiggy", "Oct 5, 2024", "Paid ₹120.00 to Ola", "Oct 6, 2024"] })).not.toThrow();
  });
});

describe("mapLimit", () => {
  it("keeps order and never runs more than the limit at once", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([30, 10, 20, 5, 15], 2, async (ms, i) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, ms));
      running--;
      return i;
    });
    expect(out).toEqual([0, 1, 2, 3, 4]);
    expect(peak).toBe(2);
  });

  it("rejects with the first error", async () => {
    await expect(mapLimit([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("boom");
      return n;
    })).rejects.toThrow("boom");
  });
});
