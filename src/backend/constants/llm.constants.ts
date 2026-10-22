import "server-only";
import type { LlmProvider, LlmTask } from "@/shared/constants/enums";

export const DEFAULT_MODELS: Record<LlmProvider, string> = {
  openai: "gpt-5-mini",
  google: "gemini-2.5-flash",
  xai: "grok-4-fast",
  ollama: "qwen3.5:9b",
};

/**
 * Models offered in the settings dropdown. Any model id can still be typed in; it is capability-tested
 * before it can be saved. Ollama cloud-hosted models use the `:cloud` tag (e.g. `glm-5.2:cloud`).
 */
export const SUGGESTED_MODELS: Record<LlmProvider, readonly string[]> = {
  openai: ["gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-4.1-mini"],
  google: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
  xai: ["grok-4", "grok-4-fast", "grok-3-mini"],
  ollama: [
    "qwen3.5:9b",
    "gemma4:31b",
    "mistral-large-4",
    "glm-5.3",
    "glm-5.3-flash",
    "glm-5.2",
    "glm-5.2:cloud",
    "llama3.2",
  ],
};

/** Env var holding each cloud provider's API key. Keys are never stored in the database. */
export const PROVIDER_KEY_ENV: Record<Exclude<LlmProvider, "ollama">, string> = {
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  xai: "XAI_API_KEY",
};

export const CLOUD_PROVIDERS: readonly LlmProvider[] = ["openai", "google", "xai"];

export const LLM_DEFAULTS = {
  TEMPERATURE: 0.1,
  MAX_OUTPUT_TOKENS: 2_000,
  MAX_OUTPUT_TOKENS_LIMIT: 8_000,
} as const;

export const TASK_DEFAULTS: Record<LlmTask, { temperature: number; maxOutputTokens: number }> = {
  categorize: { temperature: 0, maxOutputTokens: 2_000 },
  monthly_summary: { temperature: 0.3, maxOutputTokens: 800 },
  refund_message: { temperature: 0.4, maxOutputTokens: 600 },
};

/** Below this confidence an LLM category is applied but the transaction is queued for review. */
export const LLM_CONFIDENCE_THRESHOLD = 0.7;
