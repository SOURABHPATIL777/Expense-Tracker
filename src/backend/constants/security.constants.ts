import "server-only";

export const INVITES = {
  TOKEN_BYTES: 32,
  TTL_DAYS: 7,
  GUEST_ACCESS_TTL_DAYS: 90,
} as const;

export const RATE_LIMITS = {
  AUTH: { windowSeconds: 60, max: 10 },
  GUEST_REDEEM: { windowSeconds: 60, max: 10 },
  GUEST_WRITE: { windowSeconds: 60, max: 20 },
  UPLOAD: { windowSeconds: 60, max: 20 },
  LLM: { windowSeconds: 60, max: 30 },
} as const;
export type RateLimitPolicy = (typeof RATE_LIMITS)[keyof typeof RATE_LIMITS];

export const HEADERS = {
  REQUEST_ID: "x-request-id",
  IDEMPOTENCY_KEY: "idempotency-key",
  CRON_AUTH: "authorization",
} as const;

export { SECURITY_HEADERS, GUEST_HEADERS } from "@/shared/constants/headers";

/** Patterns scrubbed from logs and from any text sent to a cloud LLM. */
export const REDACTION = {
  LONG_DIGITS: /\d{9,}/g,
  MASKED_ACCOUNT: /\b[xX*]{2,}\d{2,}\b/g,
  EMAIL: /[\w.+-]+@[\w-]+\.[\w.]+/g,
  PHONE: /(?:\+91[\s-]?)?\b[6-9]\d{9}\b/g,
  LOG_PATHS: [
    "req.headers.authorization",
    "req.headers.cookie",
    "*.token",
    "*.password",
    "*.apiKey",
    "*.accountNumber",
    "*.secret",
  ],
} as const;
