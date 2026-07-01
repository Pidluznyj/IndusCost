import { prisma } from "@/src/lib/prisma.js";
import { toPrismaDecimal } from "./commission-money.js";
import {
  COMMISSION_SETTINGS_KEYS,
  type CommissionSettingsSnapshot,
} from "./commission-types.js";
import { loadCommissionSettings } from "./commission-settings.server.js";
import {
  CommissionValidationError,
  type CommissionPersonWriteInput,
  type CommissionRuleWriteInput,
  type CommissionSettingsWriteInput,
} from "./commissionApiValidation.js";
import { paginatedMeta } from "./commissionQuery.js";

export { CommissionValidationError };

function serializePerson(row: {
  id: string;
  nomusPersonId: number | null;
  name: string;
  type: string;
  source: string;
  email: string | null;
  document: string | null;
  active: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    nomusPersonId: row.nomusPersonId,
    name: row.name,
    type: row.type,
    source: row.source,
    email: row.email,
    document: row.document,
    active: row.active,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listCommissionPersons(query: {
  page: number;
  pageSize: number;
  active?: boolean;
  type?: string;
}) {
  const where = {
    active: query.active,
    type: query.type as import("@prisma/client").CommissionPersonType | undefined,
  };
  const skip = (query.page - 1) * query.pageSize;
  const [total, rows] = await Promise.all([
    prisma.commissionPerson.count({ where }),
    prisma.commissionPerson.findMany({
      where,
      orderBy: [{ active: "desc" }, { name: "asc" }],
      skip,
      take: query.pageSize,
    }),
  ]);
  return { items: rows.map(serializePerson), pagination: paginatedMeta(total, query.page, query.pageSize) };
}

export async function createCommissionPerson(input: CommissionPersonWriteInput) {
  const row = await prisma.commissionPerson.create({
    data: {
      name: input.name,
      type: input.type,
      source: input.source ?? "MANUAL",
      nomusPersonId: input.nomusPersonId ?? null,
      email: input.email ?? null,
      document: input.document ?? null,
      notes: input.notes ?? null,
      active: input.active ?? true,
    },
  });
  return serializePerson(row);
}

export async function updateCommissionPerson(id: string, input: Partial<CommissionPersonWriteInput>) {
  const existing = await prisma.commissionPerson.findUnique({ where: { id } });
  if (!existing) throw new CommissionValidationError("NOT_FOUND", "Pessoa comissionada não encontrada.");
  const row = await prisma.commissionPerson.update({
    where: { id },
    data: {
      name: input.name,
      type: input.type,
      source: input.source,
      nomusPersonId: input.nomusPersonId,
      email: input.email,
      document: input.document,
      notes: input.notes,
      active: input.active,
    },
  });
  return serializePerson(row);
}

export async function toggleCommissionPersonActive(id: string) {
  const existing = await prisma.commissionPerson.findUnique({ where: { id } });
  if (!existing) throw new CommissionValidationError("NOT_FOUND", "Pessoa comissionada não encontrada.");
  const row = await prisma.commissionPerson.update({
    where: { id },
    data: { active: !existing.active },
  });
  return serializePerson(row);
}

function serializeRule(row: Awaited<ReturnType<typeof getCommissionRuleById>>) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    active: row.active,
    priority: row.priority,
    beneficiaryType: row.beneficiaryType,
    fixedCommissionPersonId: row.fixedCommissionPersonId,
    ratePercent: Number(row.ratePercent),
    baseType: row.baseType,
    releaseRule: row.releaseRule,
    validFrom: row.validFrom?.toISOString() ?? null,
    validTo: row.validTo?.toISOString() ?? null,
    conditions: row.conditions.map((c) => ({
      id: c.id,
      companyExternalId: c.companyExternalId,
      customerExternalId: c.customerExternalId,
      customerUf: c.customerUf,
      nomusSellerId: c.nomusSellerId,
      nomusRepresentativeId: c.nomusRepresentativeId,
      productExternalId: c.productExternalId,
      productGroupExternalId: c.productGroupExternalId,
      priceTableExternalId: c.priceTableExternalId,
      paymentConditionExternalId: c.paymentConditionExternalId,
      movementTypeExternalId: c.movementTypeExternalId,
      minOrderAmount: c.minOrderAmount != null ? Number(c.minOrderAmount) : null,
      maxOrderAmount: c.maxOrderAmount != null ? Number(c.maxOrderAmount) : null,
      minDiscountPercent: c.minDiscountPercent != null ? Number(c.minDiscountPercent) : null,
      maxDiscountPercent: c.maxDiscountPercent != null ? Number(c.maxDiscountPercent) : null,
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function getCommissionRuleById(id: string) {
  return prisma.commissionRule.findUnique({
    where: { id },
    include: { conditions: true },
  });
}

export async function listCommissionRules(query: { page: number; pageSize: number; active?: boolean }) {
  const where = { active: query.active };
  const skip = (query.page - 1) * query.pageSize;
  const [total, rows] = await Promise.all([
    prisma.commissionRule.count({ where }),
    prisma.commissionRule.findMany({
      where,
      include: { conditions: true },
      orderBy: [{ priority: "asc" }, { name: "asc" }],
      skip,
      take: query.pageSize,
    }),
  ]);
  return {
    items: rows.map((r) => serializeRule(r)!),
    pagination: paginatedMeta(total, query.page, query.pageSize),
  };
}

export async function createCommissionRule(input: CommissionRuleWriteInput) {
  const row = await prisma.commissionRule.create({
    data: {
      name: input.name,
      description: input.description ?? null,
      active: input.active ?? true,
      priority: input.priority ?? 100,
      beneficiaryType: input.beneficiaryType,
      fixedCommissionPersonId: input.fixedCommissionPersonId ?? null,
      ratePercent: toPrismaDecimal(input.ratePercent),
      baseType: input.baseType,
      releaseRule: input.releaseRule,
      validFrom: input.validFrom ?? null,
      validTo: input.validTo ?? null,
      conditions: {
        create: (input.conditions ?? []).map((c) => ({
          companyExternalId: c.companyExternalId ?? null,
          customerExternalId: c.customerExternalId ?? null,
          customerUf: c.customerUf ?? null,
          nomusSellerId: c.nomusSellerId ?? null,
          nomusRepresentativeId: c.nomusRepresentativeId ?? null,
          productExternalId: c.productExternalId ?? null,
          productGroupExternalId: c.productGroupExternalId ?? null,
          priceTableExternalId: c.priceTableExternalId ?? null,
          paymentConditionExternalId: c.paymentConditionExternalId ?? null,
          movementTypeExternalId: c.movementTypeExternalId ?? null,
          minOrderAmount: c.minOrderAmount != null ? toPrismaDecimal(c.minOrderAmount) : null,
          maxOrderAmount: c.maxOrderAmount != null ? toPrismaDecimal(c.maxOrderAmount) : null,
          minDiscountPercent:
            c.minDiscountPercent != null ? toPrismaDecimal(c.minDiscountPercent) : null,
          maxDiscountPercent:
            c.maxDiscountPercent != null ? toPrismaDecimal(c.maxDiscountPercent) : null,
        })),
      },
    },
    include: { conditions: true },
  });
  return serializeRule(row)!;
}

export async function updateCommissionRule(id: string, input: Partial<CommissionRuleWriteInput>) {
  const existing = await prisma.commissionRule.findUnique({ where: { id } });
  if (!existing) throw new CommissionValidationError("NOT_FOUND", "Regra não encontrada.");

  await prisma.$transaction(async (tx) => {
    await tx.commissionRule.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        active: input.active,
        priority: input.priority,
        beneficiaryType: input.beneficiaryType,
        fixedCommissionPersonId: input.fixedCommissionPersonId,
        ratePercent: input.ratePercent != null ? toPrismaDecimal(input.ratePercent) : undefined,
        baseType: input.baseType,
        releaseRule: input.releaseRule,
        validFrom: input.validFrom,
        validTo: input.validTo,
      },
    });
    if (input.conditions) {
      await tx.commissionRuleCondition.deleteMany({ where: { ruleId: id } });
      if (input.conditions.length > 0) {
        await tx.commissionRuleCondition.createMany({
          data: input.conditions.map((c) => ({
            ruleId: id,
            companyExternalId: c.companyExternalId ?? null,
            customerExternalId: c.customerExternalId ?? null,
            customerUf: c.customerUf ?? null,
            nomusSellerId: c.nomusSellerId ?? null,
            nomusRepresentativeId: c.nomusRepresentativeId ?? null,
            productExternalId: c.productExternalId ?? null,
            productGroupExternalId: c.productGroupExternalId ?? null,
            priceTableExternalId: c.priceTableExternalId ?? null,
            paymentConditionExternalId: c.paymentConditionExternalId ?? null,
            movementTypeExternalId: c.movementTypeExternalId ?? null,
            minOrderAmount: c.minOrderAmount != null ? toPrismaDecimal(c.minOrderAmount) : null,
            maxOrderAmount: c.maxOrderAmount != null ? toPrismaDecimal(c.maxOrderAmount) : null,
            minDiscountPercent:
              c.minDiscountPercent != null ? toPrismaDecimal(c.minDiscountPercent) : null,
            maxDiscountPercent:
              c.maxDiscountPercent != null ? toPrismaDecimal(c.maxDiscountPercent) : null,
          })),
        });
      }
    }
  });

  const row = await getCommissionRuleById(id);
  return serializeRule(row)!;
}

export async function toggleCommissionRuleActive(id: string) {
  const existing = await prisma.commissionRule.findUnique({ where: { id } });
  if (!existing) throw new CommissionValidationError("NOT_FOUND", "Regra não encontrada.");
  await prisma.commissionRule.update({
    where: { id },
    data: { active: !existing.active },
  });
  const row = await getCommissionRuleById(id);
  return serializeRule(row)!;
}

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
