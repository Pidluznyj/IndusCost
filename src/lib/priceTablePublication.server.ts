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
  DEFAULT_COMMERCIAL_GENERATION_FREIGHT_PERCENT,
  normalizePricingPercentInput,
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

export type GeneratePriceTableDraftComputedItem = {
  productId: string;
  sku: string;
  productName: string;
  productType?: string;
  frozenTotalCost: number;
  marginPct: number;
  commissionPerc: number;
  freightPercent: number;
  taxRate: number;
  salePrice: number;
  commissionValue: number;
  currentSalePrice: number | null;
  deltaAmount: number | null;
  deltaPercent: number | null;
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
  targetMarginPercent: number;
  freightPercent: number;
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
  /** Override da margem-alvo (%) para esta versão. */
  marginPct?: number | null;
  hasMarginOverride?: boolean;
  /**
   * Frete estimado (%) no denominador.
   * Se omitido e `hasFreightOverride` for false, usa legado (freightOut absoluto).
   * Se `hasFreightOverride` true (mesmo 0), aplica frete % e zera frete absoluto.
   */
  freightPercent?: number | null;
  hasFreightOverride?: boolean;
  /** Quando true, calcula sem persistir versão/itens. */
  dryRun?: boolean;
  createdBy?: string | null;
};

function resolveEffectiveMarginPct(
  tableDefaultMarginPct: number,
  input: GeneratePriceTableVersionDraftInput
): number {
  if (input.hasMarginOverride) {
    const parsed = normalizePricingPercentInput(input.marginPct, "Margem");
    if (parsed.ok === false) throw new Error(parsed.message);
    return parsed.value;
  }
  return tableDefaultMarginPct;
}

function resolveFreightMode(input: GeneratePriceTableVersionDraftInput): {
  useFreightPercent: boolean;
  freightPercent: number;
} {
  if (input.hasFreightOverride) {
    const parsed = normalizePricingPercentInput(
      input.freightPercent ?? DEFAULT_COMMERCIAL_GENERATION_FREIGHT_PERCENT,
      "Frete estimado"
    );
    if (parsed.ok === false) throw new Error(parsed.message);
    return { useFreightPercent: true, freightPercent: parsed.value };
  }
  return { useFreightPercent: false, freightPercent: 0 };
}

export async function generatePriceTableVersionDraftFromProductionCosts(
  db: PrismaClient,
  input: GeneratePriceTableVersionDraftInput
) {
  const dryRun = Boolean(input.dryRun);
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

  const defaultMarginPct = Number(table.defaultMarginPct);
  const effectiveMarginPct = resolveEffectiveMarginPct(defaultMarginPct, input);
  const marginRate = effectiveMarginPct / 100;
  const freightMode = resolveFreightMode(input);
  const freightRate = freightMode.useFreightPercent ? freightMode.freightPercent / 100 : 0;

  const publishedVersion = await resolvePublishedPriceTableVersionForDate(
    db,
    input.priceTableId,
    effectiveDate
  );
  const publishedPricesByProductId = new Map<string, number>();
  if (publishedVersion) {
    const publishedItems = await db.priceTableItem.findMany({
      where: { priceTableVersionId: publishedVersion.id },
      select: { productId: true, salePrice: true },
    });
    for (const item of publishedItems) {
      publishedPricesByProductId.set(item.productId, Number(item.salePrice));
    }
  }

  let version: {
    id: string;
    priceTableId: string;
    taxRuleId: string | null;
    versionNumber: number;
    status: string;
    generatedAt: Date | null;
    notes: string | null;
    commissionPerc: unknown;
    targetMarginPercent?: unknown;
    freightPercent?: unknown;
    productionCostTableVersionId: string | null;
    generationSummaryJson?: unknown;
    PriceTable?: unknown;
    TaxRule?: unknown;
  } | null = null;

  if (!dryRun) {
    version = await db.$transaction(async (tx) => {
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
          createdBy: input.createdBy?.trim() || null,
          commissionPerc: input.hasCommissionOverride ? input.commissionPerc : null,
          targetMarginPercent: effectiveMarginPct,
          freightPercent: freightMode.useFreightPercent ? freightMode.freightPercent : null,
          productionCostTableVersionId: productionCostVersion.id,
        },
      });
    });
  }

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
    targetMarginPercent: effectiveMarginPct,
    freightPercent: freightMode.useFreightPercent ? freightMode.freightPercent : 0,
    productionCostTableVersionId: productionCostVersion.id,
    productionCostTableVersionCode: productionCostVersion.code,
    productionCostTableRevision: productionCostVersion.revision,
    productionCostTableEffectiveDate: effectiveDateKey,
  };

  const computedItems: GeneratePriceTableDraftComputedItem[] = [];

  for (const product of selectedProducts) {
    const computed = await processPriceTableProductRow(db, {
      product,
      versionId: version?.id ?? "preview",
      priceTableId: input.priceTableId,
      taxRuleId,
      defaultMarginPct: effectiveMarginPct,
      marginRate,
      fixedTaxRate,
      hasCommissionOverride: Boolean(input.hasCommissionOverride),
      generationCommissionPerc: input.commissionPerc ?? null,
      useFreightPercent: freightMode.useFreightPercent,
      freightPercent: freightMode.freightPercent,
      freightRate,
      productionCostVersion,
      effectiveDateKey,
      costByProductId,
      summary,
      dryRun,
      publishedPricesByProductId,
    });
    if (computed) computedItems.push(computed);
  }

  if (dryRun) {
    return {
      version: null,
      summary,
      productionCostVersion,
      computedItems,
      dryRun: true as const,
    };
  }

  const updatedVersion = await db.priceTableVersion.update({
    where: { id: version!.id },
    data: { generationSummaryJson: summary as never },
    include: { PriceTable: true, TaxRule: true },
  });

  return {
    version: updatedVersion,
    summary,
    productionCostVersion,
    computedItems,
    dryRun: false as const,
  };
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
    useFreightPercent: boolean;
    freightPercent: number;
    freightRate: number;
    productionCostVersion: {
      id: string;
      code: string;
      revision: number;
    };
    effectiveDateKey: string;
    costByProductId: ReturnType<typeof buildProductionCostItemsByProductId>;
    summary: GeneratePriceTableDraftSummary;
    dryRun: boolean;
    publishedPricesByProductId: Map<string, number>;
  }
): Promise<GeneratePriceTableDraftComputedItem | null> {
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
      return null;
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
    const freightAbs = ctx.useFreightPercent
      ? 0
      : Number(productPricingAny?.freightOut ?? 0);

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
      freight: freightAbs,
      freightRate: ctx.useFreightPercent ? ctx.freightRate : 0,
    });

    if (finalCalc.ok === false) {
      summary.itemsSkipped += 1;
      summary.errors.push({
        code: finalCalc.code,
        productId: product.id,
        sku: product.sku,
        productName: product.name,
        productType: product.type,
        message: finalCalc.message,
      });
      return null;
    }

    const {
      salePrice,
      frozenTaxCost,
      totalCommission,
      frozenOtherCost,
      divisor,
      totalFreightPercent,
    } = finalCalc.result;

    const currentSalePrice = ctx.publishedPricesByProductId.get(product.id) ?? null;
    const deltaAmount =
      currentSalePrice != null && Number.isFinite(currentSalePrice)
        ? salePrice - currentSalePrice
        : null;
    const deltaPercent =
      deltaAmount != null && currentSalePrice != null && currentSalePrice > 0
        ? (deltaAmount / currentSalePrice) * 100
        : null;

    const computed: GeneratePriceTableDraftComputedItem = {
      productId: product.id,
      sku: product.sku,
      productName: product.name,
      productType: product.type,
      frozenTotalCost: custoFabril,
      marginPct: ctx.defaultMarginPct,
      commissionPerc: commRate * 100,
      freightPercent: ctx.useFreightPercent ? ctx.freightPercent : 0,
      taxRate,
      salePrice,
      commissionValue: totalCommission,
      currentSalePrice,
      deltaAmount,
      deltaPercent,
    };

    if (ctx.dryRun) {
      summary.itemsCreated += 1;
      return computed;
    }

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
      freightPercent: ctx.useFreightPercent ? ctx.freightPercent : null,
      rates: {
        taxRate,
        commissionRate: commRate,
        otherRate,
        marginRate: ctx.marginRate,
        freight: freightAbs,
        freightRate: ctx.useFreightPercent ? ctx.freightRate : 0,
      },
      divisor,
      outputs: {
        frozenTotalCost: custoFabril,
        frozenTaxCost,
        frozenOtherCost,
        salePrice,
        totalFreightPercent,
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
    return computed;
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
    return null;
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
