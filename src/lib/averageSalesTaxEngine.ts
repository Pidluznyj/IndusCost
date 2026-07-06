/**
 * Imposto sobre venda — fonte oficial: TaxRule + TaxComponent (mesma base da formação de preço).
 */
import type { PrismaClient } from "@prisma/client";
import { roundPricingMoney, roundPricingPercent, sumTaxRuleComponentPercents } from "./pricingCalculations.js";

export type ProductTaxPercentIndex = Map<string, number>;

export type ResolvedSalesTaxRule = {
  id: string;
  name: string;
  status: string | null;
  operation: string;
  totalPercent: number;
  components: Array<{
    id: string;
    name: string;
    percentage: number;
    isRecoverable: boolean | null;
    baseType: string | null;
  }>;
};

/** Carrega TaxRule por ID com composição — usado na configuração Nomus. */
export async function resolveSalesTaxRuleById(
  db: Pick<PrismaClient, "taxRule">,
  taxRuleId: string
): Promise<ResolvedSalesTaxRule | null> {
  const rule = await db.taxRule.findUnique({
    where: { id: taxRuleId },
    select: {
      id: true,
      name: true,
      status: true,
      operation: true,
      TaxComponent: {
        select: {
          id: true,
          name: true,
          percentage: true,
          isRecoverable: true,
          baseType: true,
        },
        orderBy: { name: "asc" },
      },
    },
  });
  if (!rule) return null;
  const components = rule.TaxComponent.map((c) => ({
    id: c.id,
    name: c.name,
    percentage: Number(c.percentage),
    isRecoverable: c.isRecoverable,
    baseType: c.baseType,
  }));
  return {
    id: rule.id,
    name: rule.name,
    status: rule.status,
    operation: rule.operation,
    totalPercent: sumTaxRuleComponentPercents(components),
    components,
  };
}

/** Lista TaxRules ativas para seleção na configuração de margem Nomus. */
export async function listActiveSalesTaxRules(
  db: Pick<PrismaClient, "taxRule">
): Promise<ResolvedSalesTaxRule[]> {
  const rows = await db.taxRule.findMany({
    where: { status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      status: true,
      operation: true,
      TaxComponent: {
        select: {
          id: true,
          name: true,
          percentage: true,
          isRecoverable: true,
          baseType: true,
        },
        orderBy: { name: "asc" },
      },
    },
  });
  return rows.map((rule) => {
    const components = rule.TaxComponent.map((c) => ({
      id: c.id,
      name: c.name,
      percentage: Number(c.percentage),
      isRecoverable: c.isRecoverable,
      baseType: c.baseType,
    }));
    return {
      id: rule.id,
      name: rule.name,
      status: rule.status,
      operation: rule.operation,
      totalPercent: sumTaxRuleComponentPercents(components),
      components,
    };
  });
}

export function computeSalesTaxAmount(salesAmount: number, taxPercent: number): number {
  if (!Number.isFinite(salesAmount) || salesAmount <= 0) return 0;
  if (!Number.isFinite(taxPercent) || taxPercent <= 0) return 0;
  return roundPricingMoney(salesAmount * (taxPercent / 100));
}

export function computeNetSalesAmount(salesAmount: number, taxAmount: number): number {
  return roundPricingMoney(Math.max(0, salesAmount - taxAmount));
}

/** Carrega % de imposto por produto a partir de ProductPricing → TaxRule. */
export async function loadProductTaxPercentIndex(
  db: Pick<PrismaClient, "productPricing">,
  productIds: string[]
): Promise<ProductTaxPercentIndex> {
  const uniqueIds = [...new Set(productIds.filter(Boolean))];
  const index: ProductTaxPercentIndex = new Map();
  if (uniqueIds.length === 0) return index;

  const rows = await db.productPricing.findMany({
    where: { productId: { in: uniqueIds } },
    select: {
      productId: true,
      TaxRule: { select: { TaxComponent: { select: { percentage: true } } } },
    },
  });

  for (const row of rows) {
    if (!row.TaxRule?.TaxComponent?.length) continue;
    const percent = sumTaxRuleComponentPercents(row.TaxRule.TaxComponent);
    if (percent > 0) index.set(row.productId, percent);
  }
  return index;
}

/** Regra fiscal padrão ativa — fallback quando produto não tem TaxRule cadastrada. */
export async function resolveDefaultSalesTaxPercent(
  db: Pick<PrismaClient, "taxRule">
): Promise<{ percent: number; label: string }> {
  const rule = await db.taxRule.findFirst({
    where: { status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: {
      name: true,
      TaxComponent: { select: { percentage: true } },
    },
  });
  if (!rule?.TaxComponent?.length) {
    return { percent: 0, label: "Sem regra fiscal cadastrada" };
  }
  return {
    percent: sumTaxRuleComponentPercents(rule.TaxComponent),
    label: rule.name,
  };
}

export function resolveItemSalesTaxPercent(input: {
  productId: string | null;
  productTaxIndex: ProductTaxPercentIndex;
  defaultTaxPercent: number;
}): number {
  if (input.productId && input.productTaxIndex.has(input.productId)) {
    return input.productTaxIndex.get(input.productId)!;
  }
  return input.defaultTaxPercent;
}

export function computeRevenueWeightedTaxPercent(input: {
  rows: Array<{ salesAmount: number; taxPercent: number }>;
  fallbackPercent: number;
}): number {
  let weighted = 0;
  let revenue = 0;
  for (const row of input.rows) {
    if (row.salesAmount <= 0) continue;
    weighted += row.salesAmount * row.taxPercent;
    revenue += row.salesAmount;
  }
  if (revenue <= 0) return roundPricingPercent(input.fallbackPercent);
  return roundPricingPercent(weighted / revenue);
}
