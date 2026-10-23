import "server-only";

/**
 * Filters like `.in("fingerprint", values)` travel in the request URL, and Supabase's gateway
 * rejects long URLs ("Bad Request"). Values are split into chunks of at most this many characters.
 */
export const IN_FILTER_MAX_CHARS = 4_000;

/** Splits values so each chunk's `in.(...)` list stays under IN_FILTER_MAX_CHARS. */
export function chunkForInFilter<T extends string | number>(values: readonly T[], maxChars = IN_FILTER_MAX_CHARS): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let size = 0;
  for (const v of new Set(values)) {
    // Each value is quoted and comma-separated in the URL, and may be percent-encoded.
    const cost = String(v).length * 1.5 + 3;
    if (current.length && size + cost > maxChars) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(v);
    size += cost;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/** Runs one query per URL-safe chunk of `values` and concatenates the rows. */
export async function inBatches<T extends string | number, R>(values: readonly T[], run: (chunk: T[]) => Promise<R[]>): Promise<R[]> {
  const out: R[] = [];
  for (const chunk of chunkForInFilter(values)) out.push(...(await run(chunk)));
  return out;
}
