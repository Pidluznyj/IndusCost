import type { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import { CommissionValidationError } from "./commissionApiValidation.js";
import { paginatedMeta, type CustomerExclusionRulesQuery } from "./commissionQuery.js";
import {
  buildCustomerExclusionIdentity,
  findConflictingActiveExclusionRule,
  normalizeCustomerNameForExclusion,
  resolveApplicableCustomerExclusionRule,
  type CustomerExclusionRuleSnapshot,
  type FindApplicableCustomerExclusionInput,
  type FindApplicableCustomerExclusionResult,
} from "./commissionCustomerExclusion.js";

export type CustomerExclusionRuleRow = {
  id: string;
  customerId: string | null;
  customerExternalId: number | null;
  customerNameSnapshot: string;
  customerTaxId: string | null;
  normalizedCustomerName: string;
  reason: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: "ACTIVE" | "INACTIVE";
  createdByUserId: string | null;
  inactivatedAt: string | null;
  inactivatedByUserId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CustomerExclusionRulesPagePayload = {
  rows: CustomerExclusionRuleRow[];
  pagination: ReturnType<typeof paginatedMeta>;
};

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function mapRow(row: {
  id: string;
  customerId: string | null;
  customerExternalId: number | null;
  customerNameSnapshot: string;
  normalizedCustomerName: string;
  reason: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  status: "ACTIVE" | "INACTIVE";
  createdByUserId: string | null;
  inactivatedAt: Date | null;
  inactivatedByUserId: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  customer?: { taxId: string } | null;
}): CustomerExclusionRuleRow {
  return {
    id: row.id,
    customerId: row.customerId,
    customerExternalId: row.customerExternalId,
    customerNameSnapshot: row.customerNameSnapshot,
    customerTaxId: row.customer?.taxId?.trim() || null,
    normalizedCustomerName: row.normalizedCustomerName,
    reason: row.reason,
    effectiveFrom: toIsoDate(row.effectiveFrom),
    effectiveTo: row.effectiveTo ? toIsoDate(row.effectiveTo) : null,
    status: row.status,
    createdByUserId: row.createdByUserId,
    inactivatedAt: row.inactivatedAt?.toISOString() ?? null,
    inactivatedByUserId: row.inactivatedByUserId,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapSnapshot(row: {
  id: string;
  customerId: string | null;
  customerExternalId: number | null;
  customerNameSnapshot: string;
  normalizedCustomerName: string;
  reason: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  status: "ACTIVE" | "INACTIVE";
  notes: string | null;
}): CustomerExclusionRuleSnapshot {
  return {
    id: row.id,
    customerId: row.customerId,
    customerExternalId: row.customerExternalId,
    customerNameSnapshot: row.customerNameSnapshot,
    normalizedCustomerName: row.normalizedCustomerName,
    reason: row.reason,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    status: row.status,
    notes: row.notes,
  };
}

async function resolveCustomerNameFields(input: {
  customerId?: string | null;
  customerExternalId?: number | null;
  customerNameSnapshot?: string | null;
}): Promise<{
  customerId: string | null;
  customerExternalId: number | null;
  customerNameSnapshot: string;
  normalizedCustomerName: string;
}> {
  const customerId = input.customerId?.trim() || null;
  const customerExternalId = input.customerExternalId ?? null;

  if (customerId) {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { companyName: true },
    });
    if (!customer) {
      throw new CommissionValidationError("INVALID_FIELD", "customerId não encontrado.");
    }
    const snapshot =
      input.customerNameSnapshot?.trim() || customer.companyName.trim();
    return {
      customerId,
      customerExternalId,
      customerNameSnapshot: snapshot,
      normalizedCustomerName: normalizeCustomerNameForExclusion(snapshot),
    };
  }

  const snapshot = input.customerNameSnapshot?.trim();
  if (!snapshot) {
    throw new CommissionValidationError(
      "INVALID_FIELD",
      "Informe cliente (customerId, customerExternalId ou customerNameSnapshot)."
    );
  }

  return {
    customerId: null,
    customerExternalId,
    customerNameSnapshot: snapshot,
    normalizedCustomerName: normalizeCustomerNameForExclusion(snapshot),
  };
}

async function assertNoConflictingActiveRule(input: {
  customerId: string | null;
  customerExternalId: number | null;
  customerNameSnapshot: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  excludeRuleId?: string | null;
}): Promise<void> {
  const identity = buildCustomerExclusionIdentity(input);
  const existing = await prisma.commissionCustomerExclusionRule.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      customerId: true,
      customerExternalId: true,
      normalizedCustomerName: true,
      effectiveFrom: true,
      effectiveTo: true,
    },
  });

  const conflict = findConflictingActiveExclusionRule(
    {
      ...identity,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
    },
    existing,
    input.excludeRuleId
  );

  if (conflict) {
    throw new CommissionValidationError(
      "CONFLICT",
      "Já existe regra ativa conflitante para este cliente no período informado."
    );
  }
}

export async function listCustomerExclusionRules(
  query: CustomerExclusionRulesQuery
): Promise<CustomerExclusionRulesPagePayload> {
  const and: Prisma.CommissionCustomerExclusionRuleWhereInput[] = [];
  if (query.status) and.push({ status: query.status });
  if (query.search) {
    and.push({
      OR: [
        { customerNameSnapshot: { contains: query.search, mode: "insensitive" } },
        { normalizedCustomerName: { contains: query.search, mode: "insensitive" } },
        { reason: { contains: query.search, mode: "insensitive" } },
        { notes: { contains: query.search, mode: "insensitive" } },
      ],
    });
  }
  const where: Prisma.CommissionCustomerExclusionRuleWhereInput =
    and.length > 0 ? { AND: and } : {};

  const [total, rows] = await Promise.all([
    prisma.commissionCustomerExclusionRule.count({ where }),
    prisma.commissionCustomerExclusionRule.findMany({
      where,
      include: { customer: { select: { taxId: true } } },
      orderBy: [{ status: "asc" }, { effectiveFrom: "desc" }, { createdAt: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    rows: rows.map(mapRow),
    pagination: paginatedMeta(query.page, query.pageSize, total),
  };
}

export async function createCustomerExclusionRule(input: {
  customerId?: string | null;
  customerExternalId?: number | null;
  customerNameSnapshot?: string | null;
  reason: string;
  effectiveFrom: Date;
  effectiveTo?: Date | null;
  notes?: string | null;
  createdByUserId?: string | null;
}): Promise<CustomerExclusionRuleRow> {
  if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) {
    throw new CommissionValidationError(
      "INVALID_FIELD",
      "effectiveTo não pode ser anterior a effectiveFrom."
    );
  }

  if (!input.customerId && input.customerExternalId == null && !input.customerNameSnapshot?.trim()) {
    throw new CommissionValidationError(
      "INVALID_FIELD",
      "Informe cliente (customerId, customerExternalId ou customerNameSnapshot)."
    );
  }

  const customerFields = await resolveCustomerNameFields(input);

  await assertNoConflictingActiveRule({
    ...customerFields,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo ?? null,
  });

  const row = await prisma.commissionCustomerExclusionRule.create({
    data: {
      customerId: customerFields.customerId,
      customerExternalId: customerFields.customerExternalId,
      customerNameSnapshot: customerFields.customerNameSnapshot,
      normalizedCustomerName: customerFields.normalizedCustomerName,
      reason: input.reason.trim(),
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo ?? null,
      status: "ACTIVE",
      createdByUserId: input.createdByUserId ?? null,
      notes: input.notes?.trim() || null,
    },
  });

  return mapRow(row);
}

export async function updateCustomerExclusionRule(
  id: string,
  input: {
    customerId?: string | null;
    customerExternalId?: number | null;
    customerNameSnapshot?: string | null;
    reason?: string;
    effectiveFrom?: Date;
    effectiveTo?: Date | null;
    notes?: string | null;
  }
): Promise<CustomerExclusionRuleRow | null> {
  const existing = await prisma.commissionCustomerExclusionRule.findUnique({ where: { id } });
  if (!existing) return null;

  const effectiveFrom = input.effectiveFrom ?? existing.effectiveFrom;
  const effectiveTo =
    input.effectiveTo !== undefined ? input.effectiveTo : existing.effectiveTo;
  if (effectiveTo && effectiveTo < effectiveFrom) {
    throw new CommissionValidationError(
      "INVALID_FIELD",
      "effectiveTo não pode ser anterior a effectiveFrom."
    );
  }

  const customerFields = await resolveCustomerNameFields({
    customerId:
      input.customerId !== undefined ? input.customerId : existing.customerId,
    customerExternalId:
      input.customerExternalId !== undefined
        ? input.customerExternalId
        : existing.customerExternalId,
    customerNameSnapshot:
      input.customerNameSnapshot !== undefined
        ? input.customerNameSnapshot
        : existing.customerNameSnapshot,
  });

  if (existing.status === "ACTIVE") {
    await assertNoConflictingActiveRule({
      ...customerFields,
      effectiveFrom,
      effectiveTo,
      excludeRuleId: id,
    });
  }

  const row = await prisma.commissionCustomerExclusionRule.update({
    where: { id },
    data: {
      customerId: customerFields.customerId,
      customerExternalId: customerFields.customerExternalId,
      customerNameSnapshot: customerFields.customerNameSnapshot,
      normalizedCustomerName: customerFields.normalizedCustomerName,
      reason: input.reason?.trim(),
      effectiveFrom,
      effectiveTo,
      notes: input.notes !== undefined ? input.notes?.trim() || null : undefined,
    },
  });

  return mapRow(row);
}

export async function inactivateCustomerExclusionRule(
  id: string,
  inactivatedByUserId?: string | null
): Promise<CustomerExclusionRuleRow | null> {
  const existing = await prisma.commissionCustomerExclusionRule.findUnique({ where: { id } });
  if (!existing) return null;
  if (existing.status === "INACTIVE") return mapRow(existing);

  const row = await prisma.commissionCustomerExclusionRule.update({
    where: { id },
    data: {
      status: "INACTIVE",
      inactivatedAt: new Date(),
      inactivatedByUserId: inactivatedByUserId ?? null,
    },
  });

  return mapRow(row);
}

export async function findApplicableCustomerExclusionRule(
  input: FindApplicableCustomerExclusionInput
): Promise<FindApplicableCustomerExclusionResult | null> {
  const ref = input.referenceDate;
  const rows = await prisma.commissionCustomerExclusionRule.findMany({
    where: {
      status: "ACTIVE",
      effectiveFrom: { lte: ref },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: ref } }],
    },
    select: {
      id: true,
      customerId: true,
      customerExternalId: true,
      customerNameSnapshot: true,
      normalizedCustomerName: true,
      reason: true,
      effectiveFrom: true,
      effectiveTo: true,
      status: true,
      notes: true,
    },
  });

  return resolveApplicableCustomerExclusionRule(
    input,
    rows.map(mapSnapshot)
  );
}

export async function loadActiveCustomerExclusionRuleSnapshots(): Promise<
  CustomerExclusionRuleSnapshot[]
> {
  const rows = await prisma.commissionCustomerExclusionRule.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      customerId: true,
      customerExternalId: true,
      customerNameSnapshot: true,
      normalizedCustomerName: true,
      reason: true,
      effectiveFrom: true,
      effectiveTo: true,
      status: true,
      notes: true,
    },
    orderBy: [{ effectiveFrom: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(mapSnapshot);
}
