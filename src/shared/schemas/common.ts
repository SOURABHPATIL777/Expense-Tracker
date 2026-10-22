import { z } from "zod";
import { PAGINATION, TEXT } from "../constants/limits";

export const uuidSchema = z.uuid();

export const idParamsSchema = z.object({ id: uuidSchema });

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(PAGINATION.MAX_PAGE_SIZE).default(PAGINATION.DEFAULT_PAGE_SIZE),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** Positive amount in paise. */
export const amountMinorSchema = z.number().int().positive().max(1_000_000_000_00);

export const isoDateSchema = z.iso.date();
export const isoDateTimeSchema = z.iso.datetime({ offset: true });

export const nameSchema = z.string().trim().min(1).max(TEXT.NAME_MAX);
export const titleSchema = z.string().trim().min(1).max(TEXT.TITLE_MAX);
export const noteSchema = z.string().trim().max(TEXT.NOTE_MAX);

export const dateRangeQuerySchema = z
  .object({ from: isoDateSchema.optional(), to: isoDateSchema.optional() })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { message: "`from` must be on or before `to`" });

export type PageMeta = { page: number; pageSize: number; total: number };

export type ApiSuccess<T> = { data: T; meta?: PageMeta };
export type ApiFailure = { error: { code: string; message: string; requestId: string; details?: unknown } };
