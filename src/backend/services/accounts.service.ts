import "server-only";
import type { Db } from "@/backend/supabase/clients";
import { AccountsRepository } from "@/backend/repositories/accounts.repository";
import { toAccountDto, toAccountRow } from "@/backend/mappers/accounts.mapper";
import type { AccountDto, AccountInput } from "@/shared/schemas/accounts";

export function accountsService(db: Db) {
  const repo = new AccountsRepository(db);

  return {
    async list(userId: string): Promise<AccountDto[]> {
      return (await repo.listAll(userId)).map(toAccountDto);
    },

    async create(userId: string, input: AccountInput): Promise<AccountDto> {
      if (input.isPrimary) await repo.clearPrimary(userId);
      return toAccountDto(await repo.insert(userId, toAccountRow(input)));
    },

    async update(userId: string, id: string, input: Partial<AccountInput>): Promise<AccountDto> {
      if (input.isPrimary) await repo.clearPrimary(userId, id);
      return toAccountDto(await repo.update(userId, id, toAccountRow(input)));
    },

    async remove(userId: string, id: string): Promise<void> {
      await repo.remove(userId, id);
    },
  };
}
