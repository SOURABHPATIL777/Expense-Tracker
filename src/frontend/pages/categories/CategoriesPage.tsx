"use client";

import { CrudPage } from "@/frontend/components/CrudPage/CrudPage";
import type { Column } from "@/frontend/components/DataTable/DataTable";
import { FormField } from "@/frontend/components/Form/FormField";
import { CategoryChip } from "@/frontend/components/CategoryChip/CategoryChip";
import { Badge, StatusBadge } from "@/frontend/components/StatusBadge/StatusBadge";
import { optionsFrom } from "@/frontend/components/Select/Select";
import { useCrud } from "@/frontend/hooks/useCrud";
import { API_ROUTES } from "@/shared/constants/routes";
import { TRANSACTION_KINDS } from "@/shared/constants/enums";
import { TRANSACTION_KIND_LABELS } from "@/shared/constants/labels";
import { categoryFormSchema, type CategoryDto, type CategoryInput } from "@/shared/schemas/categories";
import styles from "./CategoriesPage.module.css";

const columns: Column<CategoryDto>[] = [
  { key: "name", header: "Category", render: (c) => <CategoryChip category={c} /> },
  { key: "kind", header: "Counts as", render: (c) => <StatusBadge value={c.kindHint} map={TRANSACTION_KIND_LABELS} /> },
  { key: "system", header: "", hideOnMobile: true, render: (c) => c.isSystem && <Badge>Default</Badge> },
];

export default function CategoriesPage() {
  const crud = useCrud<CategoryDto, CategoryInput>({ collectionUrl: API_ROUTES.categories, itemUrl: API_ROUTES.category, noun: "Category" });
  return (
    <CrudPage
      crud={crud}
      title="Categories"
      description={
        <>
          “Counts as” decides how money in a category is totalled. For example, <em>Investments</em> counts as your own transfer, not spending.
        </>
      }
      addLabel="Add category"
      columns={columns}
      empty={{ title: "No categories" }}
      formSchema={categoryFormSchema}
      renderFields={(e) => (
        <>
          <FormField name="name" label="Name" defaultValue={e?.name} required />
          <FormField name="kindHint" label="Counts as" type="select" options={optionsFrom(TRANSACTION_KINDS, TRANSACTION_KIND_LABELS)} defaultValue={e?.kindHint ?? "expense"} />
          <FormField name="color" label="Colour" type="color" defaultValue={e?.color ?? "#3b5bdb"} />
        </>
      )}
      deleteTitle={(c) => `Delete “${c.name}”?`}
      deleteMessage={<span className={styles.message}>Transactions in this category become uncategorised. Rules that use it are deleted.</span>}
    />
  );
}
