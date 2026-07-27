import type { PrismaClient } from "@prisma/client";
import {
  computePublishedMarkup,
  deriveFreightPercentAmount,
  deriveOtherVariablesAmount,
  PUBLISHED_TRACE_NEWER_COST_WARNING,
  PUBLISHED_TRACE_UNAVAILABLE_LABEL,
  readCostSnapshotFields,
  readFormulaSnapshotFields,
  toIsoTrace,
  type PublishedPriceSourceTrace,
  type PublishedPriceSourceTraceQuery,
  type PublishedTraceStatus,
  decTrace,
} from "./publishedPriceSourceTrace.js";

function traceStatus(available: boolean, partial = false): PublishedTraceStatus {
  if (!available && !partial) return "NOT_AVAILABLE";
  if (partial) return "PARTIAL";
  return "AVAILABLE";
}

export async function buildPublishedPriceSourceTrace(
  db: PrismaClient,
  query: PublishedPriceSourceTraceQuery
): Promise<PublishedPriceSourceTrace> {
  const priceItemId = query.priceItemId?.trim();
  if (!priceItemId) {
    throw new Error("priceItemId é obrigatório.");
  }

  const item = await db.priceTableItem.findUnique({
    where: { id: priceItemId },
    include: {
      Product: { select: { id: true, sku: true, name: true, type: true } },
      PriceTableVersion: {
        include: {
          PriceTable: { select: { id: true, code: true, name: true } },
          TaxRule: { select: { id: true, name: true } },
          productionCostTableVersion: {
            include: {
              materialCostTableVersion: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  revision: true,
                  effectiveDate: true,
                  status: true,
                  publishedAt: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!item) {
    throw new Error("Item publicado não encontrado.");
  }

  if (query.productId?.trim() && item.productId !== query.productId.trim()) {
    throw new Error("productId não corresponde ao item publicado.");
  }
  if (query.versionId?.trim() && item.priceTableVersionId !== query.versionId.trim()) {
    throw new Error("versionId não corresponde ao item publicado.");
  }
  if (query.tableId?.trim() && item.PriceTableVersion.priceTableId !== query.tableId.trim()) {
    throw new Error("tableId não corresponde ao item publicado.");
  }

  const version = item.PriceTableVersion;
  const table = version.PriceTable;
  const costSnapshot =
    item.costSnapshotJson != null && typeof item.costSnapshotJson === "object"
      ? (item.costSnapshotJson as Record<string, unknown>)
      : null;
  const formulaSnapshot =
    item.formulaSnapshotJson != null && typeof item.formulaSnapshotJson === "object"
      ? (item.formulaSnapshotJson as Record<string, unknown>)
      : null;

  const costFields = readCostSnapshotFields(costSnapshot);
  const formulaFields = readFormulaSnapshotFields(formulaSnapshot);

  const salePrice = decTrace(item.salePrice);
  const frozenTotalCost = decTrace(item.frozenTotalCost);
  const frozenMaterialCost = decTrace(item.frozenMaterialCost);
  const frozenHhCost = decTrace(item.frozenHhCost);
  const frozenHmCost = decTrace(item.frozenHmCost);
  const frozenTaxCost = decTrace(item.frozenTaxCost);
  const frozenOtherCost = decTrace(item.frozenOtherCost);
  const marginPct = decTrace(item.marginPct);
  const commissionPerc = decTrace(item.commissionPerc);
  const commissionValue = decTrace(item.commissionValue);

  const productionVersionId =
    costFields.productionCostTableVersionId ??
    formulaFields.productionCostTableVersionId ??
    version.productionCostTableVersionId ??
    version.productionCostTableVersion?.id ??
    null;

  let productionVersion = version.productionCostTableVersion;
  if (
    productionVersionId &&
    (!productionVersion || productionVersion.id !== productionVersionId)
  ) {
    productionVersion = await db.productionCostTableVersion.findUnique({
      where: { id: productionVersionId },
      include: {
        materialCostTableVersion: {
          select: {
            id: true,
            code: true,
            name: true,
            revision: true,
            effectiveDate: true,
            status: true,
            publishedAt: true,
          },
        },
      },
    });
  }

  let productionItem = null;
  const productionItemId = costFields.productionCostTableItemId;
  if (productionItemId) {
    productionItem = await db.productionCostTableItem.findUnique({
      where: { id: productionItemId },
      select: {
        id: true,
        unitProductionCost: true,
        materialCost: true,
        laborCost: true,
        machineCost: true,
        overheadCost: true,
      },
    });
  }

  const materialVersion = productionVersion?.materialCostTableVersion ?? null;

  let newerPublishedVersionWarning: string | null = null;
  if (productionVersion?.code) {
    const latestPublished = await db.productionCostTableVersion.findFirst({
      where: { code: productionVersion.code, status: "PUBLISHED" },
      orderBy: [{ revision: "desc" }, { publishedAt: "desc" }],
      select: { id: true, revision: true },
    });
    if (
      latestPublished &&
      latestPublished.id !== productionVersion.id &&
      latestPublished.revision > productionVersion.revision
    ) {
      newerPublishedVersionWarning = PUBLISHED_TRACE_NEWER_COST_WARNING;
    }
  }

  const taxRuleId = version.taxRuleId ?? formulaFields.taxRuleId;
  const taxRuleName = version.TaxRule?.name ?? null;
  const taxPercent =
    formulaFields.taxPercent ??
    (salePrice != null && frozenTaxCost != null && salePrice > 0
      ? (frozenTaxCost / salePrice) * 100
      : null);

  const publishedCommissionPercent =
    commissionPerc != null && commissionPerc > 0
      ? commissionPerc
      : formulaFields.commissionPercent;
  const publishedCommissionAmount = commissionValue;
  const commissionSourceLabel =
    version.commissionPerc != null
      ? "PRICE_TABLE_VERSION"
      : formulaSnapshot
        ? "FORMULA_SNAPSHOT"
        : commissionPerc != null
          ? "PRICE_TABLE_ITEM"
          : null;

  const freightAmount = formulaFields.freight;
  const freightPercent = formulaFields.freightPercent;
  const freightPercentAmount = deriveFreightPercentAmount({
    salePrice,
    freightPercent,
    totalFreightPercentFromOutputs: formulaFields.totalFreightPercentFromOutputs,
  });
  const otherVariablesAmount = deriveOtherVariablesAmount({
    frozenOtherCost,
    freight: freightAmount,
    freightPercentAmount,
    commissionValue: publishedCommissionAmount,
    salePrice,
    otherRate: formulaFields.otherRate,
  });

  const missingFields: string[] = [];
  if (!costSnapshot) missingFields.push("costSnapshotJson");
  if (!formulaSnapshot) missingFields.push("formulaSnapshotJson");
  if (!productionVersionId) missingFields.push("productionCostTableVersionId");
  if (!productionItemId) missingFields.push("productionCostTableItemId");
  if (!materialVersion) missingFields.push("materialCostTableVersion");
  if (!taxRuleId) missingFields.push("taxRuleId");
  if (marginPct == null) missingFields.push("marginPct");
  if (publishedCommissionPercent == null) missingFields.push("commissionPercent");

  const industrialCost = frozenTotalCost ?? costFields.unitProductionCost ?? decTrace(productionItem?.unitProductionCost);
  const factoryCost = industrialCost;
  const managerialCost = null;

  return {
    product: {
      productId: item.productId,
      sku: item.sku,
      name: item.productName,
      type: item.Product?.type ?? null,
      status: "AVAILABLE",
    },
    commercialPrice: {
      tableId: table.id,
      tableName: table.name,
      tableCode: table.code,
      versionId: version.id,
      versionNumber: version.versionNumber,
      priceItemId: item.id,
      salePrice,
      publishedAt: toIsoTrace(version.publishedAt),
      effectiveFrom: toIsoTrace(version.effectiveFrom),
      effectiveTo: toIsoTrace(version.effectiveTo),
      versionStatus: version.status,
      status: salePrice != null ? "AVAILABLE" : "NOT_AVAILABLE",
    },
    costSource: {
      productionCostTableVersionId: productionVersionId,
      productionCostTableCode:
        productionVersion?.code ?? costFields.productionCostTableVersionCode ?? formulaFields.productionCostTableVersionCode,
      productionCostTableName: productionVersion?.name ?? null,
      productionCostRevision:
        productionVersion?.revision ?? costFields.revision ?? formulaFields.productionCostRevision,
      productionCostEffectiveFrom: toIsoTrace(
        productionVersion?.effectiveDate ?? costFields.effectiveDate
      ),
      productionCostItemId: productionItemId,
      industrialCost,
      factoryCost,
      managerialCost,
      materialCostInPrice: frozenMaterialCost ?? decTrace(productionItem?.materialCost),
      laborCostInPrice: frozenHhCost ?? decTrace(productionItem?.laborCost),
      machineCostInPrice: frozenHmCost ?? decTrace(productionItem?.machineCost),
      status: traceStatus(productionVersionId != null, productionVersionId != null && !productionItemId),
      newerPublishedVersionWarning,
    },
    materialSource: {
      materialCostTableVersionId: materialVersion?.id ?? null,
      materialCostTableCode: materialVersion?.code ?? null,
      materialCostTableName: materialVersion?.name ?? null,
      materialCostRevision: materialVersion?.revision ?? null,
      materialCostEffectiveFrom: toIsoTrace(materialVersion?.effectiveDate),
      materialCostAmount: frozenMaterialCost,
      status: traceStatus(materialVersion != null || frozenMaterialCost != null, frozenMaterialCost != null && !materialVersion),
    },
    taxSource: {
      taxRuleId,
      taxRuleName,
      taxPercent,
      taxAmount: frozenTaxCost,
      status: traceStatus(taxRuleId != null && frozenTaxCost != null, frozenTaxCost != null && taxRuleId == null),
    },
    marginSource: {
      marginRuleId: null,
      marginName: null,
      targetMarginPercent: marginPct,
      publishedMarginPercent: marginPct,
      markup: computePublishedMarkup(salePrice, industrialCost),
      status: traceStatus(marginPct != null),
    },
    commissionSource: {
      commissionPercent: publishedCommissionPercent,
      commissionAmount: publishedCommissionAmount,
      source: commissionSourceLabel,
      status: traceStatus(
        publishedCommissionPercent != null || publishedCommissionAmount != null,
        publishedCommissionAmount != null && publishedCommissionPercent == null
      ),
    },
    deductions: {
      freightAmount,
      freightPercent,
      freightPercentAmount,
      otherVariablesAmount,
      roundingAmount: null,
      frozenOtherCostTotal: frozenOtherCost,
      status: traceStatus(
        frozenOtherCost != null || freightAmount != null || freightPercentAmount != null,
        frozenOtherCost != null
      ),
    },
    availability: {
      hasFullSnapshot: missingFields.length === 0,
      missingFields,
    },
  };
}

export { PUBLISHED_TRACE_UNAVAILABLE_LABEL } from "./publishedPriceSourceTrace.js";
