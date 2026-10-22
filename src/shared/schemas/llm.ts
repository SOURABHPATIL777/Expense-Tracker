import { z } from "zod";
import { LLM_PROVIDERS, LLM_TASKS, type LlmProvider, type LlmTask } from "../constants/enums";
import { checkboxField, optionalField } from "./formFields";

const endpointNameSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/);
const modelSchema = z.string().trim().min(1).max(120);

const configFields = {
  provider: z.enum(LLM_PROVIDERS),
  model: modelSchema,
};

const withEndpointRule = <T extends { provider: LlmProvider; endpointName?: string }>(v: T) => v.provider !== "ollama" || Boolean(v.endpointName);
const endpointMessage = { message: "Choose an Ollama endpoint", path: ["endpointName"] };

export const llmConfigInputSchema = z
  .object({
    ...configFields,
    task: z.enum(LLM_TASKS),
    enabled: z.boolean().default(true),
    endpointName: endpointNameSchema.optional(),
    temperature: z.number().min(0).max(2).default(0.1),
    maxOutputTokens: z.number().int().min(64).max(8000).default(2000),
    timeoutMs: z.number().int().min(1000).max(120_000).default(30_000),
    allowCloudProcessing: z.boolean().default(false),
  })
  .refine(withEndpointRule, endpointMessage);
export type LlmConfigInput = z.infer<typeof llmConfigInputSchema>;

/** Settings form: the task comes from the card, everything else is typed. */
export const llmConfigFormSchema = z
  .object({
    ...configFields,
    enabled: checkboxField,
    endpointName: optionalField(endpointNameSchema),
    temperature: z.coerce.number().min(0).max(2),
    maxOutputTokens: z.coerce.number().int().min(64).max(8000),
    timeoutMs: z.coerce.number().int().min(1000).max(120_000),
    allowCloudProcessing: checkboxField,
  })
  .refine(withEndpointRule, endpointMessage);
export type LlmConfigForm = z.infer<typeof llmConfigFormSchema>;

export const llmTestSchema = z
  .object({ ...configFields, endpointName: endpointNameSchema.optional(), allowCloudProcessing: z.boolean().default(false) })
  .refine(withEndpointRule, endpointMessage);
export type LlmTestInput = z.infer<typeof llmTestSchema>;

export type LlmTestResultDto = { ok: boolean; latencyMs: number; structuredOutput: boolean; error: string | null };

export type LlmConfigDto = {
  task: LlmTask;
  enabled: boolean;
  provider: LlmProvider;
  model: string;
  endpointName: string | null;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
  allowCloudProcessing: boolean;
  lastTestedAt: string | null;
  lastTest: LlmTestResultDto | null;
};

export type LlmProviderOptionDto = {
  provider: LlmProvider;
  label: string;
  /** False when the server has no API key / endpoint for it. */
  available: boolean;
  /** Data leaves your infrastructure (needs explicit consent). */
  cloud: boolean;
  defaultModel: string;
  suggestedModels: string[];
};

export type LlmOptionsDto = { providers: LlmProviderOptionDto[]; ollamaEndpoints: string[]; defaults: Record<LlmTask, { temperature: number; maxOutputTokens: number }> };
