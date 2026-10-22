// Fail fast: validate configuration once when the server boots instead of on the first request.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getEnv } = await import("@/backend/config/env");
    getEnv();
  }
}
