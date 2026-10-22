import { z } from "zod";
import type { Direction, ReviewItemKind, TransactionKind, TransactionStatus } from "../constants/enums";
import { paginationQuerySchema, uuidSchema } from "./common";

export const reviewListQuerySchema = paginationQuerySchema;

export const resolveReviewSchema = z.discriminatedUnion("action", [
  /** Duplicate candidate: these are two separate payments. */
  z.object({ action: z.literal("keep_both") }),
  /** Duplicate candidate: same payment; fold the new one into the existing one. */
  z.object({ action: z.literal("merge") }),
  /** Low-confidence category: the suggestion is right. */
  z.object({ action: z.literal("accept") }),
  /** Low-confidence category: use this category instead (learned for the merchant). */
  z.object({ action: z.literal("recategorize"), categoryId: uuidSchema }),
  z.object({ action: z.literal("dismiss") }),
]);
export type ResolveReviewInput = z.infer<typeof resolveReviewSchema>;

export type TransactionSummaryDto = {
  id: string;
  occurredAt: string;
  amountMinor: number;
  direction: Direction;
  status: TransactionStatus;
  kind: TransactionKind;
  merchant: string | null;
  categoryId: string | null;
  referenceId: string | null;
  sourceApp: string;
};

export type ReviewItemDto = {
  id: string;
  kind: ReviewItemKind;
  createdAt: string;
  transaction: TransactionSummaryDto | null;
  related: TransactionSummaryDto | null;
  payload: Record<string, unknown>;
};
