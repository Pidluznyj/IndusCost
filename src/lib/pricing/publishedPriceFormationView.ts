import type { PricingOpenBookPayload } from "../pricingOpenBook.js";
import { naturePercentages } from "../openBookMaterialExplosion.js";
import type {
  CommercialPublishedPriceCell,
  CommercialPublishedPriceGridRow,
  CommercialPublishedPriceGridTable,
} from "./commercialPublishedPrices.types.js";

export const PUBLISHED_COMPOSITION_FALLBACK_NOTE =
  "Composição detalhada de MP/BOM não está congelada neste item publicado. Exibindo custos industriais publicados (MP/HH/HM) e taxas do snapshot da tabela.";

export const PUBLISHED_DETAIL_UNAVAILABLE_NOTE =
  "Detalhe publicado indisponível para esta versão. Exibindo resumo publicado.";

export const PUBLISHED_FIELD_UNAVAILABLE_LABEL = "Não disponível nesta versão";

export const NO_PUBLISHED_PRICE_FOR_ROW_MESSAGE =
  "Este produto não possui preço publicado em nenhuma tabela comercial vigente.";

export type PublishedFormationViewMode = "PUBLISHED" | "LIVE_SIMULATION";

export type PublishedUnavailableField =
  | "taxRatePercent"
  | "commissionRatePercent"
  | "otherRatePercent"
  | "freight"
  | "freightPercent"
  | "markup"
  | "contributionMargin"
  | "operationalMargin"
  | "custoGerencial"
  | "otherDeductions"
  | "detailedComposition"
  | "productionCostReference";

export type PublishedFormationMeta = {
  viewMode: "PUBLISHED";
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
  detailUnavailableNote: string;
  unavailableFields: PublishedUnavailableField[];
  hasDetailedComposition: false;
  publishedSummary: {
    salePrice: number;
    marginPercent: number | null;
    commissionPercent: number | null;
    commissionValue: number | null;
    freightPercent: number | null;
    taxAmount: number | null;
    frozenTotalCost: number | null;
    frozenOtherCost: number | null;
  };
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
  viewMode: "PUBLISHED";
  product: string;
  sku: string;
  ciu: number;
  custoFabril: number;
  custoGerencial: number | null;
  premissas: {
    taxRate: number | null;
    commRate: number | null;
    marginRate: number | null;
    freight: number | null;
    freightPercent: number | null;
    otherRate: number | null;
  };
  resultados: {
    suggestedPrice: number;
    totalTaxes: number | null;
    totalCommission: number | null;
    contributionMargin: number | null;
    operationalMargin: number | null;
    markup: number | null;
    frozenOtherCost: number | null;
  };
  openBook?: PricingOpenBookPayload | null;
  pricingBreakdown: null;
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
  const freightRateFromRates = Number(rates.freightRate);
  const freightPercentFromSnapshot = Number(formulaSnapshotJson?.freightPercent);
  let freightPercent: number | null = null;
  if (Number.isFinite(freightPercentFromSnapshot)) {
    freightPercent = freightPercentFromSnapshot;
  } else if (Number.isFinite(freightRateFromRates)) {
    freightPercent = freightRateFromRates * 100;
  }
  return {
    taxRate: Number.isFinite(taxRate) ? taxRate : null,
    commissionRate: Number.isFinite(commissionRate) ? commissionRate : null,
    otherRate: Number.isFinite(otherRate) ? otherRate : null,
    freight: Number.isFinite(freight) ? freight : 0,
    freightPercent,
  };
}

export function isPublishedFieldUnavailable(
  meta: Pick<PublishedFormationMeta, "unavailableFields"> | null | undefined,
  field: PublishedUnavailableField
): boolean {
  return meta?.unavailableFields.includes(field) ?? false;
}

export function formatPublishedFormationValue(
  meta: Pick<PublishedFormationMeta, "unavailableFields"> | null | undefined,
  field: PublishedUnavailableField,
  value: number | null | undefined,
  format: (amount: number) => string
): string {
  if (meta && isPublishedFieldUnavailable(meta, field)) {
    return PUBLISHED_FIELD_UNAVAILABLE_LABEL;
  }
  if (value == null || !Number.isFinite(value)) {
    return PUBLISHED_FIELD_UNAVAILABLE_LABEL;
  }
  return format(value);
}

export function formatPublishedFormationPercent(
  meta: Pick<PublishedFormationMeta, "unavailableFields"> | null | undefined,
  field: PublishedUnavailableField,
  value: number | null | undefined,
  decimals = 2
): string {
  return formatPublishedFormationValue(meta, field, value, (amount) => `${amount.toFixed(decimals)}%`);
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

function readNullableNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

  const unavailableFields: PublishedUnavailableField[] = [
    "operationalMargin",
    "custoGerencial",
    "detailedComposition",
  ];

  const salePrice = readNullableNumber(item.salePrice);
  if (salePrice == null) {
    throw new Error("Item publicado sem preço de venda congelado.");
  }

  const custoFabril = readNullableNumber(item.frozenTotalCost);
  const frozenTaxCost = readNullableNumber(item.frozenTaxCost);
  const commissionValue = readNullableNumber(item.commissionValue);
  const frozenOtherCost = readNullableNumber(item.frozenOtherCost);
  const marginPct = readNullableNumber(item.marginPct);
  const commissionPerc = readNullableNumber(item.commissionPerc);

  const formulaRates = readRatesFromFormula(item.formulaSnapshotJson ?? null);
  const hasFormulaSnapshot = item.formulaSnapshotJson != null && typeof item.formulaSnapshotJson === "object";

  const taxRate = formulaRates.taxRate;
  if (taxRate == null) unavailableFields.push("taxRatePercent");

  const commRate =
    commissionPerc != null && commissionPerc > 0
      ? commissionPerc / 100
      : formulaRates.commissionRate;
  if (commRate == null) unavailableFields.push("commissionRatePercent");

  const otherRate = formulaRates.otherRate;
  if (otherRate == null) unavailableFields.push("otherRatePercent");

  const freight = hasFormulaSnapshot ? formulaRates.freight : null;
  if (!hasFormulaSnapshot || freight == null) unavailableFields.push("freight");

  const freightPercent = hasFormulaSnapshot ? formulaRates.freightPercent : null;
  if (hasFormulaSnapshot && freightPercent == null) {
    // Legado sem frete % — não marca indisponível; UI trata null como "não informado".
  }

  const markup = custoFabril != null && custoFabril > 0 ? salePrice / custoFabril : null;
  if (markup == null) unavailableFields.push("markup");

  const freightPercentValue =
    freightPercent != null && Number.isFinite(freightPercent)
      ? (salePrice * freightPercent) / 100
      : 0;

  let contributionMargin: number | null = null;
  if (
    frozenTaxCost != null &&
    commissionValue != null &&
    custoFabril != null &&
    freight != null
  ) {
    contributionMargin =
      salePrice - frozenTaxCost - commissionValue - freight - freightPercentValue - custoFabril;
  } else {
    unavailableFields.push("contributionMargin");
  }

  if (frozenOtherCost == null) unavailableFields.push("otherDeductions");
  if (item.costSnapshotJson == null) unavailableFields.push("productionCostReference");

  const openBook = buildPublishedOpenBookFromFrozenItem(item);

  const publishedMeta: PublishedFormationMeta = {
    viewMode: "PUBLISHED",
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
    detailUnavailableNote: PUBLISHED_DETAIL_UNAVAILABLE_NOTE,
    unavailableFields: [...new Set(unavailableFields)],
    hasDetailedComposition: false,
    publishedSummary: {
      salePrice,
      marginPercent: marginPct,
      commissionPercent: commissionPerc,
      commissionValue,
      freightPercent,
      taxAmount: frozenTaxCost,
      frozenTotalCost: custoFabril,
      frozenOtherCost,
    },
  };

  return {
    viewMode: "PUBLISHED",
    product: selection.productName,
    sku: selection.sku,
    ciu: custoFabril ?? 0,
    custoFabril: custoFabril ?? 0,
    custoGerencial: null,
    premissas: {
      taxRate: taxRate != null ? taxRate * 100 : null,
      commRate: commRate != null ? commRate * 100 : null,
      marginRate: marginPct,
      freight,
      freightPercent,
      otherRate: otherRate != null ? otherRate * 100 : null,
    },
    resultados: {
      suggestedPrice: salePrice,
      totalTaxes: frozenTaxCost,
      totalCommission: commissionValue,
      contributionMargin,
      operationalMargin: null,
      markup,
      frozenOtherCost,
    },
    openBook,
    pricingBreakdown: null,
    publishedMeta,
  };
}

export function buildPublishedPriceRequestUrl(tableId: string, productId: string): string {
  return `/api/price-tables/${tableId}/products/${productId}/published-price`;
}
