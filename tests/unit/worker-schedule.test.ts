import { describe, expect, it, vi } from "vitest";

const after = vi.fn();
vi.mock("next/server", () => ({ after: (fn: () => void) => after(fn) }));

const { kickWorkerOpportunistically } = await import("@/backend/jobs/worker");

describe("kickWorkerOpportunistically", () => {
  it("starts at most one background pass per interval per instance", () => {
    const t0 = 1_000_000_000_000;
    kickWorkerOpportunistically(t0);
    kickWorkerOpportunistically(t0 + 1_000);
    kickWorkerOpportunistically(t0 + 59_999);
    expect(after).toHaveBeenCalledTimes(1);
    kickWorkerOpportunistically(t0 + 60_000);
    expect(after).toHaveBeenCalledTimes(2);
  });
});
