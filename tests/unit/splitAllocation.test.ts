import { describe, expect, it } from "vitest";
import { allocateSplit, SplitError } from "@/shared/utils/splitAllocation";
import { createSplitSchema } from "@/shared/schemas/splits";

describe("allocateSplit", () => {
  it("splits equally and hands leftover paise to the first people", () => {
    expect(allocateSplit(100000, "equal", [undefined, undefined, undefined])).toEqual([33334, 33333, 33333]);
    expect(allocateSplit(200000, "equal", [undefined, undefined, undefined, undefined])).toEqual([50000, 50000, 50000, 50000]);
  });

  it("splits by percentage with the largest-remainder method", () => {
    const shares = allocateSplit(100001, "percent", [33.33, 33.33, 33.34]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100001);
    expect(shares).toEqual([33330, 33330, 33341]);
  });

  it.each([
    ["percent", [50, 40]],
    ["exact", [50000, 40000]],
    ["exact", [50000, undefined]],
  ] as const)("rejects %s values that don't add up", (method, values) => {
    expect(() => allocateSplit(100000, method, [...values])).toThrow(SplitError);
  });

  it("accepts exact shares that sum to the total", () => {
    expect(allocateSplit(100000, "exact", [25000, 75000])).toEqual([25000, 75000]);
  });
});

describe("createSplitSchema", () => {
  const base = { title: "Dinner", totalMinor: 200000, method: "equal" as const };
  it("needs the owner exactly once", () => {
    const noOwner = createSplitSchema.safeParse({ ...base, participants: [{ displayName: "A", isOwner: false }, { displayName: "B", isOwner: false }] });
    expect(noOwner.success).toBe(false);
    const ok = createSplitSchema.safeParse({ ...base, participants: [{ displayName: "You", isOwner: true }, { displayName: "Rahul", isOwner: false }] });
    expect(ok.success).toBe(true);
  });
});
