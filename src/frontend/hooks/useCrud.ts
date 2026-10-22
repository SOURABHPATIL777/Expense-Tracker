"use client";

import { useState } from "react";
import { api } from "@/frontend/lib/apiClient";
import { useApi } from "./useApi";
import { useMutation } from "./useMutation";

type Identified = { id: string };

/**
 * Shared state machine for list + create/edit modal + delete confirmation pages
 * (accounts, categories, rules, ...).
 */
export function useCrud<T extends Identified, Input>(opts: {
  collectionUrl: string;
  itemUrl: (id: string) => string;
  noun: string;
}) {
  const list = useApi<T[]>(opts.collectionUrl);
  const [editing, setEditing] = useState<T | "new" | null>(null);
  const [deleting, setDeleting] = useState<T | null>(null);

  const save = async (values: Input) => {
    if (editing && editing !== "new") await api.patch(opts.itemUrl(editing.id), values);
    else await api.post(opts.collectionUrl, values);
    setEditing(null);
    list.reload();
  };

  const remove = useMutation(
    async () => {
      if (!deleting) return;
      await api.del(opts.itemUrl(deleting.id));
      setDeleting(null);
      list.reload();
    },
    { successMessage: `${opts.noun} deleted` },
  );

  return {
    ...list,
    rows: list.data ?? [],
    editing: editing === "new" ? null : editing,
    isFormOpen: editing !== null,
    formTitle: editing === "new" ? `Add ${opts.noun.toLowerCase()}` : `Edit ${opts.noun.toLowerCase()}`,
    openCreate: () => setEditing("new"),
    openEdit: (row: T) => setEditing(row),
    closeForm: () => setEditing(null),
    save,
    deleting,
    askDelete: (row: T) => setDeleting(row),
    cancelDelete: () => setDeleting(null),
    confirmDelete: remove.run,
    deletePending: remove.pending,
  };
}
