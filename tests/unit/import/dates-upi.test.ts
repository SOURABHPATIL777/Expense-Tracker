import { describe, expect, it } from "vitest";
import { istDate, parseStatementDate } from "@/backend/import/dates";
import { parseUpiNarration } from "@/backend/domain/upiParse";
import { displayMerchant, merchantKey } from "@/backend/domain/merchant";

describe("parseStatementDate (IST)", () => {
  it.each([
    ["05/10/24", ["dd/MM/yy"], null, "2024-10-04T18:30:00.000Z"],
    ["5 Oct 2024", ["d MMM yyyy"], null, "2024-10-04T18:30:00.000Z"],
    ["Oct 05, 2024", ["MMM dd, yyyy"], "10:32 am", "2024-10-05T05:02:00.000Z"],
    ["05-10-2024 23:59:59", ["dd-MM-yyyy HH:mm:ss"], null, "2024-10-05T18:29:59.000Z"],
    ["2024-10-05 10:00:00", [], null, "2024-10-05T04:30:00.000Z"],
    ["2024-10-05T05:02:11.000Z", [], null, "2024-10-05T05:02:11.000Z"],
  ])("%s", (date, formats, time, expected) => {
    expect(parseStatementDate(date, formats, time)).toBe(expected);
  });

  it.each([["31/02/2024"], ["13/13/2024"], ["Opening Balance"], [""]])("rejects %s", (date) => {
    expect(parseStatementDate(date, ["dd/MM/yyyy"])).toBeNull();
  });

  it("reports the IST calendar day", () => {
    expect(istDate("2024-10-04T18:30:00.000Z")).toBe("2024-10-05");
  });
});

describe("parseUpiNarration", () => {
  it.each([
    ["TO TRANSFER-UPI/DR/427912345678/SWIGGY LIMITED/YESB/swiggy@ybl/UPI", "427912345678", "swiggy@ybl", "SWIGGY LIMITED"],
    ["UPI-SWIGGY-SWIGGY.STORES@AXISBANK-UTIB0000000-427912345678-PAYMENT", "427912345678", "swiggy.stores@axisbank", "SWIGGY"],
    ["UPI/427912345678/Payment from Ph/rahul@ybl/HDFC BANK LTD", "427912345678", "rahul@ybl", null],
  ])("%s", (narration, utr, vpa, name) => {
    const r = parseUpiNarration(narration);
    expect(r).toMatchObject({ isUpi: true, utr, vpa });
    if (name) expect(r.name).toBe(name);
  });

  it("ignores non-UPI narrations", () => {
    expect(parseUpiNarration("NEFT CR-SALARY ACME").isUpi).toBe(false);
  });
});

describe("merchant normalisation", () => {
  it("cleans display names and builds stable keys", () => {
    expect(displayMerchant("SWIGGY LIMITED", null)).toBe("Swiggy");
    expect(displayMerchant(null, "zomato.order@hdfcbank")).toBe("Zomato");
    expect(displayMerchant(null, "9876543210@ybl")).toBeNull();
    expect(merchantKey("SWIGGY LTD", null)).toBe(merchantKey("Swiggy", null));
    expect(merchantKey("Swiggy", "Swiggy@YBL")).toBe("vpa:swiggy@ybl");
  });
});
