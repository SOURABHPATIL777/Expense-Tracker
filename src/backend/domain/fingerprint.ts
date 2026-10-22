import "server-only";
import { createHash } from "node:crypto";
import type { ParsedEvent } from "@/backend/import/types";

export const sha256Hex = (input: string | Buffer) => createHash("sha256").update(input).digest("hex");

/**
 * Identity of a statement row across re-imports and overlapping statements from the same source.
 * `occurrence` disambiguates genuinely identical rows within one file (two ₹20 teas, same minute).
 */
export function eventFingerprint(sourceApp: string, e: ParsedEvent, occurrence: number): string {
  return sha256Hex(
    [
      sourceApp,
      e.occurredAt,
      e.amountMinor,
      e.direction,
      e.referenceId ?? "",
      e.appTransactionId ?? "",
      (e.narration ?? "").toLowerCase(),
      e.balanceMinor ?? "",
      occurrence,
    ].join("|"),
  );
}

/** Assigns fingerprints to a file's events, numbering exact repeats so each row stays distinct. */
export function fingerprintAll(sourceApp: string, events: ParsedEvent[]): string[] {
  const seen = new Map<string, number>();
  return events.map((e) => {
    const base = eventFingerprint(sourceApp, e, 0);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : eventFingerprint(sourceApp, e, n);
  });
}
