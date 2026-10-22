// Fail fast: validate configuration once when the server boots instead of on the first request.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getEnv } = await import("@/backend/config/env");
    getEnv();

    // Background work (after()) shares server instances with live requests. A stray rejection or
    // exception there (an aborted AI stream, a PDF parser error) must be logged, never allowed to
    // exit the process and drop every request on that instance.
    const { logger } = await import("@/backend/logger/logger");
    process.on("unhandledRejection", (reason) => logger.error({ err: reason }, "unhandled rejection"));
    process.on("uncaughtException", (err) => logger.error({ err }, "uncaught exception"));
  }
}
