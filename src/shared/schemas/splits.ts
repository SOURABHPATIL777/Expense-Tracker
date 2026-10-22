import { z } from "zod";
import { SPLIT, TEXT } from "../constants/limits";
import { SPLIT_METHODS, type ClaimStatus, type ParticipantResponse, type SharedExpenseStatus, type SplitMethod } from "../constants/enums";
import { allocateSplit, SplitError } from "../utils/splitAllocation";
import { amountMinorSchema, nameSchema, noteSchema, paginationQuerySchema, titleSchema, uuidSchema } from "./common";
import type { TransactionSummaryDto } from "./review";

export const splitParticipantSchema = z.object({
  id: uuidSchema.optional(),
  displayName: nameSchema,
  isOwner: z.boolean(),
  /** Paise for "exact", percent for "percent", ignored for "equal". */
  value: z.number().nonnegative().optional(),
});

const splitBase = z.object({
  title: titleSchema,
  totalMinor: amountMinorSchema,
  method: z.enum(SPLIT_METHODS),
  note: noteSchema.optional(),
  participants: z.array(splitParticipantSchema).min(SPLIT.MIN_PARTICIPANTS).max(SPLIT.MAX_PARTICIPANTS),
});

/** Same allocation function the UI previews with, so what you see is what gets saved. */
const validAllocation = (v: z.infer<typeof splitBase>, ctx: z.RefinementCtx) => {
  if (v.participants.filter((p) => p.isOwner).length !== 1) {
    ctx.addIssue({ code: "custom", path: ["participants"], message: "Include yourself exactly once." });
    return;
  }
  try {
    allocateSplit(v.totalMinor, v.method, v.participants.map((p) => p.value));
  } catch (err) {
    if (err instanceof SplitError) ctx.addIssue({ code: "custom", path: ["participants"], message: err.message });
    else throw err;
  }
};

export const createSplitSchema = splitBase.extend({ transactionId: uuidSchema.optional() }).superRefine(validAllocation);
export type CreateSplitInput = z.infer<typeof createSplitSchema>;

export const updateSplitSchema = splitBase.superRefine(validAllocation);
export type UpdateSplitInput = z.infer<typeof updateSplitSchema>;

export const splitListQuerySchema = paginationQuerySchema.extend({ status: z.enum(["open", "closed", "cancelled"]).optional() });

export const splitStatusSchema = z.object({ action: z.enum(["close", "cancel", "reopen"]) });

export const claimActionSchema = z.object({ action: z.enum(["confirm", "reject"]), matchTransactionId: uuidSchema.optional() });

export const recordPaymentSchema = z.object({
  participantId: uuidSchema,
  amountMinor: amountMinorSchema,
  matchTransactionId: uuidSchema.optional(),
});

// ---------------------------------------------------------------------------
// Guest API
// ---------------------------------------------------------------------------

/** 32 random bytes, base64url = 43 characters. */
export const inviteTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "This link is incomplete");

export const redeemSchema = z.object({ token: inviteTokenSchema });

export const guestRespondSchema = z.object({
  participantId: uuidSchema,
  response: z.enum(["agreed", "questioned"]),
  version: z.number().int().positive(),
  message: z.string().trim().max(TEXT.NOTE_MAX).optional(),
});

export const guestPaymentSchema = z.object({
  participantId: uuidSchema,
  amountMinor: amountMinorSchema,
  note: z.string().trim().max(300).optional(),
});

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export type SplitSummaryDto = {
  id: string;
  title: string;
  totalMinor: number;
  status: SharedExpenseStatus;
  createdAt: string;
  transactionId: string | null;
  ownerShareMinor: number;
  outstandingMinor: number;
  participantCount: number;
  agreedCount: number;
};

export type ParticipantDto = {
  id: string;
  displayName: string;
  isOwner: boolean;
  shareMinor: number;
  response: ParticipantResponse;
  needsReconfirm: boolean;
  confirmedMinor: number;
  reportedMinor: number;
  outstandingMinor: number;
  link: { active: boolean; expiresAt: string | null; opened: boolean };
};

export type ClaimDto = {
  id: string;
  participantId: string;
  amountMinor: number;
  status: ClaimStatus;
  reportedBy: "guest" | "owner";
  note: string | null;
  reportedAt: string;
};

export type ExpenseEventDto = { action: string; actor: "owner" | "guest"; participantName: string | null; version: number; at: string; message: string | null };

export type SplitDetailDto = Omit<SplitSummaryDto, "participantCount" | "agreedCount"> & {
  method: SplitMethod;
  version: number;
  note: string | null;
  transaction: TransactionSummaryDto | null;
  participants: ParticipantDto[];
  claims: ClaimDto[];
  events: ExpenseEventDto[];
  /** Incoming credits that look like a participant paying you back. */
  repaymentSuggestions: Array<{ participantId: string; transaction: TransactionSummaryDto }>;
};

export type InviteDto = { url: string; expiresAt: string };

export type GuestShareDto = {
  participantId: string;
  displayName: string;
  ownerName: string;
  title: string;
  occurredAt: string;
  totalMinor: number;
  shareMinor: number;
  status: SharedExpenseStatus;
  version: number;
  responseStatus: ParticipantResponse;
  needsReconfirm: boolean;
  confirmedMinor: number;
  reportedMinor: number;
  claims: Array<{ id: string; amountMinor: number; status: ClaimStatus; reportedAt: string }>;
};
