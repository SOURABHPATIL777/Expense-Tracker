import { z } from "zod";
import { IMPORT_DELETE_MODES, IMPORT_STATUSES, type Direction, type ImportStatus, type SourceApp, type SourceKind } from "../constants/enums";
import { UPLOAD } from "../constants/limits";
import { ALL_FORMATS, FILE_FORMATS, formatForFileName } from "../constants/sources";
import { paginationQuerySchema } from "./common";

/** Any CSV, Excel, PDF, HTML or JSON statement; the bank or UPI app is detected after upload. */
export const createImportSchema = z
  .object({
    fileName: z.string().trim().min(1).max(255),
    fileSize: z.number().int().positive().max(UPLOAD.MAX_FILE_BYTES, "File is larger than 10 MB"),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .superRefine((v, ctx) => {
    if (!formatForFileName(v.fileName)) {
      ctx.addIssue({ code: "custom", path: ["fileName"], message: `Upload ${ALL_FORMATS.map((f) => FILE_FORMATS[f].label).join(", ")}` });
    }
  });
export type CreateImportInput = z.infer<typeof createImportSchema>;

/** Imports still being uploaded, read or matched (shown as "in progress" across the app). */
export const ACTIVE_IMPORT_STATUSES = ["uploaded", "queued", "parsing", "processing"] as const satisfies readonly ImportStatus[];

export const importListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(IMPORT_STATUSES).optional(),
  /** Only imports in progress (ACTIVE_IMPORT_STATUSES). */
  active: z.enum(["true", "false"]).optional(),
});
export type ImportListQuery = z.infer<typeof importListQuerySchema>;

export const deleteImportQuerySchema = z.object({ mode: z.enum(IMPORT_DELETE_MODES).default("all") });

export const passwordSchema = z.object({ password: z.string().min(1, "Enter the password").max(128) });

export const rowsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["pending", "accepted", "linked", "duplicate", "skipped", "rejected"]).optional(),
});

export type ImportDto = {
  id: string;
  fileName: string;
  fileSize: number;
  /** Null until the file has been read and its source detected. */
  sourceKind: SourceKind | null;
  sourceApp: SourceApp | null;
  accountId: string | null;
  status: ImportStatus;
  /** e.g. "HDFC Bank statement (CSV/Excel)". */
  detectedLabel: string | null;
  /** An LLM worked out the columns or read the rows: worth a quick check. */
  readByAi: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  counts: { rows: number; imported: number; linked: number; duplicates: number; skipped: number; review: number };
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: string;
  completedAt: string | null;
  /** Set when the statement file was deleted but its transactions were kept. */
  fileDeletedAt: string | null;
};

export type CreateImportResultDto = { import: ImportDto; upload: { url: string } };

export type ImportRowDto = {
  id: string;
  rowIndex: number;
  status: string;
  error: string | null;
  transactionId: string | null;
  occurredAt: string | null;
  amountMinor: number | null;
  direction: Direction | null;
  counterparty: string | null;
  reference: string | null;
};
