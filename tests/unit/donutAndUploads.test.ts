import { describe, expect, it, vi } from "vitest";
import { foldSlices, layoutSlices, percentLabel, OTHER_KEY } from "@/frontend/components/DonutChart/geometry";
import { UploadQueue, type UploadItem } from "@/frontend/lib/uploadQueue";
import { ApiError } from "@/frontend/lib/apiClient";

const item = (key: string, value: number) => ({ key, label: key, value });

describe("donut geometry", () => {
  it("keeps the largest slices and folds the tail into Other", () => {
    const out = foldSlices([item("a", 5), item("b", 50), item("c", 1), item("d", 20), item("e", 0)], 3);
    expect(out.map((s) => [s.key, s.value])).toEqual([
      ["b", 50],
      ["d", 20],
      [OTHER_KEY, 6],
    ]);
  });

  it("does not fold when everything fits, and drops non-positive values", () => {
    expect(foldSlices([item("a", 1), item("b", -2), item("c", 3)], 8).map((s) => s.key)).toEqual(["c", "a"]);
  });

  it("lays slices clockwise from 12 o'clock covering the full circle", () => {
    const slices = layoutSlices([item("a", 3), item("b", 1)]);
    expect(slices[0].start).toBeCloseTo(-Math.PI / 2);
    expect(slices.at(-1)!.end).toBeCloseTo(Math.PI * 1.5);
    expect(slices.map((s) => s.share)).toEqual([0.75, 0.25]);
    expect(slices.map((s) => s.color)).toEqual(["var(--chart-1)", "var(--chart-2)"]);
  });

  it("handles an empty or zero total", () => {
    expect(layoutSlices([])).toEqual([]);
    expect(layoutSlices([item("a", 0)])).toEqual([]);
    expect(percentLabel(0.004)).toBe("<1%");
    expect(percentLabel(0.256)).toBe("26%");
  });
});

describe("UploadQueue", () => {
  const file = (name: string) => new File(["x"], name);

  it("uploads at most two at a time and reports each file's result", async () => {
    let running = 0;
    let peak = 0;
    const resolvers: Array<() => void> = [];
    const upload = vi.fn(async (f: File) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise<void>((r) => resolvers.push(r));
      running -= 1;
      if (f.name === "bad.csv") throw new ApiError("CONFLICT", "You've already imported this exact file.", 409, undefined, { importId: "imp-9" });
      return { id: `imp-${f.name}` } as never;
    });
    let items: UploadItem[] = [];
    const queue = new UploadQueue(upload, (next) => (items = next));
    const ids = queue.add([file("a.csv"), file("bad.csv"), file("c.pdf")]);
    expect(ids).toHaveLength(3);
    expect(items.map((i) => i.status)).toEqual(["uploading", "uploading", "queued"]);

    while (resolvers.length) {
      resolvers.shift()!();
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(peak).toBe(2);
    expect(items.map((i) => i.status)).toEqual(["done", "error", "done"]);
    expect(items[1]).toMatchObject({ error: "You've already imported this exact file.", existingImportId: "imp-9" });
  });

  it("retries a failed file and clears finished rows", async () => {
    const upload = vi.fn().mockRejectedValueOnce(new ApiError("NETWORK", "Could not reach the server.", 0)).mockResolvedValueOnce({ id: "imp-1" });
    let items: UploadItem[] = [];
    const queue = new UploadQueue(upload, (next) => (items = next));
    const [id] = queue.add([file("a.csv")]);
    await vi.waitFor(() => expect(items[0].status).toBe("error"));
    queue.retry(id);
    await vi.waitFor(() => expect(items[0].status).toBe("done"));
    queue.clearFinished();
    expect(items).toEqual([]);
  });
});
