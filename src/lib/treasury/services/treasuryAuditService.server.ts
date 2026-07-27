/**
 * Serviço central de auditoria da Tesouraria — server-only.
 * Aceita PrismaClient ou TransactionClient para gravar na mesma TX da ação principal.
 */

import type { Prisma, PrismaClient, TreasuryAuditLog } from "@prisma/client";
import {
  isTreasuryAuditAction,
  isTreasuryAuditEntityType,
  type TreasuryAuditEventInput,
  type TreasuryAuditLogDto,
} from "../contracts/treasuryAuditContracts.js";
import { formatTreasuryTimestampIso } from "../contracts/treasuryTimestamp.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import {
  buildTreasuryCreatedAudit,
  buildTreasuryUpdatedAudit,
} from "../treasuryAuditHelpers.js";

export type TreasuryAuditDb = PrismaClient | Prisma.TransactionClient;

export type TreasuryAuditWriteResult = TreasuryAuditLog;

function asJsonValue(
  value: unknown | null | undefined
): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return value as Prisma.InputJsonValue;
}

function requireNonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new TreasuryDomainError(
      "REQUIRED_FIELD",
      `${field} é obrigatório para auditoria.`,
      field
    );
  }
  return trimmed;
}

/**
 * Eventos de auditoria são append-only — alteração comum é proibida na API.
 */
export function rejectTreasuryAuditLogMutation(
  operation: "update" | "delete"
): never {
  throw new TreasuryDomainError(
    "CONFLICT",
    `Eventos de auditoria da Tesouraria são imutáveis (operação ${operation} negada).`
  );
}

export async function updateTreasuryAuditLog(): Promise<never> {
  return rejectTreasuryAuditLogMutation("update");
}

export async function deleteTreasuryAuditLog(): Promise<never> {
  return rejectTreasuryAuditLogMutation("delete");
}

export function toTreasuryAuditLogDto(
  row: TreasuryAuditLog
): TreasuryAuditLogDto {
  return {
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    action: row.action,
    beforeJson: row.beforeJson ?? null,
    afterJson: row.afterJson ?? null,
    metadataJson: row.metadataJson ?? null,
    justification: row.justification ?? null,
    requestId: row.requestId ?? null,
    sessionId: row.sessionId ?? null,
    userId: row.userId ?? null,
    userName: row.userName ?? null,
    occurredAt: formatTreasuryTimestampIso(row.occurredAt),
    createdAt: formatTreasuryTimestampIso(row.createdAt),
  };
}

/**
 * Grava um evento de auditoria. Quando `db` é um TransactionClient,
 * participa da mesma transaction da ação principal (rollback conjunto).
 */
export async function writeTreasuryAuditLog(
  db: TreasuryAuditDb,
  input: TreasuryAuditEventInput
): Promise<TreasuryAuditWriteResult> {
  if (!isTreasuryAuditEntityType(input.entityType)) {
    throw new TreasuryDomainError(
      "INVALID_ENUM",
      `entityType de auditoria desconhecido: ${String(input.entityType)}`,
      "entityType"
    );
  }
  if (!isTreasuryAuditAction(input.action)) {
    throw new TreasuryDomainError(
      "INVALID_ENUM",
      `action de auditoria desconhecida: ${String(input.action)}`,
      "action"
    );
  }

  const entityId = requireNonEmpty(input.entityId, "entityId");
  const justification =
    typeof input.justification === "string" && input.justification.trim()
      ? input.justification.trim()
      : null;

  return db.treasuryAuditLog.create({
    data: {
      entityType: input.entityType,
      entityId,
      action: input.action,
      beforeJson: asJsonValue(input.before),
      afterJson: asJsonValue(input.after),
      metadataJson: asJsonValue(input.metadata),
      justification,
      requestId: input.requestId?.trim() || null,
      sessionId: input.sessionId?.trim() || null,
      userId: input.userId?.trim() || null,
      userName: input.userName?.trim() || null,
      occurredAt: input.occurredAt ?? new Date(),
    },
  });
}

export async function writeTreasuryAuditLogs(
  db: TreasuryAuditDb,
  inputs: readonly TreasuryAuditEventInput[]
): Promise<TreasuryAuditWriteResult[]> {
  const rows: TreasuryAuditWriteResult[] = [];
  for (const input of inputs) {
    rows.push(await writeTreasuryAuditLog(db, input));
  }
  return rows;
}

/** Atalho tipado: auditoria de criação na mesma TX. */
export async function auditTreasuryCreate(
  db: TreasuryAuditDb,
  input: Parameters<typeof buildTreasuryCreatedAudit>[0]
): Promise<TreasuryAuditWriteResult> {
  return writeTreasuryAuditLog(db, buildTreasuryCreatedAudit(input));
}

/** Atalho tipado: auditoria de alteração na mesma TX. */
export async function auditTreasuryUpdate(
  db: TreasuryAuditDb,
  input: Parameters<typeof buildTreasuryUpdatedAudit>[0]
): Promise<TreasuryAuditWriteResult> {
  return writeTreasuryAuditLog(db, buildTreasuryUpdatedAudit(input));
}
