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
 * Turns a model's reply into bare JSON text: drops reasoning a "thinking" model leaked into its
 * answer (glm-5.3-flash with thinking off still emits "…</think>{…}") and markdown fences
 * (glm wraps JSON in ```json … ```).
 */
export function cleanModelJson(text: string): string {
  const afterThinking = text.includes("</think>") ? text.slice(text.lastIndexOf("</think>") + "</think>".length) : text;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(afterThinking);
  const candidate = (fenced ? fenced[1] : afterThinking).trim();
  return isJson(candidate) ? candidate : (trailingJson(candidate) ?? candidate);
}

const isJson = (text: string) => {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};

/** The JSON value a reply ends with, when prose (untagged reasoning) comes before it. */
function trailingJson(text: string): string | null {
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{" && text[i] !== "[") continue;
    const rest = text.slice(i).trim();
    if (isJson(rest)) return rest;
  }
  return null;
}

/** The single model client (Ollama via the AI SDK), built from env + constants. */
export function getModel(model: string = LLM.MODEL): LanguageModel {
  const env = getEnv();
  const ollama = createOllama({
    baseURL: env.OLLAMA_BASE_URL,
    headers: env.OLLAMA_API_KEY ? { Authorization: `Bearer ${env.OLLAMA_API_KEY}` } : undefined,
  });
  return wrapLanguageModel({ model: ollama(model), middleware: extractJsonMiddleware({ transform: cleanModelJson }) });
}
