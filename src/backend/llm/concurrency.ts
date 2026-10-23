import "server-only";

/**
 * Maps over `items` with at most `limit` calls in flight (e.g. LLM requests), keeping results in
 * input order. Rejects with the first error once the calls already started have settled.
 */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failure: { error: unknown } | null = null;
  async function worker() {
    while (!failure && next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index], index);
      } catch (error) {
        failure ??= { error };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  if (failure) throw (failure as { error: unknown }).error;
  return results;
}
