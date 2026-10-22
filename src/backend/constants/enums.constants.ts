import "server-only";

// Backend reads enums from the shared module so the API, UI and SQL never drift apart.
export * from "@/shared/constants/enums";

export const AUTH_MODES = {
  /** No session required (health, auth endpoints). */
  PUBLIC: "public",
  /** A permanent (non-anonymous) signed-in user. */
  USER: "user",
  /** Any session, including Supabase anonymous guests. */
  SESSION: "session",
} as const;
export type AuthMode = (typeof AUTH_MODES)[keyof typeof AUTH_MODES];

export const AUDIT_ACTIONS = {
  IMPORT_CREATED: "import.created",
  IMPORT_DELETED: "import.deleted",
  IMPORT_REPLACED: "import.replaced",
  TRANSACTION_UPDATED: "transaction.updated",
  LLM_CONFIG_UPDATED: "llm_config.updated",
  SPLIT_CREATED: "split.created",
  SPLIT_UPDATED: "split.updated",
  INVITE_ISSUED: "invite.issued",
  INVITE_REVOKED: "invite.revoked",
  CLAIM_RESOLVED: "claim.resolved",
} as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
