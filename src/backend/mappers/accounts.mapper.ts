import "server-only";
import type { AccountRow } from "@/backend/repositories/types";
import type { AccountDto, AccountInput } from "@/shared/schemas/accounts";

export const toAccountDto = (r: AccountRow): AccountDto => ({
  id: r.id,
  label: r.label,
  sourceKind: r.source_kind,
  sourceApp: r.source_app as AccountDto["sourceApp"],
  maskedNumber: r.masked_number,
  upiIds: r.upi_ids,
  isPrimary: r.is_primary,
  createdAt: r.created_at,
});

export const toAccountRow = (i: Partial<AccountInput>): Partial<AccountRow> => ({
  ...(i.label !== undefined && { label: i.label }),
  ...(i.sourceKind !== undefined && { source_kind: i.sourceKind }),
  ...(i.sourceApp !== undefined && { source_app: i.sourceApp }),
  ...("maskedNumber" in i && { masked_number: i.maskedNumber ?? null }),
  ...(i.upiIds !== undefined && { upi_ids: [...new Set(i.upiIds)] }),
  ...(i.isPrimary !== undefined && { is_primary: i.isPrimary }),
});
