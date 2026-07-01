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

export async function listCommissionPaymentBatches(query: {
  page: number;
  pageSize: number;
  commissionPersonId?: string;
  status?: string;
}) {
  const where = {
    commissionPersonId: query.commissionPersonId,
    status: query.status as import("@prisma/client").CommissionPaymentBatchStatus | undefined,
  };
  const skip = (query.page - 1) * query.pageSize;
  const [total, rows] = await Promise.all([
    prisma.commissionPaymentBatch.count({ where }),
    prisma.commissionPaymentBatch.findMany({
      where,
      include: {
        commissionPerson: { select: { id: true, name: true } },
        _count: { select: { items: true } },
      },
      orderBy: [{ createdAt: "desc" }],
      skip,
      take: query.pageSize,
    }),
  ]);
  return {
    items: rows.map((b) => ({
      id: b.id,
      periodStart: b.periodStart.toISOString(),
      periodEnd: b.periodEnd.toISOString(),
      commissionPersonId: b.commissionPersonId,
      commissionPersonName: b.commissionPerson.name,
      status: b.status,
      totalReleased: Number(b.totalReleased),
      totalSelected: Number(b.totalSelected),
      totalPaid: Number(b.totalPaid),
      paymentDate: b.paymentDate?.toISOString() ?? null,
      itemsCount: b._count.items,
      createdAt: b.createdAt.toISOString(),
    })),
    pagination: paginatedMeta(total, query.page, query.pageSize),
  };
}

export async function getCommissionPaymentBatchById(id: string) {
  const batch = await prisma.commissionPaymentBatch.findUnique({
    where: { id },
    include: {
      commissionPerson: { select: { id: true, name: true } },
      items: {
        include: {
          commissionRecord: {
            select: {
              orderCode: true,
              productCode: true,
              commissionAmount: true,
              releasedAmount: true,
              paidAmount: true,
            },
          },
        },
      },
    },
  });
  if (!batch) throw new CommissionValidationError("NOT_FOUND", "Lote não encontrado.");
  return {
    id: batch.id,
    periodStart: batch.periodStart.toISOString(),
    periodEnd: batch.periodEnd.toISOString(),
    commissionPersonId: batch.commissionPersonId,
    commissionPersonName: batch.commissionPerson.name,
    status: batch.status,
    totalReleased: Number(batch.totalReleased),
    totalSelected: Number(batch.totalSelected),
    totalPaid: Number(batch.totalPaid),
    paymentDate: batch.paymentDate?.toISOString() ?? null,
    notes: batch.notes,
    items: batch.items.map((item) => ({
      id: item.id,
      commissionRecordId: item.commissionRecordId,
      orderCode: item.commissionRecord.orderCode,
      productCode: item.commissionRecord.productCode,
      amountToPay: Number(item.amountToPay),
      amountPaid: Number(item.amountPaid),
      status: item.status,
    })),
    createdAt: batch.createdAt.toISOString(),
  };
}
