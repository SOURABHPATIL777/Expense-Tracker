import "server-only";
import { scrubText } from "@/backend/logger/logger";

/**
 * Strips account numbers, phone numbers, emails and long references before text reaches a model.
 * Merchant names and UPI handles stay: they are what categorisation needs.
 */
export function redactForLlm(text: string | null | undefined): string {
  return text ? scrubText(text).slice(0, 300) : "";
}
