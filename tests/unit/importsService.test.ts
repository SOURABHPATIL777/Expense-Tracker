import { beforeEach, describe, expect, it, vi } from "vitest";

const repo = { findBySha: vi.fn(), findById: vi.fn(), insert: vi.fn(), update: vi.fn(), deleteCascade: vi.fn() };
const storage = { remove: vi.fn(), createUploadUrl: vi.fn(async () => "https://upload.example/put") };
const files = { setStatus: vi.fn() };
const audit = vi.fn();

/** A class whose instances are the given mock object. */
const returning = (instance: object) =>
  class {
    constructor() {
      return instance;
    }
  };

vi.mock("@/backend/repositories/imports.repository", () => ({ ImportsRepository: returning(repo) }));
vi.mock("@/backend/repositories/rawEvents.repository", () => ({ RawEventsRepository: returning({}) }));
vi.mock("@/backend/repositories/uploadedFiles.repository", () => ({ UploadedFilesRepository: returning(files) }));
vi.mock("@/backend/services/storage", () => ({ statementStorage: storage, statementBucket: () => "bucket", statementKey: (u: string, i: string, f: string) => `${u}/${i}/${f}` }));
vi.mock("@/backend/services/auditLog", () => ({ audit }));
vi.mock("@/backend/services/importPipeline.service", () => ({ importPipeline: vi.fn() }));
vi.mock("@/backend/jobs/queue", () => ({ enqueueJob: vi.fn() }));
vi.mock("@/backend/jobs/worker", () => ({ kickWorker: vi.fn() }));
vi.mock("@/backend/supabase/clients", () => ({ getAdminClient: vi.fn() }));

const { importsService } = await import("@/backend/services/imports.service");
const service = importsService({} as never, { info: vi.fn(), warn: vi.fn() } as never);

const row = (over: Record<string, unknown> = {}) => ({
  id: "imp-1",
  user_id: "u",
  file_name: "statement.xlsx",
  file_path: "u/imp-1/statement.xlsx",
  file_size: 10,
  file_sha256: "a".repeat(64),
  status: "completed",
  file_deleted_at: null,
  source_kind: null,
  source_app: null,
  counts: {},
  ...over,
});
const input = { fileName: "statement.xlsx", fileSize: 10, sha256: "a".repeat(64) };

beforeEach(() => {
  vi.clearAllMocks();
  repo.insert.mockImplementation(async (_u: string, r: Record<string, unknown>) => row({ ...r, status: "uploaded" }));
});

describe("uploading the same file again", () => {
  it("replaces an import that failed, removing it and its file first", async () => {
    repo.findBySha.mockResolvedValue(row({ status: "failed" }));
    const out = await service.create("u", input);
    expect(repo.deleteCascade).toHaveBeenCalledWith("imp-1");
    expect(storage.remove).toHaveBeenCalledWith("u/imp-1/statement.xlsx");
    expect(files.setStatus).toHaveBeenCalledWith("u", "u/imp-1/statement.xlsx", "deleted");
    expect(repo.insert).toHaveBeenCalledOnce();
    expect(out.import.id).not.toBe("imp-1");
  });

  it.each([
    ["completed", /already imported/],
    ["needs_password", /waiting for its password/],
    ["processing", /already being imported/],
  ])("still refuses a %s import", async (status, message) => {
    repo.findBySha.mockResolvedValue(row({ status }));
    await expect(service.create("u", input)).rejects.toThrow(message);
    expect(repo.deleteCascade).not.toHaveBeenCalled();
  });
});

describe("deleting an import", () => {
  it("'file' keeps the import and its transactions, removing only the stored statement", async () => {
    repo.findById.mockResolvedValue(row());
    await service.remove("u", "imp-1", "file");
    expect(storage.remove).toHaveBeenCalledWith("u/imp-1/statement.xlsx");
    expect(repo.update).toHaveBeenCalledWith("u", "imp-1", { file_deleted_at: expect.any(String) });
    expect(repo.deleteCascade).not.toHaveBeenCalled();
  });

  it("'file' is only for completed imports", async () => {
    repo.findById.mockResolvedValue(row({ status: "failed" }));
    await expect(service.remove("u", "imp-1", "file")).rejects.toThrow(/Only a completed import/);
  });

  it("'all' removes the import with its transactions, and skips a file already deleted", async () => {
    repo.findById.mockResolvedValue(row({ file_deleted_at: "2026-10-22T00:00:00Z" }));
    await service.remove("u", "imp-1", "all");
    expect(repo.deleteCascade).toHaveBeenCalledWith("imp-1");
    expect(storage.remove).not.toHaveBeenCalled();
  });
});

describe("stuck imports", () => {
  it("replaces an import that has been 'in progress' without change for over 15 minutes", async () => {
    const { replaceable } = await import("@/backend/services/imports.service");
    const now = Date.parse("2026-10-23T12:00:00Z");
    expect(replaceable({ status: "processing", updated_at: "2026-10-23T11:30:00Z" }, now)).toBe(true);
    expect(replaceable({ status: "processing", updated_at: "2026-10-23T11:55:00Z" }, now)).toBe(false);
    expect(replaceable({ status: "completed", updated_at: "2026-10-01T00:00:00Z" }, now)).toBe(false);
    expect(replaceable({ status: "failed", updated_at: "2026-10-23T11:59:00Z" }, now)).toBe(true);
  });
});
