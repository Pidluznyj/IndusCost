import type { PrismaClient } from "@prisma/client";
import type {
  CommissionActiveRule,
  CommissionRuleMatchContext,
  CommissionRuleMatchResult,
} from "./commission-types.js";
import { decimalToNumber } from "./commission-money.js";

export function isRuleEffective(rule: CommissionActiveRule, referenceDate: Date): boolean {
  if (!rule.active) return false;
  if (rule.validFrom && referenceDate < rule.validFrom) return false;
  if (rule.validTo && referenceDate > rule.validTo) return false;
  return true;
}

function conditionMatches(
  condition: CommissionActiveRule["conditions"][number],
  ctx: CommissionRuleMatchContext
): boolean {
  const order = ctx.order;
  const item = ctx.item;

  if (condition.companyExternalId != null && condition.companyExternalId !== order.companyExternalId) {
    return false;
  }
  if (
    condition.customerExternalId != null &&
    condition.customerExternalId !== order.customerExternalId
  ) {
    return false;
  }
  if (condition.nomusSellerId != null && condition.nomusSellerId !== ctx.nomusSellerId) {
    return false;
  }
  if (
    condition.nomusRepresentativeId != null &&
    condition.nomusRepresentativeId !== ctx.nomusRepresentativeId
  ) {
    return false;
  }
  if (
    condition.productExternalId != null &&
    condition.productExternalId !== item.nomusProductId
  ) {
    return false;
  }

  const orderTotal = order.items.reduce((s, i) => s + i.itemNetAmount, 0);
  if (condition.minOrderAmount != null && orderTotal < condition.minOrderAmount) return false;
  if (condition.maxOrderAmount != null && orderTotal > condition.maxOrderAmount) return false;

  // customerUf, productGroup, priceTable, paymentCondition, movementType, discount % — fase futura
  return true;
}

export function ruleMatchesContext(
  rule: CommissionActiveRule,
  ctx: CommissionRuleMatchContext
): boolean {
  if (!isRuleEffective(rule, ctx.referenceDate)) return false;
  if (rule.beneficiaryType !== ctx.beneficiaryType) return false;

  if (rule.beneficiaryType === "FIXED_PERSON") {
    if (!rule.fixedCommissionPersonId) return false;
    if (ctx.commissionPersonId && ctx.commissionPersonId !== rule.fixedCommissionPersonId) {
      return false;
    }
  }

  if (rule.conditions.length === 0) return true;
  return rule.conditions.some((c) => conditionMatches(c, ctx));
}

export function selectBestMatchingRule(
  rules: CommissionActiveRule[],
  ctx: CommissionRuleMatchContext
): CommissionRuleMatchResult | null {
  const candidates = rules
    .filter((rule) => ruleMatchesContext(rule, ctx))
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));

  const best = candidates[0];
  if (!best) return null;

  return {
    rule: best,
    ratePercent: best.ratePercent,
    releaseRule: best.releaseRule,
    baseType: best.baseType,
  };
}

export async function loadActiveCommissionRules(
  db: Pick<PrismaClient, "commissionRule">
): Promise<CommissionActiveRule[]> {
  const rows = await db.commissionRule.findMany({
    where: { active: true },
    include: { conditions: true },
    orderBy: [{ priority: "asc" }, { name: "asc" }],
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    active: row.active,
    priority: row.priority,
    beneficiaryType: row.beneficiaryType,
    fixedCommissionPersonId: row.fixedCommissionPersonId,
    ratePercent: decimalToNumber(row.ratePercent),
    baseType: row.baseType,
    releaseRule: row.releaseRule,
    validFrom: row.validFrom,
    validTo: row.validTo,
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
      minOrderAmount: c.minOrderAmount != null ? decimalToNumber(c.minOrderAmount) : null,
      maxOrderAmount: c.maxOrderAmount != null ? decimalToNumber(c.maxOrderAmount) : null,
      minDiscountPercent:
        c.minDiscountPercent != null ? decimalToNumber(c.minDiscountPercent) : null,
      maxDiscountPercent:
        c.maxDiscountPercent != null ? decimalToNumber(c.maxDiscountPercent) : null,
    })),
  }));
}

export async function resolveOrCreateCommissionPerson(
  db: Pick<PrismaClient, "commissionPerson">,
  input: {
    beneficiaryType: "SELLER" | "REPRESENTATIVE" | "FIXED_PERSON";
    fixedPersonId?: string | null;
    nomusPersonId?: number | null;
    name: string;
  }
): Promise<string | null> {
  if (input.beneficiaryType === "FIXED_PERSON" && input.fixedPersonId) {
    const existing = await db.commissionPerson.findFirst({
      where: { id: input.fixedPersonId, active: true },
      select: { id: true },
    });
    return existing?.id ?? null;
  }

  if (input.nomusPersonId != null) {
    const byNomus = await db.commissionPerson.findFirst({
      where: { nomusPersonId: input.nomusPersonId, active: true },
      select: { id: true },
    });
    if (byNomus) return byNomus.id;
  }

  const personType =
    input.beneficiaryType === "REPRESENTATIVE"
      ? "REPRESENTATIVE"
      : input.beneficiaryType === "SELLER"
        ? "SELLER"
        : "OTHER";

  const created = await db.commissionPerson.create({
    data: {
      name: input.name.trim() || "Comissionado",
      type: personType,
      source: input.nomusPersonId != null ? "NOMUS" : "MANUAL",
      nomusPersonId: input.nomusPersonId ?? null,
      active: true,
    },
    select: { id: true },
  });
  return created.id;
}
