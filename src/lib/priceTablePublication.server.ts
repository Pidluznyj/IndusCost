/**
 * Orquestração: gera DRAFT de tabela de preço comercial a partir de custo de produção publicado.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { startOfCivilDate, toCivilDateKey } from "./financeCivilDate.js";
import {
  DEFAULT_PRODUCTION_COST_DRAFT_ITEM_SCOPE,
  parseProductionCostDraftItemScope,
  type ProductionCostDraftItemScope,
} from "./productionCostDraftItemScope.js";
import {
  resolveProductsForProductionCostDraft,
  type ProductionCostDraftProductRow,
} from "./productionCostPublication.server.js";
import {
  buildProductionCostItemsByProductId,
  buildPriceTableCostSnapshotJson,
  NO_PUBLISHED_PRODUCTION_COST_TABLE_MESSAGE,
  resolvePublishedProductionCostTableVersionForDate,
} from "./priceTableProductionCostResolver.js";
import {
  buildPriceTableFormulaSnapshot,
  calculatePriceTableItemFromFrozenCost,
} from "./priceTablePublication.js";

export { previewProductionCostTableSourceForPriceDraft } from "./priceTableProductionCostResolver.js";

export type GeneratePriceTableDraftIssue = {
  code: string;
  productId: string;
  sku: string;
  productName: string;
  productType?: string;
  message: string;
};

export type GeneratePriceTableDraftSummary = {
  itemScope: ProductionCostDraftItemScope;
  itemsEvaluated: number;
  productsEvaluated: number;
  componentsEvaluated: number;
  /** @deprecated Use itemsEvaluated */
  productsRead: number;
  itemsCreated: number;
  itemsSkipped: number;
  errors: GeneratePriceTableDraftIssue[];
  warnings: GeneratePriceTableDraftIssue[];
  commissionOverridePerc: number | null;
  productionCostTableVersionId: string | null;
  productionCostTableVersionCode: string | null;
  productionCostTableRevision: number | null;
  productionCostTableEffectiveDate: string | null;
};

export type GeneratePriceTableVersionDraftInput = {
  priceTableId: string;
  effectiveDate: Date;
  taxRuleId?: string | null;
  includeAllActiveProducts?: boolean;
  productIds?: string[];
  itemScope?: ProductionCostDraftItemScope | string | null;
  notes?: string | null;
  commissionPerc?: number | null;
  hasCommissionOverride?: boolean;
};

export async function generatePriceTableVersionDraftFromProductionCosts(
  db: PrismaClient,
  input: GeneratePriceTableVersionDraftInput
) {
  const effectiveDate = startOfCivilDate(input.effectiveDate);
  if (Number.isNaN(effectiveDate.getTime())) {
    throw new Error("effectiveDate inválida.");
  }

  const table = await db.priceTable.findUnique({ where: { id: input.priceTableId } });
  if (!table) throw new Error("Tabela de preço não encontrada.");
  if (table.status !== "ACTIVE") {
    throw new Error("Apenas tabelas de preço ativas podem gerar versão DRAFT.");
  }

  const productionCostVersion = await resolvePublishedProductionCostTableVersionForDate(
    db,
    effectiveDate
  );
  if (!productionCostVersion || productionCostVersion.items.length === 0) {
    throw new Error(NO_PUBLISHED_PRODUCTION_COST_TABLE_MESSAGE);
  }

  const itemScope = parseProductionCostDraftItemScope(
    input.itemScope ?? DEFAULT_PRODUCTION_COST_DRAFT_ITEM_SCOPE
  );
  const productIds = [...new Set((input.productIds ?? []).filter(Boolean))];

  const selectedProducts = await resolveProductsForProductionCostDraft(db, {
    productIds,
    includeAllActiveProducts: input.includeAllActiveProducts,
    itemScope,
  });

  if (selectedProducts.length === 0) {
    throw new Error("Nenhum produto ou componente ativo selecionado para geração da versão.");
  }

  let validatedTaxRule:
    | (Awaited<ReturnType<typeof db.taxRule.findUnique>> & {
        TaxComponent: Array<{ percentage: Prisma.Decimal }>;
      })
    | null = null;
  const taxRuleId =
    typeof input.taxRuleId === "string" && input.taxRuleId.trim() ? input.taxRuleId.trim() : null;
  if (taxRuleId) {
    const taxRule = await db.taxRule.findUnique({
      where: { id: taxRuleId },
      include: { TaxComponent: { select: { percentage: true } } },
    });
    if (!taxRule) throw new Error("TaxRule não encontrada.");
    validatedTaxRule = taxRule;
  }

  const version = await db.$transaction(async (tx) => {
    const maxVersion = await tx.priceTableVersion.findFirst({
      where: { priceTableId: input.priceTableId },
      orderBy: { versionNumber: "desc" },
      select: { versionNumber: true },
    });
    return tx.priceTableVersion.create({
      data: {
        priceTableId: input.priceTableId,
        taxRuleId,
        versionNumber: Number(maxVersion?.versionNumber ?? 0) + 1,
        status: "DRAFT",
        generatedAt: new Date(),
        notes: input.notes?.trim() || null,
        commissionPerc: input.hasCommissionOverride ? input.commissionPerc : null,
        productionCostTableVersionId: productionCostVersion.id,
      },
    });
  });

  const defaultMarginPct = Number(table.defaultMarginPct);
  const marginRate = defaultMarginPct / 100;
  const fixedTaxRate = validatedTaxRule
    ? validatedTaxRule.TaxComponent.reduce((acc, c) => acc + Number(c.percentage), 0) / 100
    : null;

  const costByProductId = buildProductionCostItemsByProductId(productionCostVersion.items);
  const effectiveDateKey = toCivilDateKey(productionCostVersion.effectiveDate) ?? "";

  const summary: GeneratePriceTableDraftSummary = {
    itemScope,
    itemsEvaluated: selectedProducts.length,
    productsEvaluated: selectedProducts.filter((p) => p.type === "PRODUCT").length,
    componentsEvaluated: selectedProducts.filter((p) => p.type === "COMPONENT").length,
    productsRead: selectedProducts.length,
    itemsCreated: 0,
    itemsSkipped: 0,
    errors: [],
    warnings: [],
    commissionOverridePerc: input.hasCommissionOverride ? input.commissionPerc ?? null : null,
    productionCostTableVersionId: productionCostVersion.id,
    productionCostTableVersionCode: productionCostVersion.code,
    productionCostTableRevision: productionCostVersion.revision,
    productionCostTableEffectiveDate: effectiveDateKey,
  };

  for (const product of selectedProducts) {
    await processPriceTableProductRow(db, {
      product,
      versionId: version.id,
      priceTableId: input.priceTableId,
      taxRuleId,
      defaultMarginPct,
      marginRate,
      fixedTaxRate,
      hasCommissionOverride: Boolean(input.hasCommissionOverride),
      generationCommissionPerc: input.commissionPerc ?? null,
      productionCostVersion,
      effectiveDateKey,
      costByProductId,
      summary,
    });
  }

  const updatedVersion = await db.priceTableVersion.update({
    where: { id: version.id },
    data: { generationSummaryJson: summary as never },
    include: { PriceTable: true, TaxRule: true },
  });

  return { version: updatedVersion, summary, productionCostVersion };
}

async function processPriceTableProductRow(
  db: PrismaClient,
  ctx: {
    product: ProductionCostDraftProductRow;
    versionId: string;
    priceTableId: string;
    taxRuleId: string | null;
    defaultMarginPct: number;
    marginRate: number;
    fixedTaxRate: number | null;
    hasCommissionOverride: boolean;
    generationCommissionPerc: number | null;
    productionCostVersion: {
      id: string;
      code: string;
      revision: number;
    };
    effectiveDateKey: string;
    costByProductId: ReturnType<typeof buildProductionCostItemsByProductId>;
    summary: GeneratePriceTableDraftSummary;
  }
) {
  const { product, summary } = ctx;

  try {
    const costItem = ctx.costByProductId.get(product.id);
    if (!costItem) {
      summary.itemsSkipped += 1;
      summary.errors.push({
        code: "SEM_CUSTO_PRODUCAO_OFICIAL",
        productId: product.id,
        sku: product.sku,
        productName: product.name,
        productType: product.type,
        message:
          "Item sem custo de produção oficial publicado na tabela vigente. PriceTableItem não foi criado.",
      });
      return;
    }

    const custoFabril = costItem.unitProductionCost;

    const productPricing = ctx.taxRuleId
      ? await db.productPricing.findUnique({
          where: { productId_taxRuleId: { productId: product.id, taxRuleId: ctx.taxRuleId } },
        })
      : await db.productPricing.findFirst({
          where: { productId: product.id },
          include: { TaxRule: { include: { TaxComponent: true } } },
          orderBy: { createdAt: "desc" },
        });
    const productPricingAny = productPricing as Record<string, unknown> | null;

    const taxRate =
      ctx.fixedTaxRate ??
      (productPricingAny?.TaxRule &&
      typeof productPricingAny.TaxRule === "object" &&
      productPricingAny.TaxRule !== null &&
      "TaxComponent" in (productPricingAny.TaxRule as object)
        ? (
            (productPricingAny.TaxRule as { TaxComponent: Array<{ percentage: unknown }> })
              .TaxComponent ?? []
          ).reduce((acc, c) => acc + Number(c.percentage), 0) / 100
        : 0);

    const commRate = ctx.hasCommissionOverride
      ? Number(ctx.generationCommissionPerc) / 100
      : Number(productPricingAny?.commission ?? 0) / 100;
    const otherRate = Number(productPricingAny?.otherVariables ?? 0) / 100;
    const freight = Number(productPricingAny?.freightOut ?? 0);

    if (!productPricing) {
      summary.warnings.push({
        code: "NO_PRODUCT_PRICING",
        productId: product.id,
        sku: product.sku,
        productName: product.name,
        productType: product.type,
        message:
          "Item sem premissa em ProductPricing. Comissão/outros/frete/taxa fiscal assumidos como zero.",
      });
    }

    const finalCalc = calculatePriceTableItemFromFrozenCost(custoFabril, {
      taxRate,
      commissionRate: commRate,
      otherRate,
      marginRate: ctx.marginRate,
      freight,
    });

    if (!finalCalc.ok) {
      summary.itemsSkipped += 1;
      summary.errors.push({
        code: finalCalc.code,
        productId: product.id,
        sku: product.sku,
        productName: product.name,
        productType: product.type,
        message: finalCalc.message,
      });
      return;
    }

    const { salePrice, frozenTaxCost, totalCommission, frozenOtherCost, divisor } =
      finalCalc.result;

    const costSnapshotJson = buildPriceTableCostSnapshotJson({
      productionCostTableVersionId: ctx.productionCostVersion.id,
      productionCostTableVersionCode: ctx.productionCostVersion.code,
      revision: ctx.productionCostVersion.revision,
      effectiveDate: ctx.effectiveDateKey,
      item: costItem,
    });

    const formulaSnapshotJson = buildPriceTableFormulaSnapshot({
      priceTableId: ctx.priceTableId,
      priceTableVersionId: ctx.versionId,
      productionCostTableVersionId: ctx.productionCostVersion.id,
      productionCostTableVersionCode: ctx.productionCostVersion.code,
      productionCostRevision: ctx.productionCostVersion.revision,
      taxRuleId: ctx.taxRuleId ?? (productPricingAny?.taxRuleId as string | null) ?? null,
      marginPct: ctx.defaultMarginPct,
      rates: { taxRate, commissionRate: commRate, otherRate, marginRate: ctx.marginRate, freight },
      divisor,
      outputs: {
        frozenTotalCost: custoFabril,
        frozenTaxCost,
        frozenOtherCost,
        salePrice,
      },
    });

    await db.priceTableItem.create({
      data: {
        priceTableVersionId: ctx.versionId,
        productId: product.id,
        sku: product.sku,
        productName: product.name,
        frozenTotalCost: custoFabril,
        frozenMaterialCost: costItem.materialCost,
        frozenHhCost: costItem.laborCost,
        frozenHmCost: costItem.machineCost,
        frozenTaxCost,
        frozenOtherCost,
        marginPct: ctx.defaultMarginPct,
        salePrice,
        commissionPerc: commRate * 100,
        commissionValue: totalCommission,
        costSnapshotJson: costSnapshotJson as Prisma.InputJsonValue,
        formulaSnapshotJson: {
          ...formulaSnapshotJson,
          divisor,
        } as Prisma.InputJsonValue,
      },
    });

    summary.itemsCreated += 1;
  } catch (error) {
    summary.itemsSkipped += 1;
    summary.errors.push({
      code: "UNEXPECTED_ERROR",
      productId: product.id,
      sku: product.sku,
      productName: product.name,
      productType: product.type,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function resolvePublishedPriceTableVersionForDate(
  db: PrismaClient,
  priceTableId: string,
  referenceDate: Date
) {
  const ref = referenceDate;
  return db.priceTableVersion.findFirst({
    where: {
      priceTableId,
      status: { in: ["PUBLISHED", "ARCHIVED"] },
      AND: [
        { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: ref } }] },
        { OR: [{ effectiveTo: null }, { effectiveTo: { gt: ref } }] },
      ],
    },
    orderBy: [{ effectiveFrom: "desc" }, { publishedAt: "desc" }, { versionNumber: "desc" }],
  });
}
