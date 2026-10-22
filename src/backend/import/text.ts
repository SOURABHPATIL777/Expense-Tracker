import "server-only";

/** Lower-case, collapse whitespace, strip punctuation: "Withdrawal Amt. (INR)" → "withdrawal amt inr". */
export function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function cleanCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

/** Signature of a header row used to recognise a saved template next time. */
export function headerSignature(header: string[]): string {
  return header.map(normalizeHeader).filter(Boolean).join("|");
}

export const nullIfEmpty = (v: string | undefined | null): string | null => {
  const t = v?.trim();
  return t ? t : null;
};
