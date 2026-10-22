import "server-only";
import pino, { type Logger } from "pino";
import { REDACTION } from "@/backend/constants/security.constants";

export type { Logger };

/** Removes account numbers, phone numbers, emails and long references from free text. */
export function scrubText(text: string): string {
  return text
    .replace(REDACTION.EMAIL, "[email]")
    .replace(REDACTION.PHONE, "[phone]")
    .replace(REDACTION.MASKED_ACCOUNT, "[acct]")
    .replace(REDACTION.LONG_DIGITS, "[num]");
}

export const logger: Logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "upi-spend-tracker" },
  redact: { paths: [...REDACTION.LOG_PATHS], censor: "[redacted]" },
  formatters: { level: (label) => ({ level: label }) },
  timestamp: pino.stdTimeFunctions.isoTime,
  hooks: {
    // Scrub the message string itself; structured fields are covered by `redact`.
    logMethod(args, method) {
      if (typeof args[0] === "string") args[0] = scrubText(args[0]);
      else if (typeof args[1] === "string") args[1] = scrubText(args[1]);
      return method.apply(this, args as Parameters<typeof method>);
    },
  },
});

export const childLogger = (bindings: Record<string, unknown>) => logger.child(bindings);
