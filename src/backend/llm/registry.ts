import "server-only";
import type { LanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createXai } from "@ai-sdk/xai";
import { createOllama } from "ollama-ai-provider-v2";
import { getEnv } from "@/backend/config/env";
import { AppError } from "@/backend/errors/AppError";
import { CLOUD_PROVIDERS } from "@/backend/constants/llm.constants";
import type { LlmProvider } from "@/backend/constants/enums.constants";

export type ModelRef = { provider: LlmProvider; model: string; endpointName?: string | null };

/** Hosts that are Ollama's own hosted service rather than a server you run. */
const OLLAMA_CLOUD_HOST = /(^|\.)ollama\.com$/i;

/**
 * Whether data leaves infrastructure the operator controls, which requires the user's consent.
 * For Ollama that's a `:cloud`-tagged model (routed to Ollama's cloud by the daemon) or any
 * endpoint hosted on ollama.com.
 */
export function isCloudModel(ref: ModelRef): boolean {
  if (CLOUD_PROVIDERS.includes(ref.provider)) return true;
  if (ref.provider !== "ollama") return false;
  if (/:cloud$/i.test(ref.model)) return true;
  const url = ref.endpointName ? getEnv().OLLAMA_ENDPOINTS[ref.endpointName] : undefined;
  return Boolean(url && OLLAMA_CLOUD_HOST.test(new URL(url).hostname));
}

/** Whether the server has what it needs (key or endpoint) to call this provider. */
export function providerAvailable(provider: LlmProvider): boolean {
  const env = getEnv();
  switch (provider) {
    case "openai":
      return Boolean(env.OPENAI_API_KEY);
    case "google":
      return Boolean(env.GOOGLE_GENERATIVE_AI_API_KEY);
    case "xai":
      return Boolean(env.XAI_API_KEY);
    case "ollama":
      return Object.keys(env.OLLAMA_ENDPOINTS).length > 0;
  }
}

const notConfigured = (what: string) => new AppError("LLM_NOT_CONFIGURED", { message: `${what} is not configured on the server.` });

/**
 * The only place model clients are built. API keys come from env; Ollama URLs only from the
 * admin allowlist (`OLLAMA_ENDPOINTS`), never from user input.
 */
export function getModel(ref: ModelRef): LanguageModel {
  const env = getEnv();
  switch (ref.provider) {
    case "openai":
      if (!env.OPENAI_API_KEY) throw notConfigured("OpenAI");
      return createOpenAI({ apiKey: env.OPENAI_API_KEY })(ref.model);
    case "google":
      if (!env.GOOGLE_GENERATIVE_AI_API_KEY) throw notConfigured("Google Gemini");
      return createGoogleGenerativeAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY })(ref.model);
    case "xai":
      if (!env.XAI_API_KEY) throw notConfigured("xAI Grok");
      return createXai({ apiKey: env.XAI_API_KEY })(ref.model);
    case "ollama": {
      const baseURL = ref.endpointName ? env.OLLAMA_ENDPOINTS[ref.endpointName] : undefined;
      if (!baseURL) throw notConfigured(`Ollama endpoint "${ref.endpointName ?? ""}"`);
      return createOllama({ baseURL, headers: env.OLLAMA_API_KEY ? { Authorization: `Bearer ${env.OLLAMA_API_KEY}` } : undefined })(ref.model);
    }
  }
}
