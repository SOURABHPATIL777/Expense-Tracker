import "server-only";
import type { Db } from "@/backend/supabase/clients";
import { TABLES } from "@/backend/constants/db.constants";
import type { AuditAction } from "@/backend/constants/enums.constants";
import { logger } from "@/backend/logger/logger";

/**
 * Append-only audit trail of security-relevant changes. Failure to write an audit row is logged
 * but never blocks the user action (the action itself already succeeded in its own transaction).
 */
export async function audit(
  db: Db,
  entry: { userId: string; action: AuditAction; entityType: string; entityId?: string; metadata?: Record<string, unknown> },
): Promise<void> {
  const { error } = await db.from(TABLES.AUDIT_EVENTS).insert({
    user_id: entry.userId,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    metadata: entry.metadata ?? {},
  });
  if (error) logger.error({ err: error, action: entry.action }, "audit write failed");
}
