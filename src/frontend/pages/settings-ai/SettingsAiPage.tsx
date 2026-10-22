"use client";

import { useState } from "react";
import { PageHeader } from "@/frontend/components/PageHeader/PageHeader";
import { Card } from "@/frontend/components/Card/Card";
import { Form } from "@/frontend/components/Form/Form";
import { FormField } from "@/frontend/components/Form/FormField";
import { Alert } from "@/frontend/components/Alert/Alert";
import { Badge } from "@/frontend/components/StatusBadge/StatusBadge";
import { Skeleton } from "@/frontend/components/Skeleton/Skeleton";
import { DateText } from "@/frontend/components/DateText/DateText";
import { useApi } from "@/frontend/hooks/useApi";
import { useToast } from "@/frontend/components/Toast/Toast";
import { api } from "@/frontend/lib/apiClient";
import { API_ROUTES } from "@/shared/constants/routes";
import { LLM_TASKS, type LlmProvider, type LlmTask } from "@/shared/constants/enums";
import { LLM_TASK_LABELS } from "@/shared/constants/labels";
import { llmConfigFormSchema, type LlmConfigDto, type LlmConfigForm, type LlmOptionsDto } from "@/shared/schemas/llm";
import styles from "./SettingsAiPage.module.css";

const TASK_HELP: Record<LlmTask, string> = {
  categorize: "Suggests categories for merchants your rules don't cover. Low-confidence answers go to Needs review.",
  monthly_summary: "Writes a short explanation of your month from totals we calculate (it never does the maths).",
  refund_message: "Drafts a polite support message for a refund you're still waiting on.",
};

function TaskCard({ task, options, config, onSaved }: { task: LlmTask; options: LlmOptionsDto; config?: LlmConfigDto; onSaved: () => void }) {
  const toast = useToast();
  const [provider, setProvider] = useState<LlmProvider>(config?.provider ?? "ollama");
  const meta = options.providers.find((p) => p.provider === provider)!;
  const defaults = options.defaults[task];

  async function save(values: LlmConfigForm) {
    await api.put(API_ROUTES.llmConfigs, { ...values, task });
    toast.show(values.enabled ? "Model checked and saved" : "Saved (AI off for this task)", "success");
    onSaved();
  }

  return (
    <Card
      title={LLM_TASK_LABELS[task]}
      description={TASK_HELP[task]}
      actions={config?.enabled ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>}
    >
      <div className={styles.cardBody}>
        {!meta.available && <Alert tone="warning">{meta.label} isn&apos;t configured on the server yet (missing API key or endpoint).</Alert>}
        {meta.cloud && (
          <Alert tone="info">
            {meta.label} runs in the provider&apos;s cloud. Transaction descriptions (with account numbers, phone numbers and emails removed) are sent to it only if you allow cloud processing below.
          </Alert>
        )}
        {/* key: re-mount the form so defaults follow the chosen provider */}
        <Form key={`${task}-${provider}`} schema={llmConfigFormSchema} onSubmit={save} submitLabel="Check model & save" layout="grid">
          <FormField
            name="provider"
            label="Provider"
            type="select"
            options={options.providers.map((p) => ({ value: p.provider, label: p.label }))}
            defaultValue={provider}
            onValueChange={(v) => setProvider(v as LlmProvider)}
          />
          <FormField
            name="model"
            label="Model"
            suggestions={meta.suggestedModels}
            defaultValue={config?.provider === provider ? config.model : meta.defaultModel}
            hint={provider === "ollama" ? "Models ending in :cloud run on Ollama's cloud and need cloud processing allowed." : "Pick a suggestion or type any model ID."}
            required
          />
          {provider === "ollama" && (
            <FormField
              name="endpointName"
              label="Ollama server"
              type="select"
              placeholder={options.ollamaEndpoints.length ? undefined : "No servers configured"}
              options={options.ollamaEndpoints.map((e) => ({ value: e, label: e }))}
              defaultValue={config?.endpointName ?? options.ollamaEndpoints[0]}
            />
          )}
          <FormField name="temperature" label="Temperature" type="number" step="0.1" min="0" max="2" defaultValue={config?.temperature ?? defaults.temperature} />
          <FormField name="maxOutputTokens" label="Max output tokens" type="number" min="64" max="8000" defaultValue={config?.maxOutputTokens ?? defaults.maxOutputTokens} />
          <FormField name="timeoutMs" label="Timeout (ms)" type="number" min="1000" max="120000" step="1000" defaultValue={config?.timeoutMs ?? 30000} />
          <FormField name="enabled" label="Use AI for this task" type="checkbox" defaultChecked={config?.enabled ?? true} />
          <FormField name="allowCloudProcessing" label="Allow cloud processing" type="checkbox" defaultChecked={config?.allowCloudProcessing ?? false} />
        </Form>
        {config?.lastTest && (
          <p className={styles.test}>
            Last check {config.lastTest.ok ? "passed" : "failed"} in {config.lastTest.latencyMs} ms
            {config.lastTestedAt && (
              <>
                {" "}
                · <DateText iso={config.lastTestedAt} withTime />
              </>
            )}
          </p>
        )}
      </div>
    </Card>
  );
}

export default function SettingsAiPage() {
  const options = useApi<LlmOptionsDto>(API_ROUTES.llmOptions);
  const configs = useApi<LlmConfigDto[]>(API_ROUTES.llmConfigs);

  return (
    <>
      <PageHeader
        title="AI models"
        description="AI is optional and only assists: totals, matching and settlements are always calculated without it. Every model is tested before it's saved."
      />
      {options.error && <Alert tone="danger">{options.error.message}</Alert>}
      {!options.data || configs.loading ? (
        <Skeleton lines={8} />
      ) : (
        <div className={styles.list}>
          {LLM_TASKS.map((task) => (
            <TaskCard key={task} task={task} options={options.data!} config={configs.data?.find((c) => c.task === task)} onSaved={configs.reload} />
          ))}
        </div>
      )}
    </>
  );
}
