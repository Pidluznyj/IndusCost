/**
 * Helpers tipados para eventos de auditoria da Tesouraria (client-safe).
 * Não importam Prisma — só montam payloads para o writer server-side.
 */

import type {
  TreasuryAuditActorContext,
  TreasuryAuditEventInput,
} from "./contracts/treasuryAuditContracts.js";

function withActor(
  base: Omit<TreasuryAuditEventInput, keyof TreasuryAuditActorContext>,
  actor?: TreasuryAuditActorContext
): TreasuryAuditEventInput {
  return {
    ...base,
    userId: actor?.userId ?? null,
    userName: actor?.userName ?? null,
    sessionId: actor?.sessionId ?? null,
    requestId: actor?.requestId ?? null,
  };
}

export function buildTreasuryCreatedAudit(input: {
  entityType: TreasuryAuditEventInput["entityType"];
  entityId: string;
  after: unknown;
  metadata?: Record<string, unknown> | null;
  justification?: string | null;
  actor?: TreasuryAuditActorContext;
}): TreasuryAuditEventInput {
  return withActor(
    {
      entityType: input.entityType,
      entityId: input.entityId,
      action: "CREATE",
      before: null,
      after: input.after,
      metadata: input.metadata ?? null,
      justification: input.justification ?? null,
    },
    input.actor
  );
}

export function buildTreasuryUpdatedAudit(input: {
  entityType: TreasuryAuditEventInput["entityType"];
  entityId: string;
  before: unknown;
  after: unknown;
  metadata?: Record<string, unknown> | null;
  justification?: string | null;
  actor?: TreasuryAuditActorContext;
}): TreasuryAuditEventInput {
  return withActor(
    {
      entityType: input.entityType,
      entityId: input.entityId,
      action: "UPDATE",
      before: input.before,
      after: input.after,
      metadata: input.metadata ?? null,
      justification: input.justification ?? null,
    },
    input.actor
  );
}

export function buildTreasuryDeactivatedAudit(input: {
  entityType: TreasuryAuditEventInput["entityType"];
  entityId: string;
  before: unknown;
  after: unknown;
  justification: string;
  actor?: TreasuryAuditActorContext;
}): TreasuryAuditEventInput {
  return withActor(
    {
      entityType: input.entityType,
      entityId: input.entityId,
      action: "DEACTIVATE",
      before: input.before,
      after: input.after,
      metadata: null,
      justification: input.justification,
    },
    input.actor
  );
}

export function buildTreasuryAccessGrantedAudit(input: {
  accountId: string;
  accessId: string;
  after: unknown;
  actor?: TreasuryAuditActorContext;
}): TreasuryAuditEventInput {
  return withActor(
    {
      entityType: "ACCOUNT_ACCESS",
      entityId: input.accessId,
      action: "ACCESS_GRANT",
      before: null,
      after: input.after,
      metadata: { accountId: input.accountId },
      justification: null,
    },
    input.actor
  );
}

export function buildTreasuryBalanceSnapshotAudit(input: {
  snapshotId: string;
  after: unknown;
  actor?: TreasuryAuditActorContext;
  justification?: string | null;
}): TreasuryAuditEventInput {
  return withActor(
    {
      entityType: "BALANCE_SNAPSHOT",
      entityId: input.snapshotId,
      action: "CREATE",
      before: null,
      after: input.after,
      metadata: null,
      justification: input.justification ?? null,
    },
    input.actor
  );
}
