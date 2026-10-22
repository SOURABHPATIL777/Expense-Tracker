import "server-only";
import { z } from "zod";

const optionalSecret = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

/**
 * `OLLAMA_ENDPOINTS` is an admin allowlist: `name=url` pairs separated by commas,
 * e.g. `local=http://localhost:11434/api,gpu=https://ollama.internal.example.com/api`.
 * Users pick an endpoint by name; they can never supply a URL (prevents SSRF).
 */
const ollamaEndpoints = z
  .string()
  .default("")
  .transform((raw, ctx) => {
    const out: Record<string, string> = {};
    for (const pair of raw.split(",").map((p) => p.trim()).filter(Boolean)) {
      const [name, url] = pair.split("=").map((s) => s.trim());
      if (!name || !url || !URL.canParse(url)) {
        ctx.addIssue({ code: "custom", message: `Invalid OLLAMA_ENDPOINTS entry: ${pair}` });
        return z.NEVER;
      }
      out[name] = url.replace(/\/$/, "");
    }
    return out;
  });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url(),
  SUPABASE_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  SUPABASE_SECRET_KEY: z.string().min(20),
  CRON_SECRET: z.string().min(32, "CRON_SECRET must be at least 32 characters"),
  // Cloudflare R2 (S3-compatible) holds uploaded statements.
  R2_ACCOUNT_ID: z.string().regex(/^[0-9a-f]{32}$/, "R2_ACCOUNT_ID is the 32-character Cloudflare account ID"),
  R2_ACCESS_KEY_ID: z.string().min(16),
  R2_SECRET_ACCESS_KEY: z.string().min(32),
  R2_BUCKET: z.string().min(3).default("expense-statements"),
  /** Override for EU/FedRAMP jurisdictions, e.g. https://<account>.eu.r2.cloudflarestorage.com */
  R2_ENDPOINT: optionalSecret.pipe(z.url().optional()),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  OPENAI_API_KEY: optionalSecret,
  GOOGLE_GENERATIVE_AI_API_KEY: optionalSecret,
  XAI_API_KEY: optionalSecret,
  OLLAMA_ENDPOINTS: ollamaEndpoints,
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
