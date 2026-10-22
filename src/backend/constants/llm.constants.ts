import "server-only";
import type { LlmTask } from "@/shared/constants/enums";

/**
 * The only AI configuration: Ollama, set here in code (not by users).
 * Change the model or limits below and redeploy. The endpoint and key come from env:
 * OLLAMA_BASE_URL (default Ollama Cloud) and OLLAMA_API_KEY.
 */
export const LLM = {
  /** On Ollama Cloud use names without the ":cloud" suffix; locally, any pulled model (e.g. "qwen3.5:9b"). */
  MODEL: "glm-5.2",
  /** Context window sent to Ollama (num_ctx); prompt data is truncated to fit. */
  MAX_INPUT_TOKENS: 16_000,
  /** Rough characters per token, used only to keep prompts inside MAX_INPUT_TOKENS. */
  CHARS_PER_TOKEN: 3,
  TIMEOUT_MS: 45_000,
  MAX_RETRIES: 1,
  TASKS: {
    categorize: { enabled: true, maxOutputTokens: 2_000, temperature: 0 },
    column_mapping: { enabled: true, maxOutputTokens: 1_000, temperature: 0 },
    pdf_extraction: { enabled: true, maxOutputTokens: 4_000, temperature: 0 },
    monthly_summary: { enabled: true, maxOutputTokens: 800, temperature: 0.3 },
    refund_message: { enabled: true, maxOutputTokens: 600, temperature: 0.4 },
  } satisfies Record<LlmTask, { enabled: boolean; maxOutputTokens: number; temperature: number }>,
} as const;

export const DEFAULT_OLLAMA_BASE_URL = "https://ollama.com/api";

/** Below this confidence an LLM category is applied but the transaction is queued for review. */
export const LLM_CONFIDENCE_THRESHOLD = 0.7;

/** Unknown PDFs are read by the LLM in chunks; this many chunks per background job step (60 s limit). */
export const PDF_LLM = {
  CHUNKS_PER_STEP: 2,
  /** Share of the input budget used by statement text (the rest is instructions and the response). */
  TEXT_SHARE: 0.6,
} as const;

/** CSV/Excel column mapping by the LLM. */
export const COLUMN_MAPPING = {
  SAMPLE_ROWS: 15,
  CELL_CHARS: 60,
  /** Share of data rows that must parse with the proposed mapping before it is accepted and saved. */
  MIN_PARSED_SHARE: 0.9,
} as const;
