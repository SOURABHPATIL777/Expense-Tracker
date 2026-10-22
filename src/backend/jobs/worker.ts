import "server-only";
import { after } from "next/server";
import { getAdminClient, type Db } from "@/backend/supabase/clients";
import { RPC, TABLES } from "@/backend/constants/db.constants";
import { JOBS } from "@/backend/constants/app.constants";
import type { JobType } from "@/backend/constants/enums.constants";
import { childLogger, logger, scrubText } from "@/backend/logger/logger";
import { backoffSeconds } from "./defineJob";
import { enqueueJob } from "./queue";
import { JOB_REGISTRY } from "./registry";

type ClaimedJob = { id: string; type: JobType; user_id: string; payload: unknown; attempts: number };

/**
 * Claims jobs with SKIP LOCKED and runs them until the time budget is spent. Safe to run
 * concurrently from several invocations (post-upload and traffic-triggered passes).
 */
export async function runWorker({ budgetMs = JOBS.WORKER_BUDGET_MS }: { budgetMs?: number } = {}): Promise<{ processed: number; failed: number }> {
  const db = getAdminClient();
  const deadline = Date.now() + budgetMs;
  let processed = 0;
  let failed = 0;

  while (Date.now() < deadline) {
    const { data, error } = await db.rpc(RPC.CLAIM_JOBS, { p_limit: JOBS.BATCH_SIZE, p_lock_seconds: JOBS.LOCK_SECONDS });
    if (error) {
      logger.error({ err: error }, "claim_jobs failed");
      break;
    }
    const jobs = (data ?? []) as ClaimedJob[];
    if (jobs.length === 0) break;
    for (const job of jobs) {
      const ok = await execute(db, job);
      processed += 1;
      if (!ok) failed += 1;
    }
  }
  return { processed, failed };
}

async function execute(db: Db, job: ClaimedJob): Promise<boolean> {
  const log = childLogger({ jobId: job.id, jobType: job.type, userId: job.user_id, attempt: job.attempts });
  const definition = JOB_REGISTRY[job.type];
  try {
    if (!definition) throw new Error(`No handler registered for job type ${job.type}`);
    const payload = definition.payload.parse(job.payload);
    await definition.run(payload, {
      db,
      log,
      userId: job.user_id,
      jobId: job.id,
      attempt: job.attempts,
      enqueue: (next) => enqueueJob(db, { ...next, userId: job.user_id }),
    });
    await db.from(TABLES.JOBS).update({ status: "succeeded", finished_at: new Date().toISOString(), last_error: null }).eq("id", job.id);
    log.info("job succeeded");
    return true;
  } catch (err) {
    const message = scrubText(err instanceof Error ? err.message : String(err)).slice(0, 500);
    const maxAttempts = definition?.maxAttempts ?? 1;
    const dead = job.attempts >= maxAttempts;
    await db
      .from(TABLES.JOBS)
      .update({
        status: dead ? "dead" : "queued",
        last_error: message,
        locked_until: null,
        run_after: new Date(Date.now() + backoffSeconds(job.attempts) * 1000).toISOString(),
        finished_at: dead ? new Date().toISOString() : null,
      })
      .eq("id", job.id);
    log.error({ err, dead }, "job failed");
    return false;
  }
}

/** Starts a short worker pass after the current response is sent. */
export function kickWorker(budgetMs: number = JOBS.WORKER_BUDGET_MS): void {
  after(() => runWorker({ budgetMs }).catch((err) => logger.error({ err }, "worker kick failed")));
}

let lastOpportunisticKick = 0;

/**
 * The app's own scheduler (no external cron): normal user traffic sweeps up retried or
 * interrupted jobs. Throttled per server instance; a pass with nothing ready costs one query.
 */
export function kickWorkerOpportunistically(now = Date.now()): void {
  if (now - lastOpportunisticKick < JOBS.OPPORTUNISTIC_INTERVAL_MS) return;
  lastOpportunisticKick = now;
  // A pass that's already running (e.g. reading a PDF with the LLM after an upload) picks up the
  // rest itself; stacking another long pass onto ordinary requests like polls only adds load.
  after(() =>
    workerBusy()
      .then((busy) => (busy ? undefined : runWorker({ budgetMs: JOBS.OPPORTUNISTIC_BUDGET_MS })))
      .catch((err) => logger.error({ err }, "opportunistic worker failed")),
  );
}

/** True while some worker holds a live lock on a job. */
async function workerBusy(): Promise<boolean> {
  const { count, error } = await getAdminClient()
    .from(TABLES.JOBS)
    .select("id", { count: "exact", head: true })
    .eq("status", "running")
    .gt("locked_until", new Date().toISOString());
  if (error) throw error;
  return (count ?? 0) > 0;
}
