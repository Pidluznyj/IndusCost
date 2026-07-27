/**
 * Contratos tipados de auditoria da Tesouraria (client-safe).
 * Persistência: `TreasuryAuditLog` via `treasuryAuditService.server.ts`.
 */

import type { TreasuryTimestampIso } from "./treasuryTimestamp.js";

export const TREASURY_AUDIT_ENTITY_TYPES = [
  "FINANCIAL_ACCOUNT",
  "ACCOUNT_ACCESS",
  "BALANCE_SNAPSHOT",
  "LEDGER_ENTRY",
  "TRANSFER",
  "PAYMENT_PROMISE",
  "COLLECTION_ACTION",
  "DISPUTE",
  "PAYMENT_SCHEDULE",
  "RECONCILIATION_MATCH",
  "OFX_IMPORT",
  "DAILY_CLOSING",
  "EXCEPTION",
  "MODULE",
] as const;

export type TreasuryAuditEntityType =
  (typeof TREASURY_AUDIT_ENTITY_TYPES)[number];

export const TREASURY_AUDIT_ACTIONS = [
  "CREATE",
  "UPDATE",
  "DELETE",
  "DEACTIVATE",
  "REACTIVATE",
  "EXECUTE",
  "REVERSE",
  "CLOSE",
  "REOPEN",
  "IMPORT",
  "EXPORT",
  "ACCESS_GRANT",
  "ACCESS_REVOKE",
] as const;

export type TreasuryAuditAction = (typeof TREASURY_AUDIT_ACTIONS)[number];

export type TreasuryAuditActorContext = {
  userId?: string | null;
  userName?: string | null;
  sessionId?: string | null;
  requestId?: string | null;
};

export type TreasuryAuditEventInput = {
  entityType: TreasuryAuditEntityType;
  entityId: string;
  action: TreasuryAuditAction;
  before?: unknown | null;
  after?: unknown | null;
  metadata?: Record<string, unknown> | null;
  justification?: string | null;
  occurredAt?: Date;
} & TreasuryAuditActorContext;

export type TreasuryAuditLogDto = {
  id: string;
  entityType: TreasuryAuditEntityType | string;
  entityId: string;
  action: TreasuryAuditAction | string;
  beforeJson: unknown | null;
  afterJson: unknown | null;
  metadataJson: unknown | null;
  justification: string | null;
  requestId: string | null;
  sessionId: string | null;
  userId: string | null;
  userName: string | null;
  occurredAt: TreasuryTimestampIso;
  createdAt: TreasuryTimestampIso;
};

export function isTreasuryAuditEntityType(
  value: unknown
): value is TreasuryAuditEntityType {
  return (
    typeof value === "string" &&
    (TREASURY_AUDIT_ENTITY_TYPES as readonly string[]).includes(value)
  );
}

export function isTreasuryAuditAction(
  value: unknown
): value is TreasuryAuditAction {
  return (
    typeof value === "string" &&
    (TREASURY_AUDIT_ACTIONS as readonly string[]).includes(value)
  );
}
