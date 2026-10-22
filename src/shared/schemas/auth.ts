import { z } from "zod";
import { nameSchema } from "./common";

export const emailSchema = z.email().trim().toLowerCase().max(254);
export const passwordSchema = z.string().min(8, "Use at least 8 characters").max(128);

export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1, "Enter your password").max(128) });
export type LoginInput = z.infer<typeof loginSchema>;

export const signupSchema = z.object({ displayName: nameSchema, email: emailSchema, password: passwordSchema });
export type SignupInput = z.infer<typeof signupSchema>;

export type MeDto = { id: string; email: string | null; displayName: string | null; isAnonymous: boolean };
export type SignupResultDto = { needsEmailConfirmation: boolean };
