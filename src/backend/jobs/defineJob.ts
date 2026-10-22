import "server-only";
import type { ZodType, z } from "zod";
import type { Db } from "@/backend/supabase/clients";
import type { Logger } from "@/backend/logger/logger";
import type { JobType } from "@/backend/constants/enums.constants";
import { JOBS } from "@/backend/constants/app.constants";

export type JobContext = {
  db: Db;
  log: Logger;
  userId: string;
  jobId: string;
  attempt: number;
  /** Enqueue a follow-up job (e.g. the next chunk of a large import). */
  enqueue: (job: { type: JobType; payload: unknown; idempotencyKey?: string }) => Promise<void>;
};

export type JobDefinition<S extends ZodType = ZodType> = {
  type: JobType;
  payload: S;
  maxAttempts: number;
  run: (payload: z.infer<S>, ctx: JobContext) => Promise<void>;
  /** Called once when the job gives up for good, so whatever it was working on isn't left "in progress". */
  onDead?: (payload: z.infer<S>, ctx: JobContext) => Promise<void>;
};

/** Every background job is declared through this so retries, validation and logging are uniform. */
export function defineJob<S extends ZodType>(def: {
  type: JobType;
  payload: S;
  maxAttempts?: number;
  run: (payload: z.infer<S>, ctx: JobContext) => Promise<void>;
  onDead?: (payload: z.infer<S>, ctx: JobContext) => Promise<void>;
}): JobDefinition<S> {
  return { maxAttempts: JOBS.DEFAULT_MAX_ATTEMPTS, ...def };
}

/** Exponential backoff with full jitter, capped. */
export function backoffSeconds(attempt: number): number {
  const ceiling = Math.min(JOBS.BACKOFF_MAX_SECONDS, JOBS.BACKOFF_BASE_SECONDS * 2 ** Math.max(0, attempt - 1));
  return Math.ceil(ceiling / 2 + Math.random() * (ceiling / 2));
}
