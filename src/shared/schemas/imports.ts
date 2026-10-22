import { z } from "zod";
import { IMPORT_STATUSES, SOURCE_APPS, type Direction, type ImportStatus, type SourceApp, type SourceKind } from "../constants/enums";
import { UPLOAD } from "../constants/limits";
import { FILE_FORMATS, SOURCE_CONFIG, formatForFileName } from "../constants/sources";
import { nameSchema, paginationQuerySchema, uuidSchema } from "./common";

export const createImportSchema = z
  .object({
    fileName: z.string().trim().min(1).max(255),
    fileSize: z.number().int().positive().max(UPLOAD.MAX_FILE_BYTES, "File is larger than 10 MB"),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    sourceApp: z.enum(SOURCE_APPS),
    accountId: uuidSchema.optional(),
  })
  .superRefine((v, ctx) => {
    const format = formatForFileName(v.fileName);
    const allowed = SOURCE_CONFIG[v.sourceApp].formats;
    if (!format || !allowed.includes(format)) {
      ctx.addIssue({
        code: "custom",
        path: ["fileName"],
        message: `Upload ${allowed.map((f) => FILE_FORMATS[f].label).join(", ")} for this source`,
      });
    }
  });
export type CreateImportInput = z.infer<typeof createImportSchema>;

export const importListQuerySchema = paginationQuerySchema.extend({ status: z.enum(IMPORT_STATUSES).optional() });

export const passwordSchema = z.object({ password: z.string().min(1, "Enter the password").max(128) });

/** Date formats offered in the column mapper (tokens understood by the backend date parser). */
export const DATE_FORMAT_OPTIONS = [
  "dd/MM/yyyy",
  "dd-MM-yyyy",
  "dd/MM/yy",
  "dd-MM-yy",
  "MM/dd/yyyy",
  "yyyy-MM-dd",
  "d MMM yyyy",
  "dd MMM yyyy",
  "dd-MMM-yyyy",
  "dd-MMM-yy",
  "MMM dd, yyyy",
  "dd/MM/yyyy HH:mm:ss",
  "dd-MM-yyyy HH:mm:ss",
  "yyyy-MM-dd HH:mm:ss",
] as const;

const columnIndex = z.number().int().min(0).max(200);
const optionalColumn = columnIndex.optional();

export const MAPPABLE_FIELDS = ["date", "time", "narration", "counterparty", "vpa", "reference", "appTransactionId", "balance", "note"] as const;
export type MappableField = (typeof MAPPABLE_FIELDS)[number];

export const mappingSchema = z.object({
  headerRowIndex: z.number().int().min(0).max(100),
  columns: z.object({
    date: columnIndex,
    time: optionalColumn,
    narration: optionalColumn,
    counterparty: optionalColumn,
    vpa: optionalColumn,
    reference: optionalColumn,
    appTransactionId: optionalColumn,
    balance: optionalColumn,
    note: optionalColumn,
  }),
  amount: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("split"), debit: columnIndex, credit: columnIndex }),
    z.object({ mode: z.literal("signed"), amount: columnIndex }),
    z.object({
      mode: z.literal("typed"),
      amount: columnIndex,
      type: columnIndex,
      debitValues: z.array(z.string().trim().min(1).max(40)).min(1).max(10),
      creditValues: z.array(z.string().trim().min(1).max(40)).min(1).max(10),
    }),
  ]),
  dateFormat: z.enum(DATE_FORMAT_OPTIONS),
  saveTemplate: z.boolean().default(true),
  templateName: nameSchema.optional(),
});
export type MappingInput = z.infer<typeof mappingSchema>;

export const rowsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["pending", "accepted", "linked", "duplicate", "skipped", "rejected"]).optional(),
});

export type ImportDto = {
  id: string;
  fileName: string;
  fileSize: number;
  sourceKind: SourceKind;
  sourceApp: SourceApp;
  accountId: string | null;
  status: ImportStatus;
  presetId: string | null;
  presetLabel: string | null;
  presetVerified: boolean | null;
  errorCode: string | null;
  errorMessage: string | null;
  counts: { rows: number; imported: number; linked: number; duplicates: number; skipped: number; review: number };
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type CreateImportResultDto = { import: ImportDto; upload: { url: string } };

export type ImportPreviewDto = { rows: string[][]; suggestedHeaderRow: number };

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
