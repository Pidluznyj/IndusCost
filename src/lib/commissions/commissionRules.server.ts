import {
  Prisma,
  type CommissionReleaseRule,
  type CommissionRuleBaseType,
  type CommissionRuleBeneficiaryType,
} from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import { toPrismaDecimal } from "./commission-money.js";
import type { CommissionRuleWriteInput } from "./commissionApiValidation.js";
import { CommissionValidationError } from "./commissionApiValidation.js";
import { assertFixedPersonRuleAllowed } from "./commissionSettings.server.js";
import { loadCommissionSettings } from "./commission-settings.server.js";
import type { CommissionRulesQuery } from "./commissionQuery.js";
import { paginatedMeta } from "./commissionQuery.js";

export { CommissionValidationError };

type RuleRow = NonNullable<Awaited<ReturnType<typeof getCommissionRuleById>>>;

export type CommissionRuleListItem = ReturnType<typeof serializeRule> & {
  usageCount: number;
};

export type CommissionRulesCards = {
  totalCount: number;
  activeCount: number;
  inactiveCount: number;
  withUsageCount: number;
  withConditionsCount: number;
};

export type CommissionRulesPagePayload = {
  cards: CommissionRulesCards;
  rows: CommissionRuleListItem[];
  items: CommissionRuleListItem[];
  pagination: ReturnType<typeof paginatedMeta>;
};

function serializeRule(row: RuleRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    active: row.active,
    priority: row.priority,
    beneficiaryType: row.beneficiaryType,
    calculationType: row.calculationType,
    fixedCommissionPersonId: row.fixedCommissionPersonId,
    fixedCommissionPersonName: row.fixedCommissionPerson?.name ?? null,
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
    conditionsCount: row.conditions.length,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function getCommissionRuleById(id: string) {
  return prisma.commissionRule.findUnique({
    where: { id },
    include: {
      conditions: true,
      fixedCommissionPerson: { select: { id: true, name: true } },
    },
  });
}

function assertValidPeriod(validFrom: Date | null, validTo: Date | null) {
  if (validFrom && validTo && validTo < validFrom) {
    throw new CommissionValidationError(
      "INVALID_FIELD",
      "Vigência final não pode ser anterior à vigência inicial."
    );
  }
}

function assertFixedPersonRequired(
  beneficiaryType: CommissionRuleBeneficiaryType,
  fixedCommissionPersonId: string | null
) {
  if (beneficiaryType === "FIXED_PERSON" && !fixedCommissionPersonId) {
    throw new CommissionValidationError(
      "INVALID_FIELD",
      "Pessoa fixa é obrigatória quando o beneficiário é Pessoa fixa."
    );
  }
}

function buildRuleWhere(query: CommissionRulesQuery): Prisma.CommissionRuleWhereInput {
  const and: Prisma.CommissionRuleWhereInput[] = [];
  if (query.active != null) and.push({ active: query.active });
  if (query.beneficiaryType) {
    and.push({ beneficiaryType: query.beneficiaryType as CommissionRuleBeneficiaryType });
  }
  if (query.baseType) {
    and.push({ baseType: query.baseType as CommissionRuleBaseType });
  }
  if (query.releaseRule) {
    and.push({ releaseRule: query.releaseRule as CommissionReleaseRule });
  }
  if (query.fixedCommissionPersonId) {
    and.push({ fixedCommissionPersonId: query.fixedCommissionPersonId });
  }
  if (query.search) {
    const search = query.search.trim();
    and.push({
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ],
    });
  }
  if (and.length === 0) return {};
  if (and.length === 1) return and[0]!;
  return { AND: and };
}

async function countRuleUsage(ruleId: string): Promise<number> {
  return prisma.commissionRecord.count({
    where: {
      metadataJson: {
        path: ["ruleId"],
        equals: ruleId,
      },
    },
  });
}

async function loadUsageCounts(ruleIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (ruleIds.length === 0) return map;
  const counts = await Promise.all(ruleIds.map((id) => countRuleUsage(id)));
  ruleIds.forEach((id, index) => map.set(id, counts[index] ?? 0));
  return map;
}

function mapRuleRows(
  rows: RuleRow[],
  usageMap: Map<string, number>
): CommissionRuleListItem[] {
  return rows.map((row) => ({
    ...serializeRule(row),
    usageCount: usageMap.get(row.id) ?? 0,
  }));
}

export async function listCommissionRulesPage(
  query: CommissionRulesQuery
): Promise<CommissionRulesPagePayload> {
  const where = buildRuleWhere(query);

  const [allForCards, total, pageRows] = await Promise.all([
    prisma.commissionRule.findMany({
      where,
      select: { id: true, active: true, conditions: { select: { id: true } } },
    }),
    prisma.commissionRule.count({ where }),
    prisma.commissionRule.findMany({
      where,
      include: {
        conditions: true,
        fixedCommissionPerson: { select: { id: true, name: true } },
      },
      orderBy: [{ priority: "asc" }, { name: "asc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  const usageMap = await loadUsageCounts(allForCards.map((r) => r.id));

  const cards: CommissionRulesCards = {
    totalCount: allForCards.length,
    activeCount: allForCards.filter((r) => r.active).length,
    inactiveCount: allForCards.filter((r) => !r.active).length,
    withUsageCount: allForCards.filter((r) => (usageMap.get(r.id) ?? 0) > 0).length,
    withConditionsCount: allForCards.filter((r) => r.conditions.length > 0).length,
  };

  const pageUsageMap = await loadUsageCounts(pageRows.map((r) => r.id));
  const rows = mapRuleRows(pageRows, pageUsageMap);

  return {
    cards,
    rows,
    items: rows,
    pagination: paginatedMeta(total, query.page, query.pageSize),
  };
}

export async function listCommissionRules(query: CommissionRulesQuery) {
  const payload = await listCommissionRulesPage(query);
  return { items: payload.items, pagination: payload.pagination };
}

export async function getCommissionRuleUsage(ruleId: string) {
  const row = await getCommissionRuleById(ruleId);
  if (!row) {
    throw new CommissionValidationError("NOT_FOUND", "Regra não encontrada.");
  }
  const usageCount = await countRuleUsage(ruleId);
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const recentUsageCount = await prisma.commissionRecord.count({
    where: {
      metadataJson: { path: ["ruleId"], equals: ruleId },
      calculatedAt: { gte: ninetyDaysAgo },
    },
  });
  return {
    rule: { ...serializeRule(row), usageCount },
    usageCount,
    recentUsageCount,
  };
}

function mapConditionsCreate(conditions: CommissionRuleWriteInput["conditions"]) {
  return (conditions ?? []).map((c) => ({
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
  }));
}

export async function createCommissionRule(input: CommissionRuleWriteInput) {
  assertValidPeriod(input.validFrom ?? null, input.validTo ?? null);
  assertFixedPersonRequired(
    input.beneficiaryType,
    input.fixedCommissionPersonId ?? null
  );
  if (input.beneficiaryType === "FIXED_PERSON") {
    const settings = await loadCommissionSettings(prisma);
    assertFixedPersonRuleAllowed(settings);
  }

  const row = await prisma.commissionRule.create({
    data: {
      name: input.name,
      description: input.description ?? null,
      active: input.active ?? true,
      priority: input.priority ?? 100,
      beneficiaryType: input.beneficiaryType,
      calculationType: input.calculationType ?? "FIXED_PERCENT",
      fixedCommissionPersonId: input.fixedCommissionPersonId ?? null,
      ratePercent: toPrismaDecimal(input.ratePercent),
      baseType: input.baseType,
      releaseRule: input.releaseRule,
      validFrom: input.validFrom ?? null,
      validTo: input.validTo ?? null,
      conditions: { create: mapConditionsCreate(input.conditions) },
    },
    include: {
      conditions: true,
      fixedCommissionPerson: { select: { id: true, name: true } },
    },
  });
  return { ...serializeRule(row), usageCount: 0 };
}

export async function updateCommissionRule(id: string, input: Partial<CommissionRuleWriteInput>) {
  const existing = await prisma.commissionRule.findUnique({ where: { id } });
  if (!existing) {
    throw new CommissionValidationError("NOT_FOUND", "Regra não encontrada.");
  }

  const nextBeneficiary = input.beneficiaryType ?? existing.beneficiaryType;
  const nextFixedId =
    input.fixedCommissionPersonId !== undefined
      ? input.fixedCommissionPersonId
      : existing.fixedCommissionPersonId;
  const nextFrom = input.validFrom !== undefined ? input.validFrom : existing.validFrom;
  const nextTo = input.validTo !== undefined ? input.validTo : existing.validTo;

  assertFixedPersonRequired(nextBeneficiary, nextFixedId);
  if (nextBeneficiary === "FIXED_PERSON") {
    const settings = await loadCommissionSettings(prisma);
    assertFixedPersonRuleAllowed(settings);
  }
  assertValidPeriod(nextFrom, nextTo);

  await prisma.$transaction(async (tx) => {
    await tx.commissionRule.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        active: input.active,
        priority: input.priority,
        beneficiaryType: input.beneficiaryType,
        calculationType: input.calculationType,
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
          data: mapConditionsCreate(input.conditions).map((c) => ({
            ruleId: id,
            ...c,
          })),
        });
      }
    }
  });

  const row = await getCommissionRuleById(id);
  const usageCount = await countRuleUsage(id);
  return { ...serializeRule(row!), usageCount };
}

export async function toggleCommissionRuleActive(id: string) {
  const existing = await prisma.commissionRule.findUnique({ where: { id } });
  if (!existing) {
    throw new CommissionValidationError("NOT_FOUND", "Regra não encontrada.");
  }
  await prisma.commissionRule.update({
    where: { id },
    data: { active: !existing.active },
  });
  const row = await getCommissionRuleById(id);
  const usageCount = await countRuleUsage(id);
  return { ...serializeRule(row!), usageCount };
}

export async function duplicateCommissionRule(id: string) {
  const existing = await getCommissionRuleById(id);
  if (!existing) {
    throw new CommissionValidationError("NOT_FOUND", "Regra não encontrada.");
  }

  return createCommissionRule({
    name: `${existing.name} (cópia)`,
    description: existing.description,
    active: false,
    priority: existing.priority + 1,
    beneficiaryType: existing.beneficiaryType,
    fixedCommissionPersonId: existing.fixedCommissionPersonId,
    ratePercent: Number(existing.ratePercent),
    baseType: existing.baseType,
    releaseRule: existing.releaseRule,
    validFrom: existing.validFrom,
    validTo: existing.validTo,
    conditions: existing.conditions.map((c) => ({
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
  });
}
