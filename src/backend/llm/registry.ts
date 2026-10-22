import "server-only";
import { extractJsonMiddleware, wrapLanguageModel, type LanguageModel } from "ai";
import { createOllama } from "ollama-ai-provider-v2";
import { getEnv } from "@/backend/config/env";
import { LLM } from "@/backend/constants/llm.constants";

const OLLAMA_CLOUD_HOST = /(^|\.)ollama\.com$/i;

/** Ollama Cloud needs a key; a self-hosted/local Ollama may not. */
export function llmAvailable(): boolean {
  const env = getEnv();
  return Boolean(env.OLLAMA_API_KEY) || !OLLAMA_CLOUD_HOST.test(new URL(env.OLLAMA_BASE_URL).hostname);
}

/**
 * The single model client (Ollama via the AI SDK), built from env + constants. Some models
 * (e.g. glm on Ollama Cloud) wrap JSON in markdown fences; the middleware strips them so
 * structured output still validates.
 */
export function getModel(model: string = LLM.MODEL): LanguageModel {
  const env = getEnv();
  const ollama = createOllama({
    baseURL: env.OLLAMA_BASE_URL,
    headers: env.OLLAMA_API_KEY ? { Authorization: `Bearer ${env.OLLAMA_API_KEY}` } : undefined,
  });
  return wrapLanguageModel({ model: ollama(model), middleware: extractJsonMiddleware() });
}
