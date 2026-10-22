"use client";

import { useApi } from "@/frontend/hooks/useApi";
import { useImportEvents } from "@/frontend/hooks/useImportEvents";
import { API_ROUTES } from "@/shared/constants/routes";
import type { ImportDto } from "@/shared/schemas/imports";

/** The user's imports that are uploading, being read or being matched; refreshed by socket events. */
export function useActiveImports(): ImportDto[] {
  const active = useApi<ImportDto[]>(API_ROUTES.imports, { active: "true", pageSize: 5 });
  useImportEvents(active.reload);
  return active.data ?? [];
}
