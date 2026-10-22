import "server-only";
import { presetById } from "@/backend/import/presets";
import type { ParsedEvent } from "@/backend/import/types";
import type { ImportRow, RawEventRow } from "@/backend/repositories/types";
import type { ImportDto, ImportRowDto } from "@/shared/schemas/imports";

export function toImportDto(r: ImportRow): ImportDto {
  const preset = r.preset_id ? presetById(r.preset_id) : null;
  const isMapping = Boolean(r.preset_id?.startsWith("template:") || r.preset_id?.startsWith("mapping:"));
  return {
    id: r.id,
    fileName: r.file_name,
    fileSize: r.file_size,
    sourceKind: r.source_kind,
    sourceApp: r.source_app as ImportDto["sourceApp"],
    accountId: r.account_id,
    status: r.status,
    presetId: r.preset_id,
    presetLabel: preset?.label ?? (isMapping ? "Your column mapping" : null),
    presetVerified: preset ? preset.verified : isMapping ? true : null,
    errorCode: r.error_code,
    errorMessage: r.error_message,
    counts: {
      rows: r.row_count,
      imported: r.imported_count,
      linked: r.linked_count,
      duplicates: r.duplicate_count,
      skipped: r.skipped_count,
      review: r.review_count,
    },
    periodStart: r.period_start,
    periodEnd: r.period_end,
    createdAt: r.created_at,
    completedAt: r.completed_at,
  };
}

export function toImportRowDto(r: RawEventRow): ImportRowDto {
  const p = r.parsed as ParsedEvent | null;
  return {
    id: r.id,
    rowIndex: r.row_index,
    status: r.status,
    error: r.error,
    transactionId: r.transaction_id,
    occurredAt: p?.occurredAt ?? null,
    amountMinor: p?.amountMinor ?? null,
    direction: p?.direction ?? null,
    counterparty: p?.counterpartyName ?? p?.counterpartyVpa ?? p?.narration ?? null,
    reference: p?.referenceId ?? null,
  };
}
