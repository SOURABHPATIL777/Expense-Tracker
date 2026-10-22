"use client";

import { CrudPage } from "@/frontend/components/CrudPage/CrudPage";
import type { Column } from "@/frontend/components/DataTable/DataTable";
import { Button } from "@/frontend/components/Button/Button";
import { FormField } from "@/frontend/components/Form/FormField";
import { CategoryChip } from "@/frontend/components/CategoryChip/CategoryChip";
import { Badge, StatusBadge } from "@/frontend/components/StatusBadge/StatusBadge";
import { optionsFrom } from "@/frontend/components/Select/Select";
import { useCrud } from "@/frontend/hooks/useCrud";
import { useCategories } from "@/frontend/hooks/useCategories";
import { useMutation } from "@/frontend/hooks/useMutation";
import { api } from "@/frontend/lib/apiClient";
import { API_ROUTES } from "@/shared/constants/routes";
import { RULE_FIELDS, RULE_OPERATORS, TRANSACTION_KINDS } from "@/shared/constants/enums";
import { RULE_FIELD_LABELS, RULE_OPERATOR_LABELS, TRANSACTION_KIND_LABELS } from "@/shared/constants/labels";
import { ruleFormSchema, type RuleDto, type RuleInput } from "@/shared/schemas/categories";
import styles from "./RulesPage.module.css";

export default function RulesPage() {
  const crud = useCrud<RuleDto, RuleInput>({ collectionUrl: API_ROUTES.rules, itemUrl: API_ROUTES.rule, noun: "Rule" });
  const cats = useCategories();
  const apply = useMutation(() => api.post(API_ROUTES.rulesApply), { successMessage: "Re-applying rules to your transactions in the background" });

  const columns: Column<RuleDto>[] = [
    {
      key: "when",
      header: "When",
      render: (r) => (
        <span>
          {RULE_FIELD_LABELS[r.field]} {RULE_OPERATOR_LABELS[r.operator]} <code className={styles.pattern}>{r.pattern}</code>
        </span>
      ),
    },
    {
      key: "then",
      header: "Then",
      render: (r) => (
        <div className={styles.then}>
          {r.categoryId && <CategoryChip category={cats.byId.get(r.categoryId)} />}
          {r.transactionKind && <StatusBadge value={r.transactionKind} map={TRANSACTION_KIND_LABELS} />}
        </div>
      ),
    },
    { key: "priority", header: "Priority", align: "right", hideOnMobile: true, render: (r) => r.priority },
    { key: "active", header: "", render: (r) => !r.isActive && <Badge>Paused</Badge> },
  ];

  return (
    <CrudPage
      crud={crud}
      title="Rules"
      description="Rules run before AI and always win. Lower priority numbers run first. Transactions you changed by hand are never touched."
      addLabel="Add rule"
      headerActions={
        <Button variant="secondary" onClick={() => apply.run()} loading={apply.pending}>
          Re-apply to existing
        </Button>
      }
      columns={columns}
      empty={{ title: "No rules yet", description: "Example: when the UPI ID is exactly landlord@okicici, mark it as Rent." }}
      formSchema={ruleFormSchema}
      renderFields={(e) => (
        <>
          <FormField name="field" label="Look at" type="select" options={optionsFrom(RULE_FIELDS, RULE_FIELD_LABELS)} defaultValue={e?.field ?? "merchant"} />
          <FormField name="operator" label="Match" type="select" options={optionsFrom(RULE_OPERATORS, RULE_OPERATOR_LABELS)} defaultValue={e?.operator ?? "contains"} />
          <FormField name="pattern" label="Text" placeholder="e.g. swiggy" defaultValue={e?.pattern} hint="Not case sensitive." required />
          <FormField name="categoryId" label="Set category" type="select" placeholder="Don't change" options={cats.options} defaultValue={e?.categoryId ?? ""} />
          <FormField
            name="transactionKind"
            label="Set type"
            type="select"
            placeholder="Use the category's default"
            options={optionsFrom(TRANSACTION_KINDS, TRANSACTION_KIND_LABELS)}
            defaultValue={e?.transactionKind ?? ""}
          />
          <FormField name="priority" label="Priority" type="number" min="0" max="1000" defaultValue={e?.priority ?? 100} />
          <FormField name="isActive" label="Active" type="checkbox" defaultChecked={e?.isActive ?? true} />
        </>
      )}
      deleteTitle={() => "Delete rule?"}
      deleteMessage="Transactions it already categorised keep their category until you re-apply rules."
    />
  );
}
