import "server-only";
import { getAdminClient } from "@/backend/supabase/clients";
import { TABLES } from "@/backend/constants/db.constants";
import type { LlmProvider, LlmTask } from "@/backend/constants/enums.constants";
import { unwrapMaybe } from "@/backend/errors/AppError";
import { logger } from "@/backend/logger/logger";
import { BaseRepository } from "./BaseRepository";
import type { LlmConfigRow } from "./types";

export class LlmConfigsRepository extends BaseRepository<LlmConfigRow> {
  protected readonly table = TABLES.LLM_CONFIGS;

  findForTask(userId: string, task: LlmTask) {
    return this.findOptional(userId, (q) => q.eq("task", task));
  }

  async upsertForTask(userId: string, values: Omit<Partial<LlmConfigRow>, "user_id">): Promise<LlmConfigRow> {
    const result = await this.from()
      .upsert({ ...values, user_id: userId }, { onConflict: "user_id,task" })
      .select()
      .single();
    return unwrapMaybe(result, "llmConfigs.upsert") as LlmConfigRow;
  }
}

export type AgentRunEntry = {
  userId: string;
  task: LlmTask;
  provider: LlmProvider;
  model: string;
  succeeded: boolean;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  error?: string;
};

/** Usage/latency log for every model call. Users can read theirs; only the server writes. */
export async function recordAgentRun(entry: AgentRunEntry): Promise<void> {
  const { error } = await getAdminClient().from(TABLES.AGENT_RUNS).insert({
    user_id: entry.userId,
    task: entry.task,
    provider: entry.provider,
    model: entry.model,
    succeeded: entry.succeeded,
    input_tokens: entry.inputTokens ?? null,
    output_tokens: entry.outputTokens ?? null,
    latency_ms: entry.latencyMs,
    error: entry.error?.slice(0, 500) ?? null,
  });
  if (error) logger.error({ err: error }, "agent run log failed");
}
