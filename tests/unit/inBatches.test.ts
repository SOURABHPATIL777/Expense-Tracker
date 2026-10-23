import { describe, expect, it } from "vitest";
import { chunkForInFilter, inBatches, IN_FILTER_MAX_CHARS } from "@/backend/repositories/inBatches";

describe("URL-safe .in() batches", () => {
  const fingerprints = Array.from({ length: 500 }, (_, i) => i.toString(16).padStart(64, "0"));

  it("splits a 500-row import step into chunks that fit the URL limit", () => {
    const chunks = chunkForInFilter(fingerprints);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat()).toEqual(fingerprints);
    for (const c of chunks) expect(c.join(",").length).toBeLessThan(IN_FILTER_MAX_CHARS);
  });

  it("dedupes, skips empty input and concatenates results", async () => {
    expect(chunkForInFilter([])).toEqual([]);
    expect(chunkForInFilter([1, 1, 2])).toEqual([[1, 2]]);
    const seen: number[] = [];
    const out = await inBatches(fingerprints, async (chunk) => {
      seen.push(chunk.length);
      return chunk.slice(0, 1);
    });
    expect(out).toHaveLength(seen.length);
  });
});
