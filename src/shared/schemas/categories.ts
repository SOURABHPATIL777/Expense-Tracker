import { z } from "zod";
import { RULE_FIELDS, RULE_OPERATORS, TRANSACTION_KINDS, type RuleField, type RuleOperator, type TransactionKind } from "../constants/enums";
import { nameSchema, uuidSchema } from "./common";
import { checkboxField, optionalField } from "./formFields";

export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #3b5bdb");

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const categoryFields = { name: nameSchema, kindHint: z.enum(TRANSACTION_KINDS).default("expense") };

export const categoryInputSchema = z.object({ ...categoryFields, color: colorSchema.optional() });
export type CategoryInput = z.infer<typeof categoryInputSchema>;

export const categoryFormSchema = z.object({ ...categoryFields, color: optionalField(colorSchema) });

export type CategoryDto = { id: string; name: string; kindHint: TransactionKind; color: string | null; isSystem: boolean };

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const ruleFields = {
  field: z.enum(RULE_FIELDS),
  operator: z.enum(RULE_OPERATORS),
  pattern: z.string().trim().min(1).max(120),
};
const atLeastOneOutcome = (v: { categoryId?: string; transactionKind?: string }) => Boolean(v.categoryId || v.transactionKind);
const outcomeMessage = { message: "Choose a category, a type, or both", path: ["categoryId"] };

/** Unrefined shape, for partial updates (zod can't `.partial()` a refined object). */
export const ruleBaseSchema = z.object({
  ...ruleFields,
  categoryId: uuidSchema.optional(),
  transactionKind: z.enum(TRANSACTION_KINDS).optional(),
  priority: z.number().int().min(0).max(1000).default(100),
  isActive: z.boolean().default(true),
});
export const ruleInputSchema = ruleBaseSchema.refine(atLeastOneOutcome, outcomeMessage);
export type RuleInput = z.infer<typeof ruleInputSchema>;

export const ruleFormSchema = z
  .object({
    ...ruleFields,
    categoryId: optionalField(uuidSchema),
    transactionKind: optionalField(z.enum(TRANSACTION_KINDS)),
    priority: z.coerce.number().int().min(0).max(1000).default(100),
    isActive: checkboxField,
  })
  .refine(atLeastOneOutcome, outcomeMessage);

export type RuleDto = {
  id: string;
  field: RuleField;
  operator: RuleOperator;
  pattern: string;
  categoryId: string | null;
  transactionKind: TransactionKind | null;
  priority: number;
  isActive: boolean;
};
