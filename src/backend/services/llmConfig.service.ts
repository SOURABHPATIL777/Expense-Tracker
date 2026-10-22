import "server-only";
import type { Db } from "@/backend/supabase/clients";
import { AppError } from "@/backend/errors/AppError";
import { getEnv } from "@/backend/config/env";
import { LLM_PROVIDERS, LLM_TASKS } from "@/backend/constants/enums.constants";
import { DEFAULT_MODELS, SUGGESTED_MODELS, TASK_DEFAULTS } from "@/backend/constants/llm.constants";
import { LlmConfigsRepository } from "@/backend/repositories/llm.repository";
import { toLlmConfigDto } from "@/backend/mappers/transactions.mapper";
import { isCloudModel, providerAvailable } from "@/backend/llm/registry";
import { testModel } from "@/backend/llm/capabilities";
import { audit } from "./auditLog";
import { AUDIT_ACTIONS } from "@/backend/constants/enums.constants";
import { LLM_PROVIDER_LABELS } from "@/shared/constants/labels";
import type { LlmConfigDto, LlmConfigInput, LlmOptionsDto, LlmTestInput, LlmTestResultDto } from "@/shared/schemas/llm";

export function llmConfigService(db: Db) {
  const repo = new LlmConfigsRepository(db);

  const test = (userId: string, input: LlmTestInput): Promise<LlmTestResultDto> =>
    testModel(db, userId, {
      provider: input.provider,
      model: input.model,
      endpoint_name: input.endpointName ?? null,
      allow_cloud_processing: input.allowCloudProcessing,
    });

  return {
    options(): LlmOptionsDto {
      return {
        providers: LLM_PROVIDERS.map((p) => ({
          provider: p,
          label: LLM_PROVIDER_LABELS[p],
          available: providerAvailable(p),
          cloud: isCloudModel({ provider: p, model: DEFAULT_MODELS[p] }),
          defaultModel: DEFAULT_MODELS[p],
          suggestedModels: [...SUGGESTED_MODELS[p]],
        })),
        ollamaEndpoints: Object.keys(getEnv().OLLAMA_ENDPOINTS),
        defaults: TASK_DEFAULTS,
      };
    },

    async list(userId: string): Promise<LlmConfigDto[]> {
      const rows = await repo.listAll(userId);
      return LLM_TASKS.flatMap((task) => rows.filter((r) => r.task === task).map(toLlmConfigDto));
    },

    test,

    /** An enabled config is saved only after the model passes a live structured-output test. */
    async save(userId: string, input: LlmConfigInput): Promise<LlmConfigDto> {
      if (input.provider === "ollama" && input.endpointName && !(input.endpointName in getEnv().OLLAMA_ENDPOINTS)) {
        throw new AppError("VALIDATION", { message: "That Ollama endpoint is not on the server's allowlist." });
      }
      const result = input.enabled ? await test(userId, input) : null;
      if (result && !result.ok) {
        throw new AppError("VALIDATION", { message: `Model check failed: ${result.error ?? "unknown error"}`, details: { test: result } });
      }
      const row = await repo.upsertForTask(userId, {
        task: input.task,
        enabled: input.enabled,
        provider: input.provider,
        model: input.model,
        endpoint_name: input.provider === "ollama" ? (input.endpointName ?? null) : null,
        temperature: input.temperature,
        max_output_tokens: input.maxOutputTokens,
        timeout_ms: input.timeoutMs,
        allow_cloud_processing: input.allowCloudProcessing,
        ...(result && { last_tested_at: new Date().toISOString(), test_result: result }),
      });
      await audit(db, { userId, action: AUDIT_ACTIONS.LLM_CONFIG_UPDATED, entityType: "llm_config", entityId: row.id, metadata: { task: row.task, provider: row.provider, model: row.model } });
      return toLlmConfigDto(row);
    },
  };
}
