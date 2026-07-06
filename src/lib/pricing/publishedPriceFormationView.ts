import type { PricingOpenBookPayload } from "../pricingOpenBook.js";
import { naturePercentages } from "../openBookMaterialExplosion.js";
import { buildPricingUnitCalculationBreakdown } from "../pricingUnitCalculationBreakdown.js";
import type {
  CommercialPublishedPriceCell,
  CommercialPublishedPriceGridRow,
  CommercialPublishedPriceGridTable,
} from "./commercialPublishedPrices.types.js";

export const PUBLISHED_COMPOSITION_FALLBACK_NOTE =
  "Composição detalhada de MP/BOM não está congelada neste item publicado. Exibindo custos industriais publicados (MP/HH/HM) e taxas do snapshot da tabela.";

export const NO_PUBLISHED_PRICE_FOR_ROW_MESSAGE =
  "Este produto não possui preço publicado em nenhuma tabela comercial vigente.";

export type PublishedFormationMeta = {
  source: "PUBLISHED_PRICE_TABLE";
  productId: string;
  sku: string;
  productName: string;
  tableId: string;
  tableName: string;
  tableCode: string;
  versionId: string;
  versionNumber: number;
  priceItemId: string;
  publishedAt: string | null;
  clickedSalePrice: number | null;
  compositionFallbackNote: string | null;
};

export type PublishedPriceApiResponse = {
  priceSource?: string;
  priceTable?: {
    id: string;
    code: string;
    name: string;
    defaultMarginPct?: number;
    isPrimary?: boolean;
  };
  version?: {
    id: string;
    versionNumber: number;
    status?: string;
    publishedAt?: string | null;
    effectiveFrom?: string | null;
    taxRuleId?: string | null;
  };
  product?: {
    id: string;
    sku: string;
    name: string;
  };
  item?: {
    priceTableItemId: string;
    frozenTotalCost: number;
    frozenMaterialCost: number;
    frozenHhCost: number;
    frozenHmCost: number;
    frozenTaxCost: number;
    frozenOtherCost: number;
    marginPct: number;
    salePrice: number;
    commissionPerc: number;
    commissionValue: number;
    formulaSnapshotJson?: Record<string, unknown> | null;
    costSnapshotJson?: Record<string, unknown> | null;
  };
  proposalDefaults?: {
    freightValue?: number;
  };
};

export type PublishedFormationCalculationResult = {
  product: string;
  sku: string;
  ciu: number;
  custoFabril: number;
  custoGerencial: number;
  premissas: {
    taxRate: number;
    commRate: number;
    marginRate: number;
    freight: number;
    otherRate?: number;
  };
  resultados: {
    suggestedPrice: number;
    totalTaxes: number;
    totalCommission: number;
    contributionMargin: number;
    operationalMargin: number;
    markup: number;
  };
  openBook?: PricingOpenBookPayload | null;
  pricingBreakdown?: ReturnType<typeof buildPricingUnitCalculationBreakdown> | null;
  publishedMeta: PublishedFormationMeta;
};

function readRatesFromFormula(formulaSnapshotJson: Record<string, unknown> | null | undefined) {
  const rates =
    formulaSnapshotJson?.rates != null && typeof formulaSnapshotJson.rates === "object"
      ? (formulaSnapshotJson.rates as Record<string, unknown>)
      : {};
  const taxRate = Number(rates.taxRate);
  const commissionRate = Number(rates.commissionRate);
  const otherRate = Number(rates.otherRate);
  const freight = Number(formulaSnapshotJson?.freight);
  const divisor = Number(formulaSnapshotJson?.divisor);
  return {
    taxRate: Number.isFinite(taxRate) ? taxRate : null,
    commissionRate: Number.isFinite(commissionRate) ? commissionRate : null,
    otherRate: Number.isFinite(otherRate) ? otherRate : null,
    freight: Number.isFinite(freight) ? freight : 0,
    divisor: Number.isFinite(divisor) ? divisor : null,
  };
}

export function resolveDefaultPublishedTableSelection(
  tables: Array<Pick<CommercialPublishedPriceGridTable, "tableId" | "tableCode" | "tableName"> & { isPrimary?: boolean }>,
  options?: { primaryTableId?: string | null }
): (typeof tables)[number] | null {
  if (tables.length === 0) return null;
  const markedPrimary = tables.find((table) => table.isPrimary === true);
  if (markedPrimary) return markedPrimary;
  const primaryId = options?.primaryTableId?.trim();
  if (primaryId) {
    const byId = tables.find((table) => table.tableId === primaryId);
    if (byId) return byId;
  }
  return tables[0] ?? null;
}

export function isPublishedPriceCellClickable(
  price: CommercialPublishedPriceCell | null | undefined
): price is CommercialPublishedPriceCell & { priceItemId: string; salePrice: number } {
  return price?.status === "PUBLISHED" && price.priceItemId != null && price.salePrice != null;
}

export function resolvePublishedPriceCellSelection(
  row: CommercialPublishedPriceGridRow,
  tables: CommercialPublishedPriceGridTable[],
  tableId: string
): { table: CommercialPublishedPriceGridTable; price: CommercialPublishedPriceCell & { priceItemId: string; salePrice: number } } | null {
  const table = tables.find((entry) => entry.tableId === tableId);
  const price = row.prices.find((entry) => entry.tableId === tableId);
  if (!table || !isPublishedPriceCellClickable(price)) return null;
  return { table, price };
}

export function resolvePublishedPriceSelectionForRow(
  row: CommercialPublishedPriceGridRow,
  tables: CommercialPublishedPriceGridTable[],
  options?: { preferredTableId?: string | null; primaryTableId?: string | null }
): { table: CommercialPublishedPriceGridTable; price: CommercialPublishedPriceCell } | null {
  const orderedTableIds = [
    ...(options?.preferredTableId ? [options.preferredTableId] : []),
    ...(resolveDefaultPublishedTableSelection(tables, options)
      ? [resolveDefaultPublishedTableSelection(tables, options)!.tableId]
      : []),
    ...tables.map((table) => table.tableId),
  ].filter((value, index, array) => array.indexOf(value) === index);

  for (const tableId of orderedTableIds) {
    const table = tables.find((entry) => entry.tableId === tableId);
    const price = row.prices.find(
      (entry) =>
        entry.tableId === tableId &&
        entry.status === "PUBLISHED" &&
        entry.priceItemId != null &&
        entry.salePrice != null
    );
    if (table && price) return { table, price };
  }

  return null;
}

function buildPublishedOpenBookFromFrozenItem(item: NonNullable<PublishedPriceApiResponse["item"]>) {
  const mp = Number(item.frozenMaterialCost) || 0;
  const hh = Number(item.frozenHhCost) || 0;
  const hm = Number(item.frozenHmCost) || 0;
  const total = Number(item.frozenTotalCost) || 0;
  if (total <= 0) return null;
  const nature = naturePercentages(mp, hh, hm);
  return {
    executive: {
      totalIndustrialCost: total,
      totalMaterialCost: mp,
      totalHH: hh,
      totalHM: hm,
      pctMp: nature.pctMp,
      pctHh: nature.pctHh,
      pctHm: nature.pctHm,
      denominatorIndustrial: nature.base,
    },
    consolidatedMaterials: [],
    compositionFallbackNote: PUBLISHED_COMPOSITION_FALLBACK_NOTE,
  } satisfies PricingOpenBookPayload & { compositionFallbackNote?: string };
}

export function mapPublishedPriceApiToFormationResult(
  api: PublishedPriceApiResponse,
  selection: {
    table: Pick<CommercialPublishedPriceGridTable, "tableId" | "tableName" | "tableCode" | "versionId" | "versionNumber" | "publishedAt">;
    priceItemId: string;
    clickedSalePrice?: number | null;
    sku: string;
    productName: string;
    productId: string;
    taxRuleName?: string | null;
    taxRuleId?: string | null;
  }
): PublishedFormationCalculationResult {
  const item = api.item;
  if (!item) {
    throw new Error("Resposta de preço publicado sem item.");
  }

  const salePrice = Number(item.salePrice);
  const custoFabril = Number(item.frozenTotalCost);
  const marginRate = Number(item.marginPct) / 100;
  const commRateFromColumn = Number(item.commissionPerc) / 100;
  const formulaRates = readRatesFromFormula(item.formulaSnapshotJson ?? null);
  const commRate =
    commRateFromColumn > 0
      ? commRateFromColumn
      : formulaRates.commissionRate != null
        ? formulaRates.commissionRate
        : salePrice > 0
          ? Number(item.commissionValue) / salePrice
          : 0;
  const taxRate =
    formulaRates.taxRate != null
      ? formulaRates.taxRate
      : salePrice > 0
        ? Number(item.frozenTaxCost) / salePrice
        : 0;
  const otherRate = formulaRates.otherRate ?? 0;
  const freight = formulaRates.freight || Number(api.proposalDefaults?.freightValue ?? 0);
  const divisor =
    formulaRates.divisor ??
    1 - taxRate - commRate - otherRate - marginRate;

  const totalTaxes = Number(item.frozenTaxCost);
  const totalCommission = Number(item.commissionValue);
  const totalOther = salePrice * otherRate;
  const contributionMargin = salePrice - totalTaxes - totalCommission - freight - custoFabril;
  const opex = 0;
  const custoGerencial = custoFabril + opex;
  const operationalMargin = contributionMargin - opex;
  const openBook = buildPublishedOpenBookFromFrozenItem(item);

  const pricingBreakdown = buildPricingUnitCalculationBreakdown({
    custoFabril,
    custoGerencial,
    totalMaterialCost: Number(item.frozenMaterialCost),
    totalHH_Unit: Number(item.frozenHhCost),
    totalHM_Unit: Number(item.frozenHmCost),
    totalCIF_Unit: 0,
    totalOPEX_Unit: opex,
    taxRuleName: selection.taxRuleName ?? null,
    taxRuleId: selection.taxRuleId ?? "published",
    taxRate,
    commRate,
    marginRate,
    otherRate,
    freight,
    divisor,
    suggestedPrice: salePrice,
    totalTaxes,
    totalCommission,
    totalOther,
    contributionMargin,
    operationalMargin,
    openBookConsolidatedMaterials: null,
    bomMaterialsDetail: null,
    processBreakdown: null,
  });

  const publishedMeta: PublishedFormationMeta = {
    source: "PUBLISHED_PRICE_TABLE",
    productId: selection.productId,
    sku: selection.sku,
    productName: selection.productName,
    tableId: selection.table.tableId,
    tableName: selection.table.tableName,
    tableCode: selection.table.tableCode,
    versionId: selection.table.versionId,
    versionNumber: selection.table.versionNumber,
    priceItemId: selection.priceItemId,
    publishedAt: selection.table.publishedAt,
    clickedSalePrice: selection.clickedSalePrice ?? salePrice,
    compositionFallbackNote: openBook ? PUBLISHED_COMPOSITION_FALLBACK_NOTE : null,
  };

  return {
    product: selection.productName,
    sku: selection.sku,
    ciu: custoFabril,
    custoFabril,
    custoGerencial,
    premissas: {
      taxRate: taxRate * 100,
      commRate: commRate * 100,
      marginRate: marginRate * 100,
      freight,
      otherRate: otherRate * 100,
    },
    resultados: {
      suggestedPrice: salePrice,
      totalTaxes,
      totalCommission,
      contributionMargin,
      operationalMargin,
      markup: custoFabril > 0 ? salePrice / custoFabril : 0,
    },
    openBook,
    pricingBreakdown,
    publishedMeta,
  };
}

export function buildPublishedPriceRequestUrl(tableId: string, productId: string): string {
  return `/api/price-tables/${tableId}/products/${productId}/published-price`;
}
