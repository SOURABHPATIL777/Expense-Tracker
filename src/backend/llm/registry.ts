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

/** Ollama models tagged `:cloud` run on Ollama's hosted service, so they count as cloud processing. */
export const isCloudModel = (ref: ModelRef) => CLOUD_PROVIDERS.includes(ref.provider) || (ref.provider === "ollama" && /:cloud$/i.test(ref.model));

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
