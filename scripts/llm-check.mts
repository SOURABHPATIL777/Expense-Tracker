/**
 * Checks the Ollama model configured in src/backend/constants/llm.constants.ts can return
 * structured output, using OLLAMA_BASE_URL / OLLAMA_API_KEY from .env.local or .env.
 *   npm run llm:check
 */
import { existsSync } from "node:fs";
import { generateText, Output } from "ai";
import { z } from "zod";

for (const file of [".env.local", ".env"]) if (existsSync(file)) process.loadEnvFile?.(file);

const { LLM } = await import("../src/backend/constants/llm.constants");
const { getModel, llmAvailable } = await import("../src/backend/llm/registry");
const { jsonContract } = await import("../src/backend/llm/run");
const { getEnv } = await import("../src/backend/config/env");

const env = getEnv();
console.log(`Model ${LLM.MODEL} at ${env.OLLAMA_BASE_URL} (key ${env.OLLAMA_API_KEY ? "set" : "not set"})`);
if (!llmAvailable()) {
  console.error("Ollama Cloud needs OLLAMA_API_KEY. For a local Ollama set OLLAMA_BASE_URL=http://localhost:11434/api.");
  process.exit(1);
}

const started = performance.now();
try {
  const schema = z.object({ category: z.enum(["Food", "Transport", "Shopping"]), confidence: z.number().min(0).max(1) });
  const { output } = await generateText({
    model: getModel(),
    system: jsonContract(schema),
    prompt: 'Categorise this Indian UPI payment: merchant "Swiggy", narration "UPI payment for food order", ₹349.',
    output: Output.object({ schema }),
    temperature: 0,
    maxOutputTokens: 200,
    abortSignal: AbortSignal.timeout(LLM.TIMEOUT_MS),
    providerOptions: { ollama: { options: { num_ctx: LLM.MAX_INPUT_TOKENS } } },
  });
  const ms = Math.round(performance.now() - started);
  const ok = output.category === "Food";
  console.log(`${ok ? "PASS" : "FAIL"}: ${JSON.stringify(output)} in ${ms} ms`);
  process.exit(ok ? 0 : 1);
} catch (err) {
  console.error(`FAIL: ${(err as Error).message}`);
  process.exit(1);
}
