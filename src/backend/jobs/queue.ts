import "server-only";
import type { Db } from "@/backend/supabase/clients";
import { PG_ERROR, TABLES } from "@/backend/constants/db.constants";
import type { JobType } from "@/backend/constants/enums.constants";
import { AppError } from "@/backend/errors/AppError";

export type EnqueueInput = {
  type: JobType;
  userId: string;
  payload: unknown;
  /** Same key = same job; re-enqueueing is a no-op (safe for retries). */
  idempotencyKey?: string;
  runAfter?: Date;
};

export async function enqueueJob(db: Db, job: EnqueueInput): Promise<void> {
  const { error } = await db.from(TABLES.JOBS).insert({
    type: job.type,
    user_id: job.userId,
    payload: job.payload,
    idempotency_key: job.idempotencyKey ?? null,
    run_after: (job.runAfter ?? new Date()).toISOString(),
  });
  if (error && error.code !== PG_ERROR.UNIQUE_VIOLATION) throw new AppError("INTERNAL", { internal: error });
}
