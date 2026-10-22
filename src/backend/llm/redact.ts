import "server-only";
import { scrubText } from "@/backend/logger/logger";
import { REDACTION } from "@/backend/constants/security.constants";

/**
 * Strips account numbers, phone numbers, emails and long references before text reaches a model.
 * Merchant names and UPI handles stay: they are what categorisation needs.
 */
export function redactForLlm(text: string | null | undefined): string {
  return text ? scrubText(text).slice(0, 300) : "";
}

/**
 * Lighter redaction for reading statement rows: emails, phone numbers and masked account numbers
 * go, but transaction references (UTRs) stay, because they are what links an app payment to the
 * same payment in a bank statement.
 */
export function redactForExtraction(text: string): string {
  return text.replace(REDACTION.EMAIL, "[email]").replace(REDACTION.PHONE, "[phone]").replace(REDACTION.MASKED_ACCOUNT, "[acct]");
}
