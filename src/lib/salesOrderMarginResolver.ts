/**
 * Tipos e resolução pura de produto/receita para margem de Pedidos de Venda.
 * Sem Prisma — seguro para testes e importação indireta no frontend (apenas tipos/funções puras).
 */
import { normalizeSku } from "./nomusBomComparison.js";
import { toCivilDateKey } from "./financeCivilDate.js";
import type { EffectiveProductProductionCostResult } from "./productionCostVersioning.js";
import { effectiveProductionCostLookupKey } from "./productionCostVersioning.js";
import {
  extractOfficialProductFinalUnitCost,
  resolveOfficialProductFinalCostFromAnalysis,
  isOfficialProductFinalCostFailure,
} from "./productOfficialFinalCost.js";
import type {
  SalesOrderCostConfidence,
  SalesOrderCostSource,
  SalesOrderMarginCostMode,
  SalesOrderMarginCostPolicy,
  SalesOrderMarginItemInput,
  SalesOrderMarginProductionCostMeta,
} from "./salesOrderMarginTypes.js";
import { DEFAULT_SALES_ORDER_MARGIN_COST_POLICY } from "./salesOrderMarginTypes.js";

export type ProductResolutionSource =
  | "LOCAL_PRODUCT_ID"
  | "EXTERNAL_PRODUCT_ID"
  | "SKU"
  | "RAW_NOMUS_CODE"
  | "NOT_FOUND";

export type ProductResolution = {
  salesOrderItemId: string;
  productId: string | null;
  productSku: string | null;
  productName: string | null;
  resolutionSource: ProductResolutionSource;
  confidence: SalesOrderCostConfidence;
  notes: string[];
};

export type CostResolution = {
  salesOrderItemId: string;
  productId: string | null;
  unitCost: number | null;
  costSource: SalesOrderCostSource;
  costConfidence: SalesOrderCostConfidence;
  marginCostMode: SalesOrderMarginCostMode;
  calculatedAt?: string;
  productionCost?: SalesOrderMarginProductionCostMeta | null;
  notes: string[];
};

export type SalesOrderMarginResolverProductRow = {
  id: string;
  sku: string;
  name: string;
  sourceExternalId?: string | null;
};

export type SalesOrderMarginResolverItem = {
  salesOrderItemId: string;
  productId?: string | null;
  externalProductId?: number | string | null;
  skuSnapshot?: string | null;
  productNameSnapshot?: string | null;
  quantity: unknown;
  /** Preço unitário negociado (`SalesOrderItem.negotiatedPrice`). */
  negotiatedPrice?: unknown;
  /** Receita líquida da linha (`SalesOrderItem.totalNetValue`). */
  totalNetValue?: unknown;
  /** Preço unitário comercial persistido (`SalesOrderItem.unitCost`) — espelho Nomus; não usar como custo de produção na margem. */
  unitCost?: unknown | null;
  itemStatus?: string | number | null;
  isCanceled?: boolean;
  /** Payload bruto do item Nomus (`itensPedido[]`), quando disponível. */
  nomusRawItem?: Record<string, unknown> | null;
  /** Data de referência para custo vigente (SalesOrder.issueDate). */
  referenceDate?: Date | string | null;
};

export type SalesOrderMarginProductBatchIndex = {
  byId: Map<string, SalesOrderMarginResolverProductRow>;
  bySourceExternalId: Map<string, SalesOrderMarginResolverProductRow>;
  bySku: Map<string, SalesOrderMarginResolverProductRow>;
  byExternalProductId: Map<string, SalesOrderMarginResolverProductRow>;
  catalogSkuByExternalId: Map<string, string>;
};

export type SalesOrderMarginCostLogSnapshot = {
  totalCiu: number;
  calculatedAt: string;
};

export type SalesOrderMarginProductCostPayload = {
  analysis?: unknown;
  costLog?: SalesOrderMarginCostLogSnapshot | null;
};

export type SalesOrderMarginProductCostResolver = (
  productId: string
) => Promise<SalesOrderMarginProductCostPayload>;

function safeFinite(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Valor numérico > 0 em SalesOrderItem.unitCost (campo comercial Nomus — não custo industrial). */
export function parseSalesOrderItemStoredUnitCost(value: unknown): number | null {
  const n = safeFinite(value);
  return n != null && n > 0 ? n : null;
}

/** @deprecated SalesOrderItem.unitCost não indica snapshot de custo de produção. */
export function hasSalesOrderItemUnitCostSnapshot(storedUnitCost: unknown): boolean {
  return parseSalesOrderItemStoredUnitCost(storedUnitCost) != null;
}

export function resolveSalesOrderMarginCostMode(
  costSource: SalesOrderCostSource
): SalesOrderMarginCostMode {
  switch (costSource) {
    case "HISTORICAL_SNAPSHOT":
    case "VERSIONED_PRODUCTION_COST":
    case "MANUAL_COST":
      return "HISTORICAL_FROZEN";
    case "LIVE_PRODUCT_COST":
    case "RECALCULATED_CURRENT_COST":
    case "OFFICIAL_FINAL_COST":
    case "CURRENT_ENGINEERING_COST":
    case "CURRENT_COST":
      return "LIVE_ESTIMATE";
    default:
      return "MISSING";
  }
}

function asString(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

function toInt(value: unknown): number | null {
  const n = safeFinite(value);
  if (n == null) return null;
  const i = Math.trunc(n);
  return Number.isFinite(i) ? i : null;
}

export function createEmptySalesOrderMarginProductBatchIndex(): SalesOrderMarginProductBatchIndex {
  return {
    byId: new Map(),
    bySourceExternalId: new Map(),
    bySku: new Map(),
    byExternalProductId: new Map(),
    catalogSkuByExternalId: new Map(),
  };
}

export function indexSalesOrderMarginProducts(
  products: SalesOrderMarginResolverProductRow[]
): SalesOrderMarginProductBatchIndex {
  const index = createEmptySalesOrderMarginProductBatchIndex();
  for (const product of products) {
    index.byId.set(product.id, product);
    index.bySku.set(normalizeSku(product.sku), product);
    if (product.sourceExternalId?.trim()) {
      index.bySourceExternalId.set(product.sourceExternalId.trim(), product);
    }
  }
  return index;
}

export function registerSalesOrderMarginExternalProductMapping(
  index: SalesOrderMarginProductBatchIndex,
  externalProductId: string | number,
  product: SalesOrderMarginResolverProductRow
): void {
  index.byExternalProductId.set(String(externalProductId), product);
}

export function registerSalesOrderMarginCatalogMapping(
  index: SalesOrderMarginProductBatchIndex,
  externalProductId: string | number,
  catalogCode: string
): void {
  index.catalogSkuByExternalId.set(String(externalProductId), catalogCode);
}

function lookupProductBySku(
  index: SalesOrderMarginProductBatchIndex,
  sku: string | null | undefined
): SalesOrderMarginResolverProductRow | null {
  if (!sku?.trim()) return null;
  return index.bySku.get(normalizeSku(sku)) ?? null;
}

function extractNomusRawProductCode(raw: Record<string, unknown> | null | undefined): string | null {
  if (!raw) return null;
  return asString(raw.codigo) ?? asString(raw.codigoProduto);
}

function extractNomusRawProductId(raw: Record<string, unknown> | null | undefined): string | null {
  if (!raw) return null;
  const id = toInt(raw.idProduto) ?? toInt(raw.id);
  return id != null ? String(id) : null;
}

/**
 * Resolve produto local para um item (função pura com índice pré-carregado).
 */
export function resolveSalesOrderItemProduct(
  item: SalesOrderMarginResolverItem,
  index: SalesOrderMarginProductBatchIndex
): ProductResolution {
  const notes: string[] = [];
  const base = {
    salesOrderItemId: item.salesOrderItemId,
    productId: null as string | null,
    productSku: item.skuSnapshot ?? null,
    productName: item.productNameSnapshot ?? null,
    resolutionSource: "NOT_FOUND" as ProductResolutionSource,
    confidence: "MISSING" as SalesOrderCostConfidence,
    notes,
  };

  if (item.productId && index.byId.has(item.productId)) {
    const product = index.byId.get(item.productId)!;
    notes.push("Produto resolvido por productId local do SalesOrderItem.");
    return {
      ...base,
      productId: product.id,
      productSku: product.sku,
      productName: product.name,
      resolutionSource: "LOCAL_PRODUCT_ID",
      confidence: "HIGH",
    };
  }

  const externalId =
    item.externalProductId != null && String(item.externalProductId).trim() !== ""
      ? String(item.externalProductId)
      : extractNomusRawProductId(item.nomusRawItem);

  if (externalId) {
    const byExt =
      index.byExternalProductId.get(externalId) ??
      index.bySourceExternalId.get(externalId);
    if (byExt) {
      notes.push(`Produto resolvido por externalProductId=${externalId}.`);
      return {
        ...base,
        productId: byExt.id,
        productSku: byExt.sku,
        productName: byExt.name,
        resolutionSource: "EXTERNAL_PRODUCT_ID",
        confidence: "HIGH",
      };
    }

    const catalogCode = index.catalogSkuByExternalId.get(externalId);
    const fromCatalog = lookupProductBySku(index, catalogCode);
    if (fromCatalog) {
      notes.push(`Produto resolvido via catálogo Nomus (externalProductId=${externalId}).`);
      return {
        ...base,
        productId: fromCatalog.id,
        productSku: fromCatalog.sku,
        productName: fromCatalog.name,
        resolutionSource: "EXTERNAL_PRODUCT_ID",
        confidence: "MEDIUM",
      };
    }
  }

  const rawCode = extractNomusRawProductCode(item.nomusRawItem);
  const skuCandidates = [item.skuSnapshot, rawCode].filter(Boolean) as string[];

  for (const sku of skuCandidates) {
    const found = lookupProductBySku(index, sku);
    if (found) {
      notes.push(
        rawCode && normalizeSku(sku) === normalizeSku(rawCode)
          ? "Produto resolvido por código Nomus bruto."
          : "Produto resolvido por SKU normalizado."
      );
      return {
        ...base,
        productId: found.id,
        productSku: found.sku,
        productName: found.name,
        resolutionSource:
          rawCode && normalizeSku(sku) === normalizeSku(rawCode) ? "RAW_NOMUS_CODE" : "SKU",
        confidence: "MEDIUM",
      };
    }
  }

  notes.push("Nenhum produto local encontrado para o item.");
  return base;
}

export function resolveSalesOrderItemProducts(
  items: SalesOrderMarginResolverItem[],
  index: SalesOrderMarginProductBatchIndex
): Map<string, ProductResolution> {
  const map = new Map<string, ProductResolution>();
  for (const item of items) {
    map.set(item.salesOrderItemId, resolveSalesOrderItemProduct(item, index));
  }
  return map;
}

/**
 * Receita líquida do item — campos reais:
 * 1. SalesOrderItem.totalNetValue
 * 2. quantity × SalesOrderItem.negotiatedPrice
 * 3. Nomus bruto: valorTotal | valorTotalItem | valorLiquido ou qtd×unitário − desconto + acréscimo
 */
export function extractSalesOrderItemRevenue(item: SalesOrderMarginResolverItem): {
  netTotalValue: number | null;
  netUnitPrice: number | null;
  notes: string[];
} {
  const notes: string[] = [];
  const quantity = safeFinite(item.quantity) ?? 0;
  const storedNet = safeFinite(item.totalNetValue);
  if (storedNet != null) {
    notes.push("Receita líquida de SalesOrderItem.totalNetValue.");
    const unit = quantity > 0 ? storedNet / quantity : safeFinite(item.negotiatedPrice);
    return { netTotalValue: storedNet, netUnitPrice: unit, notes };
  }

  const negotiated = safeFinite(item.negotiatedPrice);
  if (negotiated != null && quantity > 0) {
    notes.push("Receita líquida calculada de quantity × negotiatedPrice.");
    return {
      netTotalValue: quantity * negotiated,
      netUnitPrice: negotiated,
      notes,
    };
  }

  const raw = item.nomusRawItem;
  if (raw) {
    const q = safeFinite(raw.quantidade) ?? quantity;
    const unitPrice = safeFinite(raw.valorUnitario);
    const discount = safeFinite(raw.valorDesconto) ?? 0;
    const addition = safeFinite(raw.valorAcrescimo) ?? 0;
    const computed = q * (unitPrice ?? 0) - discount + addition;
    const explicit =
      safeFinite(raw.valorTotal) ??
      safeFinite(raw.valorTotalItem) ??
      safeFinite(raw.valorLiquido);
    const net = explicit != null && explicit > 0 ? explicit : computed > 0 ? computed : null;
    if (net != null) {
      notes.push("Receita líquida derivada do payload Nomus do item.");
      return {
        netTotalValue: net,
        netUnitPrice: q > 0 ? net / q : unitPrice,
        notes,
      };
    }
  }

  notes.push("Receita líquida indisponível.");
  return { netTotalValue: null, netUnitPrice: negotiated, notes };
}

export function resolveSalesOrderItemCost(input: {
  salesOrderItemId: string;
  productId: string | null;
  storedUnitCost?: unknown | null;
  costLog?: SalesOrderMarginCostLogSnapshot | null;
  analysis?: unknown;
  costPolicy?: SalesOrderMarginCostPolicy;
}): CostResolution {
  const costPolicy = input.costPolicy ?? DEFAULT_SALES_ORDER_MARGIN_COST_POLICY;
  const notes: string[] = [];
  const base: CostResolution = {
    salesOrderItemId: input.salesOrderItemId,
    productId: input.productId,
    unitCost: null,
    costSource: "MISSING_COST",
    costConfidence: "MISSING",
    marginCostMode: "MISSING",
    notes,
  };

  if (!input.productId) {
    notes.push("Custo não resolvido: produto ausente.");
    return base;
  }

  if (!costPolicy.allowLiveCostFallback) {
    notes.push("Fallback de custo estimado desabilitado pela configuração de margem Nomus.");
    return base;
  }

  if (input.costLog && safeFinite(input.costLog.totalCiu) != null && input.costLog.totalCiu > 0) {
    notes.push("Custo de CostCalculationLog (snapshot histórico do motor).");
    return {
      ...base,
      unitCost: input.costLog.totalCiu,
      costSource: "HISTORICAL_SNAPSHOT",
      costConfidence: "MEDIUM",
      marginCostMode: "HISTORICAL_FROZEN",
      calculatedAt: input.costLog.calculatedAt,
      notes,
    };
  }

  if (input.analysis != null) {
    const resolved = resolveOfficialProductFinalCostFromAnalysis(input.analysis);
    if (!isOfficialProductFinalCostFailure(resolved)) {
      const partial = resolved.costAnalysisPartial;
      notes.push(
        partial
          ? "Custo atual parcial via getProductCostAnalysis — estimativa recalculada, não histórica."
          : "Custo atual via getProductCostAnalysis — estimativa viva, não histórica."
      );
      return {
        ...base,
        unitCost: resolved.finalUnitCost,
        costSource: partial ? "RECALCULATED_CURRENT_COST" : "LIVE_PRODUCT_COST",
        costConfidence: partial ? "MEDIUM" : "HIGH",
        marginCostMode: "LIVE_ESTIMATE",
        notes,
      };
    }

    const diag = resolved.diagnostics[0];
    notes.push(diag?.message ?? "Motor de custo retornou falha.");
    return base;
  }

  notes.push("Análise de custo não disponível para o produto.");
  return base;
}

function readPartialWarningFromSnapshot(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const row = snapshot as Record<string, unknown>;
  if (row.costAnalysisPartial === true) {
    return "Custo publicado com análise parcial no snapshot.";
  }
  return null;
}

export function mapEffectiveProductionCostToMarginMeta(
  effective: Extract<EffectiveProductProductionCostResult, { status: "OK" }>,
  orderIssueDate: Date | string | null | undefined
): SalesOrderMarginProductionCostMeta {
  const warning = readPartialWarningFromSnapshot(effective.calculationSnapshot);
  return {
    costTableVersionId: effective.costTableVersionId,
    costTableItemId: effective.costTableItemId,
    versionCode: effective.versionCode,
    versionName: effective.versionName,
    revision: effective.revision,
    effectiveDate: toCivilDateKey(effective.effectiveDate) ?? effective.effectiveDate.toISOString(),
    publishedAt: effective.publishedAt?.toISOString() ?? null,
    orderIssueDate: orderIssueDate ? toCivilDateKey(orderIssueDate) : null,
    warning,
  };
}

/**
 * Custo oficial de margem: tabela versionada vigente na data do pedido (nunca DRAFT, nunca unitCost Nomus).
 */
export function resolveSalesOrderItemCostFromVersionedProduction(
  input: {
    salesOrderItemId: string;
    productId: string | null;
    referenceDate?: Date | string | null;
    effectiveCost?: EffectiveProductProductionCostResult | null;
  }
): CostResolution {
  const notes: string[] = [];
  const base: CostResolution = {
    salesOrderItemId: input.salesOrderItemId,
    productId: input.productId,
    unitCost: null,
    costSource: "MISSING_COST",
    costConfidence: "MISSING",
    marginCostMode: "MISSING",
    productionCost: null,
    notes,
  };

  if (!input.productId) {
    notes.push("Custo não resolvido: produto ausente.");
    return base;
  }

  if (!input.referenceDate) {
    notes.push("Custo não resolvido: SalesOrder.issueDate ausente.");
    return base;
  }

  const effective = input.effectiveCost;
  if (!effective || effective.status === "SEM_CUSTO") {
    notes.push(
      "SEM_CUSTO — nenhuma tabela oficial vigente para o produto na data do pedido."
    );
    return base;
  }

  const meta = mapEffectiveProductionCostToMarginMeta(effective, input.referenceDate);
  if (meta.warning) notes.push(meta.warning);
  notes.push(
    `Custo de produção IndusCost — tabela ${meta.versionCode} rev.${meta.revision} vigente em ${meta.effectiveDate}.`
  );

  return {
    ...base,
    unitCost: effective.unitProductionCost,
    costSource: "VERSIONED_PRODUCTION_COST",
    costConfidence: meta.warning ? "MEDIUM" : "HIGH",
    marginCostMode: "HISTORICAL_FROZEN",
    productionCost: meta,
    notes,
  };
}

export async function resolveSalesOrderItemCostsFromVersionedProduction(
  items: SalesOrderMarginResolverItem[],
  productResolutions: Map<string, ProductResolution>,
  effectiveCostsByLookupKey: Map<string, EffectiveProductProductionCostResult>
): Promise<Map<string, CostResolution>> {
  const map = new Map<string, CostResolution>();
  for (const item of items) {
    const product = productResolutions.get(item.salesOrderItemId);
    const productId = product?.productId ?? null;
    let effective: EffectiveProductProductionCostResult | null = null;
    if (productId && item.referenceDate) {
      const ref =
        item.referenceDate instanceof Date
          ? item.referenceDate
          : new Date(item.referenceDate);
      const key = effectiveProductionCostLookupKey(productId, ref);
      effective = effectiveCostsByLookupKey.get(key) ?? null;
    }
    map.set(
      item.salesOrderItemId,
      resolveSalesOrderItemCostFromVersionedProduction({
        salesOrderItemId: item.salesOrderItemId,
        productId,
        referenceDate: item.referenceDate,
        effectiveCost: effective,
      })
    );
  }
  return map;
}

export async function resolveSalesOrderItemCosts(
  items: SalesOrderMarginResolverItem[],
  productResolutions: Map<string, ProductResolution>,
  resolveProductCost: SalesOrderMarginProductCostResolver,
  cache: Map<string, SalesOrderMarginProductCostPayload> = new Map(),
  costPolicy: SalesOrderMarginCostPolicy = DEFAULT_SALES_ORDER_MARGIN_COST_POLICY
): Promise<Map<string, CostResolution>> {
  const allowLive = costPolicy.allowLiveCostFallback !== false;
  const uniqueProductIds = allowLive
    ? [
        ...new Set(
          items
            .map((item) => productResolutions.get(item.salesOrderItemId)?.productId)
            .filter((id): id is string => Boolean(id))
        ),
      ]
    : [];

  await Promise.all(
    uniqueProductIds.map(async (productId) => {
      if (cache.has(productId)) return;
      cache.set(productId, await resolveProductCost(productId));
    })
  );

  const map = new Map<string, CostResolution>();
  for (const item of items) {
    const product = productResolutions.get(item.salesOrderItemId);
    const productId = product?.productId ?? null;
    const payload = productId ? (cache.get(productId) ?? {}) : {};
    map.set(
      item.salesOrderItemId,
      resolveSalesOrderItemCost({
        salesOrderItemId: item.salesOrderItemId,
        productId,
        storedUnitCost: null,
        costLog: payload.costLog ?? null,
        analysis: payload.analysis,
        costPolicy,
      })
    );
  }
  return map;
}

export function assembleSalesOrderMarginItemInput(
  item: SalesOrderMarginResolverItem,
  product: ProductResolution,
  cost: CostResolution
): SalesOrderMarginItemInput {
  const revenue = extractSalesOrderItemRevenue(item);
  const productLinked = product.productId != null;
  return {
    salesOrderItemId: item.salesOrderItemId,
    productId: product.productId,
    externalProductId: productLinked ? (item.externalProductId ?? null) : null,
    productSku: productLinked ? product.productSku : null,
    productCode: productLinked ? product.productSku : null,
    productName: product.productName,
    quantity: safeFinite(item.quantity) ?? 0,
    netUnitPrice: revenue.netUnitPrice,
    netTotalValue: revenue.netTotalValue,
    itemStatus: item.itemStatus ?? null,
    isCanceled: item.isCanceled,
    unitCost: cost.unitCost,
    costSource: cost.costSource,
    costConfidence: cost.costConfidence,
    marginCostMode: cost.marginCostMode,
    productionCost: cost.productionCost ?? null,
  };
}

export function buildSalesOrderMarginInputsFromResolutions(
  items: SalesOrderMarginResolverItem[],
  productResolutions: Map<string, ProductResolution>,
  costResolutions: Map<string, CostResolution>
): SalesOrderMarginItemInput[] {
  return items.map((item) =>
    assembleSalesOrderMarginItemInput(
      item,
      productResolutions.get(item.salesOrderItemId) ?? {
        salesOrderItemId: item.salesOrderItemId,
        productId: null,
        productSku: item.skuSnapshot ?? null,
        productName: item.productNameSnapshot ?? null,
        resolutionSource: "NOT_FOUND",
        confidence: "MISSING",
        notes: [],
      },
      costResolutions.get(item.salesOrderItemId) ?? {
        salesOrderItemId: item.salesOrderItemId,
        productId: null,
        unitCost: null,
        costSource: "MISSING_COST",
        costConfidence: "MISSING",
        marginCostMode: "MISSING",
        notes: [],
      }
    )
  );
}

/** Atalho para validar análise isolada (testes / server). */
export function extractOfficialUnitCostFromAnalysis(analysis: unknown): number | null {
  return extractOfficialProductFinalUnitCost(analysis);
}
