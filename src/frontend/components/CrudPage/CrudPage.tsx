"use client";

import type { ReactNode } from "react";
import type { ZodType } from "zod";
import { PageHeader } from "@/frontend/components/PageHeader/PageHeader";
import { Card } from "@/frontend/components/Card/Card";
import { Button } from "@/frontend/components/Button/Button";
import { DataTable, type Column } from "@/frontend/components/DataTable/DataTable";
import { FormModal } from "@/frontend/components/FormModal/FormModal";
import { ConfirmDialog } from "@/frontend/components/ConfirmDialog/ConfirmDialog";
import { RowActions } from "@/frontend/components/RowActions/RowActions";
import type { useCrud } from "@/frontend/hooks/useCrud";
import styles from "./CrudPage.module.css";

type CrudPageProps<T extends { id: string }, I> = {
  crud: ReturnType<typeof useCrud<T, I>>;
  title: string;
  description?: ReactNode;
  addLabel: string;
  /** Extra header buttons shown before "Add". */
  headerActions?: ReactNode;
  columns: Column<T>[];
  empty: { title: string; description?: ReactNode };
  /** Validates the raw form; its output is what the API accepts as `I`. */
  formSchema: ZodType;
  /** Form fields; `editing` is the row being edited, or null when creating. */
  renderFields: (editing: T | null) => ReactNode;
  deleteTitle: (row: T) => string;
  deleteMessage: ReactNode;
};

/** List + create/edit modal + delete confirmation: the shape of every settings-style page. */
export function CrudPage<T extends { id: string }, I>(props: CrudPageProps<T, I>) {
  const { crud } = props;
  const add = <Button onClick={crud.openCreate}>{props.addLabel}</Button>;
  const columns: Column<T>[] = [
    ...props.columns,
    { key: "actions", header: "", align: "right", render: (row) => <RowActions onEdit={() => crud.openEdit(row)} onDelete={() => crud.askDelete(row)} /> },
  ];

  return (
    <>
      <PageHeader
        title={props.title}
        description={props.description}
        actions={
          <div className={styles.actions}>
            {props.headerActions}
            {add}
          </div>
        }
      />
      <Card padded={false}>
        <DataTable
          columns={columns}
          rows={crud.rows}
          rowKey={(row) => row.id}
          loading={crud.loading}
          error={crud.error}
          empty={{ ...props.empty, action: add }}
        />
      </Card>

      <FormModal open={crud.isFormOpen} title={crud.formTitle} schema={props.formSchema} onSubmit={(values) => crud.save(values as I)} onClose={crud.closeForm}>
        {props.renderFields(crud.editing)}
      </FormModal>

      <ConfirmDialog
        open={crud.deleting !== null}
        title={crud.deleting ? props.deleteTitle(crud.deleting) : ""}
        message={props.deleteMessage}
        confirmLabel="Delete"
        destructive
        pending={crud.deletePending}
        onConfirm={crud.confirmDelete}
        onCancel={crud.cancelDelete}
      />
    </>
  );
}
