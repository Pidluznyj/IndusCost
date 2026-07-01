import type {
  ProjectPricingConfig,
  ProjectPricingItem,
  ProjectPricingItemStatus as PrismaPricingStatus,
} from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import type { ProjectDetail } from "@/src/types/projects.js";
import { loadProjectCostAmortizations } from "./projectsCostAmortizationService.js";
import {
  buildProjectPricingView,
  computeProjectPricingItem,
  type ProjectPricingItemStatus,
  type ProjectPricingView,
  type SavedProjectPricingItem,
  serializeTaxRulesForProjectPricing,
} from "./projectsPricing.js";

function dec(value: unknown): number | null {
  if (value == null) return null;
  const n =
    typeof value === "object" && value !== null && "toNumber" in value
      ? (value as { toNumber: () => number }).toNumber()
      : Number(value);
  return Number.isFinite(n) ? n : null;
}

export type ProjectPricingPayload = {
  config: {
    fiscalRuleId: string | null;
    defaultMarginPercent: number | null;
  };
  items: SavedProjectPricingItem[];
  view: ProjectPricingView;
};

function serializePricingItem(row: ProjectPricingItem): SavedProjectPricingItem {
  return {
    targetItemId: row.targetItemId,
    targetItemType: row.targetItemType,
    targetDescriptionSnapshot: row.targetDescriptionSnapshot,
    fiscalRuleId: row.fiscalRuleId,
    fiscalRuleNameSnapshot: row.fiscalRuleNameSnapshot,
    costBaseUnitSnapshot: dec(row.costBaseUnitSnapshot) ?? 0,
    amortizationUnitCostSnapshot: dec(row.amortizationUnitCostSnapshot) ?? 0,
    finalUnitCostSnapshot: dec(row.finalUnitCostSnapshot) ?? 0,
    taxPercentSnapshot: dec(row.taxPercentSnapshot) ?? 0,
    targetMarginPercent: dec(row.targetMarginPercent) ?? 0,
    suggestedPrice: dec(row.suggestedPrice),
    suggestedPriceWithoutAmortization: dec(row.suggestedPriceWithoutAmortization),
    suggestedPriceWithAmortization: dec(row.suggestedPrice),
    taxAmountWithoutAmortization: dec(row.taxAmountWithoutAmortization),
    marginAmountWithoutAmortization: dec(row.marginAmountWithoutAmortization),
    taxAmount: dec(row.taxAmount),
    marginAmount: dec(row.marginAmount),
    status: row.status as ProjectPricingItemStatus,
  };
}

export async function loadProjectPricingTaxRules() {
  const rules = await prisma.taxRule.findMany({
    where: { status: "ACTIVE" },
    include: { TaxComponent: true },
    orderBy: { name: "asc" },
  });
  return serializeTaxRulesForProjectPricing(rules);
}

export async function loadProjectPricingPayload(
  projectId: string,
  detail: ProjectDetail
): Promise<ProjectPricingPayload> {
  const [taxRules, configRow, itemRows, amortizations] = await Promise.all([
    loadProjectPricingTaxRules(),
    prisma.projectPricingConfig.findUnique({
      where: { projectId },
      include: { items: { orderBy: { createdAt: "asc" } } },
    }),
    prisma.projectPricingItem.findMany({
      where: { projectId },
      orderBy: { createdAt: "asc" },
    }),
    loadProjectCostAmortizations(projectId),
  ]);

  const savedItems = (configRow?.items.length ? configRow.items : itemRows).map(serializePricingItem);
  const config = {
    fiscalRuleId: configRow?.fiscalRuleId ?? null,
    defaultMarginPercent: dec(configRow?.defaultMarginPercent),
  };
  const view = buildProjectPricingView({
    detail,
    taxRules,
    config,
    savedItems,
    savedAmortizations: amortizations,
  });

  return { config, items: savedItems, view };
}

export type UpsertProjectPricingPayload = {
  fiscalRuleId?: string | null;
  defaultMarginPercent?: number | null;
  items: Array<{
    targetItemId: string;
    targetItemType: string;
    fiscalRuleId?: string | null;
    targetMarginPercent?: number | null;
  }>;
};

export async function upsertProjectPricing(
  projectId: string,
  detail: ProjectDetail,
  payload: UpsertProjectPricingPayload
): Promise<ProjectPricingPayload> {
  const taxRules = await loadProjectPricingTaxRules();
  const amortizations = await loadProjectCostAmortizations(projectId);

  const draft = buildProjectPricingView({
    detail,
    taxRules,
    config: {
      fiscalRuleId: payload.fiscalRuleId ?? null,
      defaultMarginPercent: payload.defaultMarginPercent ?? detail.targetMarginPercent ?? null,
    },
    savedItems: [],
    savedAmortizations: amortizations,
  });

  const itemOverrides = new Map(payload.items.map((row) => [row.targetItemId, row]));
  const computedItems = draft.items.map((item) => {
    const override = itemOverrides.get(item.targetItemId);
    const fiscalRuleId = override?.fiscalRuleId ?? item.fiscalRuleId;
    const taxRule = taxRules.find((rule) => rule.id === fiscalRuleId);
    const margin =
      override?.targetMarginPercent != null
        ? override.targetMarginPercent
        : item.targetMarginPercent;
    const taxPercent = taxRule?.taxPercent ?? item.taxPercent;

    return computeProjectPricingItem(
      {
        targetItemId: item.targetItemId,
        targetItemType: item.targetItemType,
        displayName: item.displayName,
        baseUnitCost: item.costBaseUnit,
        unitAmortizedCost: item.amortizationUnitCost,
        finalUnitCost: item.finalUnitCost,
      },
      {
        fiscalRuleId,
        fiscalRuleName: taxRule?.name ?? null,
        taxPercent,
        targetMarginPercent: margin,
      }
    );
  });

  const fiscalRuleId = payload.fiscalRuleId ?? null;
  const defaultMarginPercent = payload.defaultMarginPercent ?? detail.targetMarginPercent ?? null;

  await prisma.$transaction(async (tx) => {
    const config = await tx.projectPricingConfig.upsert({
      where: { projectId },
      create: {
        projectId,
        fiscalRuleId,
        defaultMarginPercent,
      },
      update: {
        fiscalRuleId,
        defaultMarginPercent,
      },
    });

    await tx.projectPricingItem.deleteMany({ where: { projectId } });

    for (const item of computedItems) {
      await tx.projectPricingItem.create({
        data: {
          projectId,
          configId: config.id,
          targetItemId: item.targetItemId,
          targetItemType: item.targetItemType,
          targetDescriptionSnapshot: item.displayName,
          fiscalRuleId: item.fiscalRuleId,
          fiscalRuleNameSnapshot: item.fiscalRuleName,
          costBaseUnitSnapshot: item.costBaseUnit,
          amortizationUnitCostSnapshot: item.amortizationUnitCost,
          finalUnitCostSnapshot: item.finalUnitCost,
          taxPercentSnapshot: item.taxPercent,
          targetMarginPercent: item.targetMarginPercent,
          suggestedPrice: item.suggestedPriceWithAmortization ?? item.suggestedPrice,
          suggestedPriceWithoutAmortization: item.suggestedPriceWithoutAmortization,
          taxAmountWithoutAmortization: item.taxAmountWithoutAmortization,
          marginAmountWithoutAmortization: item.marginAmountWithoutAmortization,
          taxAmount: item.taxAmount,
          marginAmount: item.marginAmount,
          status: item.status as PrismaPricingStatus,
        },
      });
    }
  });

  return loadProjectPricingPayload(projectId, detail);
}
