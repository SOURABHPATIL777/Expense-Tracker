import { z } from "zod";
import { SOURCE_APPS, SOURCE_KINDS, type SourceApp, type SourceKind } from "../constants/enums";
import { nameSchema } from "./common";
import { checkboxField, listField, optionalField } from "./formFields";

/** UPI virtual payment address, e.g. `rahul.s@okhdfcbank`, `98xxxxxx10@ybl`. */
export const vpaSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{2,256}@[a-z][a-z0-9.-]{1,64}$/, "Enter a valid UPI ID like name@okhdfcbank");

export const lastDigitsSchema = z.string().regex(/^\d{4}$/, "Enter only the last 4 digits");

const accountFields = {
  label: nameSchema,
  sourceKind: z.enum(SOURCE_KINDS),
  sourceApp: z.enum(SOURCE_APPS),
};

export const accountInputSchema = z.object({
  ...accountFields,
  maskedNumber: lastDigitsSchema.optional(),
  upiIds: z.array(vpaSchema).max(20).default([]),
  isPrimary: z.boolean().default(false),
});
export type AccountInput = z.infer<typeof accountInputSchema>;

export const accountFormSchema = z.object({
  ...accountFields,
  maskedNumber: optionalField(lastDigitsSchema),
  upiIds: listField(vpaSchema),
  isPrimary: checkboxField,
});

export type AccountDto = {
  id: string;
  label: string;
  sourceKind: SourceKind;
  sourceApp: SourceApp;
  maskedNumber: string | null;
  upiIds: string[];
  isPrimary: boolean;
  createdAt: string;
};
