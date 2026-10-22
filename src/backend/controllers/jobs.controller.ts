import "server-only";
import { withHandler } from "@/backend/http/withHandler";
import { AUTH_MODES } from "@/backend/constants/enums.constants";
import { runWorker } from "@/backend/jobs/worker";

export const jobsController = {
  /** Vercel Cron backstop; uploads also kick the worker directly via `after()`. */
  run: withHandler({ auth: AUTH_MODES.CRON }, async () => runWorker()),
};
