import "server-only";
import type { LlmTask } from "@/shared/constants/enums";

/**
 * The only AI configuration: Ollama, set here in code (not by users).
 * Change the model or limits below and redeploy. The endpoint and key come from env:
 * OLLAMA_BASE_URL (default Ollama Cloud) and OLLAMA_API_KEY.
 */
export const LLM = {
  /** On Ollama Cloud use names without the ":cloud" suffix; locally, any pulled model (e.g. "qwen3.5:9b"). */
  MODEL: "glm-5.3-flash",
  /** Context window sent to Ollama (num_ctx); prompt data is truncated to fit. */
  MAX_INPUT_TOKENS: 16_000,
  /** Rough characters per token, used only to keep prompts inside MAX_INPUT_TOKENS. */
  CHARS_PER_TOKEN: 3,
  TIMEOUT_MS: 45_000,
  /** A call isn't started inside a background job with less time than this left (it would be cut off). */
  MIN_CALL_MS: 12_000,
  /** Margin kept between a call's timeout and the job's deadline. */
  DEADLINE_MARGIN_MS: 3_000,
  MAX_RETRIES: 1,
  /**
   * Model "thinking" (glm-5.3, deepseek-r1, qwen3…). Off: these tasks are extraction, and the
   * reasoning tokens would eat the output budget and slow every call.
   */
  THINK: false,
  TASKS: {
    categorize: { enabled: true, maxOutputTokens: 2_000, temperature: 0 },
    column_mapping: { enabled: true, maxOutputTokens: 1_000, temperature: 0 },
    pdf_extraction: { enabled: true, maxOutputTokens: 8_000, temperature: 0 },
    monthly_summary: { enabled: true, maxOutputTokens: 800, temperature: 0.3 },
    refund_message: { enabled: true, maxOutputTokens: 600, temperature: 0.4 },
  } satisfies Record<LlmTask, { enabled: boolean; maxOutputTokens: number; temperature: number }>,
} as const;

export const DEFAULT_OLLAMA_BASE_URL = "https://ollama.com/api";

/** Below this confidence an LLM category is applied but the transaction is queued for review. */
export const LLM_CONFIDENCE_THRESHOLD = 0.7;

/** Text that isn't a table (some PDFs, HTML pages, JSON) is read by the LLM in chunks. */
export const PDF_LLM = {
  /** Chunks read in parallel per background step (after the first chunk, which also checks the file). */
  CHUNKS_PER_STEP: 3,
  /**
   * Share of the input budget used by statement text. Kept small so the rows found in a chunk fit
   * the response budget (a dense statement page produces roughly as many output tokens as input).
   */
  TEXT_SHARE: 0.35,
} as const;

/** CSV/Excel column mapping by the LLM. */
export const COLUMN_MAPPING = {
  SAMPLE_ROWS: 15,
  /** Lines from the top of the document sent along to identify the bank or app. */
  DOCUMENT_START_LINES: 15,
  CELL_CHARS: 60,
  /** Share of data rows that must parse with the proposed mapping before it is accepted and saved. */
  MIN_PARSED_SHARE: 0.9,
} as const;
