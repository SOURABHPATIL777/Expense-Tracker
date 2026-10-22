import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/frontend/lib/apiClient";

const fetchMock = vi.fn();
const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
const dropped = () => Promise.reject(new TypeError("Failed to fetch"));

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Runs a request while letting retry delays elapse. */
async function settle<T>(p: Promise<T>) {
  const result = p.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.advanceTimersByTimeAsync(5_000);
  return result;
}

describe("apiClient", () => {
  it("retries a GET whose connection dropped, then succeeds", async () => {
    fetchMock.mockImplementationOnce(dropped).mockImplementationOnce(dropped).mockResolvedValueOnce(ok({ id: 1 }));
    const out = await settle(api.get("/api/v1/x"));
    expect(out).toEqual({ value: { data: { id: 1 }, meta: undefined } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up after the retries with a network error", async () => {
    fetchMock.mockImplementation(dropped);
    const out = await settle(api.get("/api/v1/x"));
    expect(out).toMatchObject({ error: { code: "NETWORK" } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a plain POST (it might have been applied)", async () => {
    fetchMock.mockImplementation(dropped);
    const out = await settle(api.post("/api/v1/x", {}));
    expect(out).toMatchObject({ error: { code: "NETWORK" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a POST that carries an idempotency key or opts in", async () => {
    fetchMock.mockImplementationOnce(dropped).mockResolvedValueOnce(ok(null)).mockImplementationOnce(dropped).mockResolvedValueOnce(ok(null));
    await settle(api.post("/api/v1/x", {}, { idempotencyKey: "k" }));
    await settle(api.post("/api/v1/y", undefined, { retry: true }));
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("reports a redirect (e.g. a hosting login page) as an expired session", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 302, headers: { Location: "https://vercel.com/sso-api" } }));
    const out = await settle(api.get("/api/v1/x"));
    expect(out).toMatchObject({ error: { code: "SESSION_REDIRECT" } });
  });
});
