import { z } from "zod";
import {
  DIRECTIONS,
  SOURCE_APPS,
  TRANSACTION_KINDS,
  TRANSACTION_STATUSES,
  type CategorySource,
  type ReconciliationState,
  type SourceKind,
  type TransactionReviewStatus,
} from "../constants/enums";
import { isoDateSchema, noteSchema, paginationQuerySchema, uuidSchema } from "./common";
import type { TransactionSummaryDto } from "./review";

/** Search text is used inside a PostgREST filter, so only plain characters are allowed. */
export const searchSchema = z
  .string()
  .trim()
  .max(60)
  .transform((v) => v.replace(/[^\p{L}\p{N}@._\s-]/gu, "").trim());

export const transactionListQuerySchema = paginationQuerySchema.extend({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  direction: z.enum(DIRECTIONS).optional(),
  kind: z.enum(TRANSACTION_KINDS).optional(),
  status: z.enum(TRANSACTION_STATUSES).optional(),
  /** A category id, or "none" for uncategorised. */
  categoryId: z.union([uuidSchema, z.literal("none")]).optional(),
  sourceApp: z.enum(SOURCE_APPS).optional(),
  review: z.literal("needs_review").optional(),
  search: searchSchema.optional(),
});
export type TransactionListQuery = z.infer<typeof transactionListQuerySchema>;

export const updateTransactionSchema = z
  .object({
    /** null clears the category (and locks it as "uncategorised by choice"). */
    categoryId: uuidSchema.nullable().optional(),
    transactionKind: z.enum(TRANSACTION_KINDS).optional(),
    note: noteSchema.nullable().optional(),
    /** false hands the transaction back to rules/AI. */
    userLocked: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });
export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;

export type TransactionDto = TransactionSummaryDto & {
  narration: string | null;
  note: string | null;
  counterpartyVpa: string | null;
  appTransactionId: string | null;
  paymentRail: string;
  categorySource: CategorySource | null;
  categoryConfidence: number | null;
  userLocked: boolean;
  personalShareMinor: number | null;
  reconciliation: ReconciliationState;
  reviewStatus: TransactionReviewStatus;
};

export type TransactionSourceDto = { importId: string; fileName: string | null; sourceKind: SourceKind; sourceApp: string; addedAt: string };

export type TransactionDetailDto = TransactionDto & { sources: TransactionSourceDto[]; openRefundId: string | null };

/** Edit form: empty category = uncategorised, empty note = no note. */
export const transactionEditFormSchema = z.object({
  categoryId: z
    .string()
    .transform((v) => (v === "" ? null : v))
    .pipe(uuidSchema.nullable()),
  transactionKind: z.enum(TRANSACTION_KINDS),
  note: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .pipe(noteSchema.nullable()),
});
