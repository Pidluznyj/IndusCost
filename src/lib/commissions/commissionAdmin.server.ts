import { prisma } from "@/src/lib/prisma.js";
import {
  COMMISSION_SETTINGS_KEYS,
  type CommissionSettingsSnapshot,
} from "./commission-types.js";
import { loadCommissionSettings } from "./commission-settings.server.js";
import {
  CommissionValidationError,
  type CommissionSettingsWriteInput,
} from "./commissionApiValidation.js";
import { paginatedMeta } from "./commissionQuery.js";

export { CommissionValidationError };

export async function getCommissionSettingsPayload(): Promise<CommissionSettingsSnapshot> {
  return loadCommissionSettings(prisma);
}

export async function updateCommissionSettings(
  input: CommissionSettingsWriteInput
): Promise<CommissionSettingsSnapshot> {
  const updates: Array<{ key: string; value: unknown }> = [];
  if (input.releaseDefaultRule !== undefined) {
    updates.push({ key: COMMISSION_SETTINGS_KEYS.releaseDefaultRule, value: input.releaseDefaultRule });
  }
  if (input.forecastEnabled !== undefined) {
    updates.push({ key: COMMISSION_SETTINGS_KEYS.forecastEnabled, value: input.forecastEnabled });
  }
  if (input.outputDocumentSupersedesForecast !== undefined) {
    updates.push({
      key: COMMISSION_SETTINGS_KEYS.outputDocumentSupersedesForecast,
      value: input.outputDocumentSupersedesForecast,
    });
  }
  if (input.paidCommissionBlockAutoChange !== undefined) {
    updates.push({
      key: COMMISSION_SETTINGS_KEYS.paidCommissionBlockAutoChange,
      value: input.paidCommissionBlockAutoChange,
    });
  }

  for (const u of updates) {
    await prisma.commissionSettings.upsert({
      where: { key: u.key },
      create: { key: u.key, valueJson: u.value },
      update: { valueJson: u.value },
    });
  }

  return loadCommissionSettings(prisma);
}

export async function listCommissionAuditIssues(query: {
  page: number;
  pageSize: number;
  resolved?: boolean;
  severity?: string;
}) {
  const where = {
    resolved: query.resolved,
    severity: query.severity as import("@prisma/client").CommissionAuditIssueSeverity | undefined,
  };
  const skip = (query.page - 1) * query.pageSize;
  const [total, rows] = await Promise.all([
    prisma.commissionAuditIssue.count({ where }),
    prisma.commissionAuditIssue.findMany({
      where,
      orderBy: [{ resolved: "asc" }, { severity: "desc" }, { createdAt: "desc" }],
      skip,
      take: query.pageSize,
    }),
  ]);
  return {
    items: rows.map((r) => ({
      id: r.id,
      severity: r.severity,
      type: r.type,
      entityType: r.entityType,
      entityId: r.entityId,
      message: r.message,
      metadataJson: r.metadataJson,
      resolved: r.resolved,
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
    pagination: paginatedMeta(total, query.page, query.pageSize),
  };
}

export async function resolveCommissionAuditIssue(id: string) {
  const existing = await prisma.commissionAuditIssue.findUnique({ where: { id } });
  if (!existing) throw new CommissionValidationError("NOT_FOUND", "Issue não encontrada.");
  const row = await prisma.commissionAuditIssue.update({
    where: { id },
    data: { resolved: true, resolvedAt: new Date() },
  });
  return {
    id: row.id,
    resolved: row.resolved,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
}

export async function reopenCommissionAuditIssue(id: string) {
  const existing = await prisma.commissionAuditIssue.findUnique({ where: { id } });
  if (!existing) throw new CommissionValidationError("NOT_FOUND", "Issue não encontrada.");
  const row = await prisma.commissionAuditIssue.update({
    where: { id },
    data: { resolved: false, resolvedAt: null },
  });
  return {
    id: row.id,
    resolved: row.resolved,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
}
