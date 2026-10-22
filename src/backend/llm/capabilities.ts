import "server-only";
import { z } from "zod";
import type { Db } from "@/backend/supabase/clients";
import { AppError } from "@/backend/errors/AppError";
import { TIMEOUTS_MS } from "@/backend/constants/app.constants";
import type { LlmTestResultDto } from "@/shared/schemas/llm";
import { runLlmTask, type RunConfig } from "./run";

const probeSchema = z.object({ category: z.enum(["Food", "Transport", "Shopping"]), confidence: z.number().min(0).max(1) });

/**
 * A tiny structured-output call. Every task in this app needs reliable JSON, so a model that
 * can't produce it is rejected before it can be saved.
 */
export async function testModel(db: Db, userId: string, config: Omit<RunConfig, "timeout_ms" | "temperature" | "max_output_tokens">): Promise<LlmTestResultDto> {
  const started = performance.now();
  try {
    const out = await runLlmTask(db, {
      userId,
      task: "categorize",
      schema: probeSchema,
      instructions: "Pick the category of the transaction and how confident you are.",
      data: JSON.stringify({ merchant: "Swiggy", narration: "UPI payment for food order", amount: 349 }),
      config: { ...config, temperature: 0, max_output_tokens: 200, timeout_ms: TIMEOUTS_MS.LLM_TEST },
    });
    return { ok: out.category === "Food", latencyMs: Math.round(performance.now() - started), structuredOutput: true, error: out.category === "Food" ? null : "The model answered, but incorrectly." };
  } catch (err) {
    const error =
      err instanceof AppError && err.code !== "LLM_UNAVAILABLE"
        ? err.message
        : "The model did not return valid structured output (or did not respond in time).";
    return { ok: false, latencyMs: Math.round(performance.now() - started), structuredOutput: false, error };
  }
}
