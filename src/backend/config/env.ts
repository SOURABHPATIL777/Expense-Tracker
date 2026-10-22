import "server-only";
import { z } from "zod";
import { DEFAULT_OLLAMA_BASE_URL } from "@/backend/constants/llm.constants";

const optionalSecret = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url(),
  SUPABASE_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  SUPABASE_SECRET_KEY: z.string().min(20),
  // Cloudflare R2 (S3-compatible) holds uploaded statements.
  R2_ACCOUNT_ID: z.string().regex(/^[0-9a-f]{32}$/, "R2_ACCOUNT_ID is the 32-character Cloudflare account ID"),
  R2_ACCESS_KEY_ID: z.string().min(16),
  R2_SECRET_ACCESS_KEY: z.string().min(32),
  R2_BUCKET: z.string().min(3).default("expense-statements"),
  /** Override for EU/FedRAMP jurisdictions, e.g. https://<account>.eu.r2.cloudflarestorage.com */
  R2_ENDPOINT: optionalSecret.pipe(z.url().optional()),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  // Ollama is the only AI provider. Model and limits live in constants/llm.constants.ts.
  /** Defaults to Ollama Cloud; use http://localhost:11434/api for a local Ollama. */
  OLLAMA_BASE_URL: optionalSecret.pipe(z.url().optional()).transform((v) => (v ?? DEFAULT_OLLAMA_BASE_URL).replace(/\/$/, "")),
  /** Bearer token: an ollama.com API key, or your gateway's token. Not needed for a local Ollama. */
  OLLAMA_API_KEY: optionalSecret,
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Validated environment. Throws with every problem listed if configuration is incomplete. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "env"}: ${i.message}`).join("\n");
    throw new Error(`Invalid server environment:\n${problems}`);
  }
  cached = parsed.data;
  return cached;
}

export const isProduction = () => getEnv().NODE_ENV === "production";
