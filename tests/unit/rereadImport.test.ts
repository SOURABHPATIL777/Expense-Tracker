import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { ParsedEvent } from "@/backend/import/types";

const imports = { findById: vi.fn() };
const rawEvents = { listAll: vi.fn(), saveOutcomes: vi.fn() };
const transactions = { listAll: vi.fn(), enrich: vi.fn() };
const storage = { remove: vi.fn(), download: vi.fn() };

const returning = (instance: object) =>
  class {
    constructor() {
      return instance;
    }
  };

vi.mock("@/backend/repositories/imports.repository", () => ({ ImportsRepository: returning(imports) }));
vi.mock("@/backend/repositories/rawEvents.repository", () => ({ RawEventsRepository: returning(rawEvents) }));
vi.mock("@/backend/repositories/transactions.repository", () => ({ TransactionsRepository: returning(transactions), TransactionSourcesRepository: returning({}) }));
vi.mock("@/backend/repositories/reviewItems.repository", () => ({ ReviewItemsRepository: returning({}) }));
vi.mock("@/backend/repositories/accounts.repository", () => ({ AccountsRepository: returning({}) }));
vi.mock("@/backend/repositories/uploadedFiles.repository", () => ({ UploadedFilesRepository: returning({}) }));
vi.mock("@/backend/repositories/importLayouts.repository", () => ({ ImportLayoutsRepository: returning({ parsers: async () => [], save: async () => ({ id: "layout-1" }) }) }));
vi.mock("@/backend/services/storage", () => ({ statementStorage: storage }));

const { importPipeline } = await import("@/backend/services/importPipeline.service");
const pipeline = importPipeline({} as never, { info: vi.fn(), warn: vi.fn() } as never);

const event = (over: Partial<ParsedEvent>): ParsedEvent => ({
  occurredAt: "2026-10-18T05:00:00.000Z",
  amountMinor: 970,
  direction: "debit",
  status: "success",
  counterpartyName: null,
  counterpartyVpa: "bdpg2.indianrailways@sbi",
  narration: "Paid to Indian Railways UTS",
  referenceId: "629112345678",
  appTransactionId: null,
  balanceMinor: null,
  note: null,
  ...over,
});

const raw = (rowIndex: number, parsed: ParsedEvent, over: Record<string, unknown> = {}) => ({
  id: `raw-${rowIndex}`,
  user_id: "u",
  import_id: "imp-1",
  row_index: rowIndex,
  raw: {},
  parsed,
  fingerprint: `fp-${rowIndex}`,
  status: "accepted",
  error: null,
  transaction_id: `tx-${rowIndex}`,
  created_at: "",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  imports.findById.mockResolvedValue({ id: "imp-1", user_id: "u", status: "completed", source_app: "paytm", file_path: "u/imp-1/s.xlsx" });
});

describe("rereadImport (from stored rows)", () => {
  it("gives Paytm transactions their payee from 'Paid to …' instead of the UPI handle", async () => {
    rawEvents.listAll.mockResolvedValue([raw(0, event({}))]);
    transactions.listAll.mockResolvedValue([
      { id: "tx-0", merchant_raw: "Paid to Indian Railways UTS", merchant_normalized: "Bdpg2", narration: "Paid to Indian Railways UTS", counterparty_vpa: "bdpg2.indianrailways@sbi", reference_id: "629112345678" },
    ]);
    const out = await pipeline.rereadImport("u", "imp-1", { fromFile: false });
    expect(out).toEqual({ changed: 1, mismatched: 0 });
    expect(transactions.enrich).toHaveBeenCalledWith("u", "tx-0", { merchant_raw: "Indian Railways UTS", merchant_normalized: "Indian Railways Uts" });
    expect(rawEvents.saveOutcomes.mock.calls[0][1][0].parsed.counterpartyName).toBe("Indian Railways UTS");
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("keeps a name another statement put there (a linked app's payee) and skips linked rows", async () => {
    rawEvents.listAll.mockResolvedValue([raw(0, event({})), raw(1, event({ amountMinor: 5000 }), { status: "linked", transaction_id: "tx-other" })]);
    transactions.listAll.mockResolvedValue([
      { id: "tx-0", merchant_raw: "Paid to Indian Railways UTS", merchant_normalized: "IRCTC UTS", narration: "Paid to Indian Railways UTS", counterparty_vpa: "x@sbi", reference_id: "1" },
    ]);
    await pipeline.rereadImport("u", "imp-1", { fromFile: false });
    expect(transactions.listAll).toHaveBeenCalledTimes(1);
    expect(transactions.enrich).toHaveBeenCalledWith("u", "tx-0", { merchant_raw: "Indian Railways UTS" });
  });

  it("leaves imports that aren't completed alone", async () => {
    imports.findById.mockResolvedValue({ id: "imp-1", status: "processing" });
    expect(await pipeline.rereadImport("u", "imp-1", { fromFile: false })).toBeNull();
    expect(rawEvents.listAll).not.toHaveBeenCalled();
  });
});

describe("rereadImport (statement uploaded again)", () => {
  const csv = Buffer.from(
    [
      "Date,Narration,Withdrawal Amt.,Deposit Amt.,Closing Balance",
      "05/10/2026,NEFT/IN42627353946068/JIGSAW FINANCIAL TECHNOLOGY/ICICI BANK LIMITED/Salary Sept 2026,,78015.00,90000.00",
      "06/10/2026,UPI/P2M/570648042760/URBAN TADKA /UPI/Kotak Mahindra Bank,81.00,,89919.00",
      "07/10/2026,UPI/P2M/570648042761/CHAI POINT /UPI/HDFC BANK LTD,20.00,,89899.00",
    ].join("\n"),
  );

  it("reads the file, updates rows that still line up, skips the rest and removes the copy", async () => {
    imports.findById.mockResolvedValue({
      id: "imp-1", user_id: "u", status: "completed", source_app: "axis", file_name: "axis.csv", file_path: "u/imp-1/axis.csv",
      file_sha256: createHash("sha256").update(csv).digest("hex"),
    });
    storage.download.mockResolvedValue(csv);
    const salary = event({ occurredAt: "2026-10-04T18:30:00.000Z", amountMinor: 7801500, direction: "credit", counterpartyVpa: null, narration: "TECHNOLOGY/ICICI BANK LIMITED/Salary Sept 2026" });
    rawEvents.listAll.mockResolvedValue([
      raw(1, salary),
      raw(2, event({ occurredAt: "2026-10-05T18:30:00.000Z", amountMinor: 9999, counterpartyVpa: null })),
    ]);
    transactions.listAll.mockResolvedValue([
      { id: "tx-1", merchant_raw: salary.narration, merchant_normalized: null, narration: salary.narration, counterparty_vpa: null, reference_id: "629112345678" },
    ]);
    const out = await pipeline.rereadImport("u", "imp-1", { fromFile: true });
    expect(out).toEqual({ changed: 1, mismatched: 1 });
    expect(transactions.enrich).toHaveBeenCalledWith("u", "tx-1", {
      merchant_raw: "JIGSAW FINANCIAL TECHNOLOGY",
      merchant_normalized: "Jigsaw Financial Technology",
      narration: "NEFT/IN42627353946068/JIGSAW FINANCIAL TECHNOLOGY/ICICI BANK LIMITED/Salary Sept 2026",
    });
    expect(storage.remove).toHaveBeenCalledWith("u/imp-1/axis.csv");
  });
});

