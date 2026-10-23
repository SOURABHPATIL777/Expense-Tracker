import { describe, expect, it } from "vitest";
import { parseTransferNarration, payeeFromText } from "@/backend/domain/upiParse";
import { counterpartyFrom } from "@/backend/import/engine";
import { displayMerchant } from "@/backend/domain/merchant";
import { isBankKeyword, keywordAppearsIn, matchCategory, withoutBankNames, type MapEntry } from "@/backend/domain/categoryMap";
import { matchTexts, nameTexts } from "@/backend/services/classification.service";

describe("parseTransferNarration", () => {
  it.each([
    ["NEFT/IN42627353946068/JIGSAW FINANCIAL TECHNOLOGY/ICICI BANK LIMITED/Salary Sept 2026", "JIGSAW FINANCIAL TECHNOLOGY"],
    ["NEFT/DEUTH00531119796/TATA AIG GENERALINSURANCE CO/DEUTSCHE BANK/BE-25-11-014967 5649493", "TATA AIG GENERALINSURANCE CO"],
    ["NEFT CR- HDFCN52025081108659761 - YELLOW WINDOWS COMMUNICATIONS LLP - HDFC0000001 -0001-INVESTMENT", "YELLOW WINDOWS COMMUNICATIONS LLP"],
    ["RTGS CR- IDFBR52025081200350484 -MR PRAMOD CHIMMANLAL GUPTA - IDFB0041441 -/ATTN/", "MR PRAMOD CHIMMANLAL GUPTA"],
    ["NEFT-ZEPTO PRIVATE LIMITE- CMS2742541845650", "ZEPTO PRIVATE LIMITE"],
    ["IMPS/P2A/624614497257/Mr.SourabhPatil/X030 278/IDFCBank/", "Mr.SourabhPatil"],
  ])("%s", (narration, name) => {
    expect(parseTransferNarration(narration).name).toBe(name);
  });

  it("ignores other narrations", () => {
    expect(parseTransferNarration("UPI/P2M/637819019361/ongomartcom /ongoma/AIRTEL PAYMENTS BANK").name).toBeNull();
    expect(parseTransferNarration(null).name).toBeNull();
  });
});

describe("payee names", () => {
  it.each([
    ["Paid to Indian Railways UTS", "debit", "Indian Railways UTS"],
    ["Money sent to Arshad Yusuf Shaikh", "debit", "Arshad Yusuf Shaikh"],
    ["Received from MS SANGEETA KUMARI", "credit", "MS SANGEETA KUMARI"],
    ["Paid ₹350.00 to Swiggy using UPI", "debit", "Swiggy"],
    ["Paid to Idfc First Savings Account Note: rent", "debit", "Idfc First Savings Account"],
  ] as const)("%s", (text, direction, name) => {
    expect(payeeFromText(text, direction)).toBe(name);
  });

  it("comes from the narration when there's no payee column (Paytm 'Transaction Details')", () => {
    const name = counterpartyFrom(null, "Paid to Indian Railways UTS", "debit");
    expect(displayMerchant(name, "bdpg2.indianrailways@sbi")).toBe("Indian Railways Uts");
  });

  it("strips 'Paid to' from a payee column, keeps a plain one", () => {
    expect(counterpartyFrom("Paid to Swiggy", null, "debit")).toBe("Swiggy");
    expect(counterpartyFrom("Zomato", "UPI/P2M/1/ZOMATO LTD/UPI", "debit")).toBe("Zomato");
  });

  it("reads bank UPI and NEFT narrations", () => {
    expect(counterpartyFrom(null, "UPI/P2A/529692371916/SOURABH PATIL /UPI/CANARA BANK", "debit")).toBe("SOURABH PATIL");
    expect(counterpartyFrom(null, "NEFT/IN42627353946068/JIGSAW FINANCIAL TECHNOLOGY/ICICI BANK LIMITED/Salary Sept 2026", "credit")).toBe("JIGSAW FINANCIAL TECHNOLOGY");
  });
});

describe("bank names never decide a category", () => {
  const sbi: MapEntry = { keyword: "state bank of india", categoryId: null, defaultCategoryId: "transfers", transactionKind: "self_transfer", userScoped: false };
  const grape = {
    merchant_normalized: "Basaveshwara Grape Pr",
    merchant_raw: "BASAVESHWARA GRAPE PR",
    narration: "UPI/P2M/637530503734/BASAVESHWARA GRAPE PR/dry gr/State Bank Of India",
    counterparty_vpa: null,
  };

  it("removes the payee's bank from narrations", () => {
    expect(withoutBankNames(grape.narration)).toBe("upi p2m 637530503734 basaveshwara grape pr dry gr");
    expect(withoutBankNames("UPI/P2M/1/FUND IDFC FIRST ACCOU/UPI/IDFC FIRST BANK LTD")).not.toMatch(/bank/);
    expect(matchCategory(matchTexts(grape), [sbi])).toBeNull();
  });

  it("keeps the rest of a narration matchable", () => {
    const card: MapEntry = { keyword: "credit card", categoryId: null, defaultCategoryId: "bills", transactionKind: "cc_bill_payment", userScoped: false };
    const t = { ...grape, merchant_normalized: null, merchant_raw: null, narration: "Bill Payment of ICICI Bank Credit Card XXXX 2000" };
    expect(matchCategory(matchTexts(t), [card])).toBe(card);
  });

  it("never learns a bank as a keyword", () => {
    expect(isBankKeyword("state bank of india")).toBe(true);
    expect(isBankKeyword("canara bank")).toBe(true);
    expect(isBankKeyword("kotak mahindra")).toBe(true);
    expect(isBankKeyword("swiggy")).toBe(false);
  });

  it("learns keywords only from who was paid, not the narration fallback", () => {
    const salary = { merchant_normalized: null, merchant_raw: "TECHNOLOGY/ICICI BANK LIMITED/Salary June 2026", narration: "TECHNOLOGY/ICICI BANK LIMITED/Salary June 2026", counterparty_vpa: null };
    expect(keywordAppearsIn(nameTexts(salary), "salary")).toBe(false);
    expect(keywordAppearsIn(nameTexts(grape), "basaveshwara grape")).toBe(true);
  });
});
