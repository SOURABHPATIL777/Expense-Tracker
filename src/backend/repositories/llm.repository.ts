import "server-only";
import { getAdminClient } from "@/backend/supabase/clients";
import { TABLES } from "@/backend/constants/db.constants";
import type { LlmTask } from "@/backend/constants/enums.constants";
import { logger } from "@/backend/logger/logger";

export type AgentRunEntry = {
  userId: string;
  task: LlmTask;
  provider: "ollama";
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
