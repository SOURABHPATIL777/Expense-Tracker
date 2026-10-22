"use client";

import { useMemo } from "react";
import { useApi } from "./useApi";
import type { Option } from "@/frontend/components/Select/Select";
import { API_ROUTES } from "@/shared/constants/routes";
import type { CategoryDto } from "@/shared/schemas/categories";

/** The user's categories plus lookup helpers, shared by every page that shows or picks a category. */
export function useCategories() {
  const state = useApi<CategoryDto[]>(API_ROUTES.categories);
  return useMemo(() => {
    const categories = state.data ?? [];
    const byId = new Map(categories.map((c) => [c.id, c]));
    const options: Option[] = categories.map((c) => ({ value: c.id, label: c.name }));
    return { ...state, categories, byId, options };
  }, [state]);
}
