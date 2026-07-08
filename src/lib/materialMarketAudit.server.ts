/**
 * Persistência da trilha unificada de auditoria — Inteligência de Mercado (server-only).
 */

import type { PrismaClient } from "@prisma/client";
import {
  buildMaterialMarketAuditEventData,
  mapAlertConfigAuditToUnifiedEvent,
  mapOfficialQuoteAuditToUnifiedEvent,
  mergeMaterialMarketAuditEvents,
  serializeMaterialMarketAuditEventForApi,
  type MaterialMarketAuditApiItem,
  type MaterialMarketAuditRecordInput,
} from "./materialMarketAudit.js";
import type { MaterialOfficialQuoteAuditAction } from "./materialMarketQuoteGovernance.js";

type DbClient = Pick<
  PrismaClient,
  | "materialMarketAuditEvent"
  | "materialOfficialQuoteAudit"
  | "materialMarketAlertConfigAudit"
>;

const GOVERNANCE_ACTION_TO_AUDIT: Record<
  MaterialOfficialQuoteAuditAction,
  { eventType: MaterialMarketAuditRecordInput["eventType"]; entityType: MaterialMarketAuditRecordInput["entityType"] }
> = {
  SUBMITTED: { eventType: "SUBMITTED_FOR_APPROVAL", entityType: "APPROVAL" },
  APPROVED: { eventType: "APPROVED", entityType: "APPROVAL" },
  REJECTED: { eventType: "REJECTED", entityType: "APPROVAL" },
  SET_OFFICIAL: { eventType: "SET_OFFICIAL", entityType: "OFFICIAL_QUOTE" },
  REPLACED: { eventType: "REPLACED", entityType: "OFFICIAL_QUOTE" },
};

export async function recordMaterialMarketAuditEvent(
  db: DbClient,
  input: MaterialMarketAuditRecordInput
): Promise<{ ok: true; id: string } | { ok: false; code: string; message: string; field?: string }> {
  const built = buildMaterialMarketAuditEventData(input);
  if (built.ok === false) {
    return { ok: false, code: built.code, message: built.message, field: built.field };
  }

  const created = await db.materialMarketAuditEvent.create({ data: built.data });
  return { ok: true, id: created.id };
}

export async function recordGovernanceAuditEvent(
  db: DbClient,
  input: {
    materialId: string;
    quoteId: string;
    action: MaterialOfficialQuoteAuditAction;
    userId?: string | null;
    userName?: string | null;
    reason?: string | null;
    rejectionReason?: string | null;
    previousQuoteId?: string | null;
    newQuoteId?: string | null;
  }
): Promise<{ ok: true; id: string } | { ok: false; code: string; message: string; field?: string }> {
  const mapping = GOVERNANCE_ACTION_TO_AUDIT[input.action];
  return recordMaterialMarketAuditEvent(db, {
    materialId: input.materialId,
    entityType: mapping.entityType,
    entityId: input.quoteId,
    eventType: mapping.eventType,
    userId: input.userId,
    userName: input.userName,
    reason: input.rejectionReason ?? input.reason ?? null,
    beforeJson: input.previousQuoteId ? { quoteId: input.previousQuoteId } : null,
    afterJson: { quoteId: input.newQuoteId ?? input.quoteId },
    metadata: { governanceAction: input.action },
  });
}

export async function listMaterialMarketAuditEventsForMaterial(
  db: DbClient,
  materialId: string,
  query: { limit: number; offset: number }
): Promise<{ items: MaterialMarketAuditApiItem[]; total: number }> {
  const [unifiedRows, officialRows, configRows] = await Promise.all([
    db.materialMarketAuditEvent.findMany({
      where: { materialId },
      orderBy: { occurredAt: "desc" },
    }),
    db.materialOfficialQuoteAudit.findMany({
      where: { materialId },
      orderBy: { changedAt: "desc" },
    }),
    db.materialMarketAlertConfigAudit.findMany({
      where: { materialId },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const unifiedItems = unifiedRows.map((row) =>
    serializeMaterialMarketAuditEventForApi({
      id: row.id,
      materialId: row.materialId,
      entityType: row.entityType,
      entityId: row.entityId,
      eventType: row.eventType,
      userId: row.userId,
      userName: row.userName,
      occurredAt: row.occurredAt,
      reason: row.reason,
      beforeJson: row.beforeJson,
      afterJson: row.afterJson,
      metadata: row.metadata,
    })
  );

  const legacyOfficial = officialRows.map((row) =>
    mapOfficialQuoteAuditToUnifiedEvent({
      id: row.id,
      materialId: row.materialId,
      quoteId: row.quoteId,
      action: row.action,
      previousQuoteId: row.previousQuoteId,
      newQuoteId: row.newQuoteId,
      changedBy: row.changedBy,
      changedAt: row.changedAt,
      reason: row.reason,
      rejectionReason: row.rejectionReason,
    })
  );

  const legacyConfig = configRows.map((row) =>
    mapAlertConfigAuditToUnifiedEvent({
      id: row.id,
      scope: row.scope,
      materialId: row.materialId,
      beforeJson: row.beforeJson,
      afterJson: row.afterJson,
      updatedBy: row.updatedBy,
      createdAt: row.createdAt,
    })
  );

  const merged = mergeMaterialMarketAuditEvents([
    ...unifiedItems,
    ...legacyOfficial,
    ...legacyConfig,
  ]);

  return {
    items: merged.slice(query.offset, query.offset + query.limit),
    total: merged.length,
  };
}
