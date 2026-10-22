import { z } from "zod";
import { REFUND_STATUSES, type RefundStatus } from "../constants/enums";
import { amountMinorSchema, isoDateSchema, noteSchema, paginationQuerySchema, uuidSchema } from "./common";
import { optionalField, optionalRupeesField } from "./formFields";
import type { TransactionSummaryDto } from "./review";

const orderRefSchema = z.string().trim().max(120);

export const createRefundSchema = z.object({
  transactionId: uuidSchema,
  /** Defaults to the full payment amount. */
  expectedAmountMinor: amountMinorSchema.optional(),
  expectedBy: isoDateSchema.optional(),
  orderRef: orderRefSchema.optional(),
  note: noteSchema.optional(),
});
export type CreateRefundInput = z.infer<typeof createRefundSchema>;

/** Form for "expect a refund"; the transaction id is supplied by the page. */
export const refundFormSchema = z.object({
  expectedAmountMinor: optionalRupeesField,
  expectedBy: optionalField(isoDateSchema),
  orderRef: optionalField(orderRefSchema),
  note: optionalField(noteSchema),
});

export const refundListQuerySchema = paginationQuerySchema.extend({ status: z.enum(REFUND_STATUSES).optional() });

export const refundActionSchema = z.discriminatedUnion("action", [
  /** The user confirms this incoming credit is the refund. */
  z.object({ action: z.literal("confirm"), matchTransactionId: uuidSchema }),
  /** Stop tracking (refund abandoned or settled outside the app). */
  z.object({ action: z.literal("close") }),
  z.object({ action: z.literal("reopen") }),
]);
export type RefundActionInput = z.infer<typeof refundActionSchema>;

export type RefundDto = {
  id: string;
  status: RefundStatus;
  expectedAmountMinor: number;
  expectedBy: string | null;
  overdue: boolean;
  orderRef: string | null;
  note: string | null;
  createdAt: string;
  transaction: TransactionSummaryDto | null;
  match: TransactionSummaryDto | null;
  suggestions: TransactionSummaryDto[];
};

export type RefundMessageDto = { message: string };
