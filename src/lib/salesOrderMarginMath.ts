/**
 * Motor matemático puro de margem de venda (realizada sobre receita líquida).
 *
 * Fórmulas (diagnóstico docs/sales-order-margin-diagnosis.md):
 *   netRevenue   = netTotalValue ?? quantity × netUnitPrice
 *   totalCost    = quantity × unitCost
 *   marginValue  = netRevenue − totalCost
 *   marginPercent = marginValue / netRevenue × 100
 *   markup       = netRevenue / totalCost
 *
 * Consolidado: margem % ponderada por receita (não média simples de %).
 */
import { roundPricingMoney, roundPricingPercent } from "./pricingCalculations.js";
import {
  hasSalesOrderMarginProductLink,
  isSalesOrderMarginConsolidationEligible,
  isSalesOrderMarginItemCanceled,
  resolveSalesOrderMarginStatusMeta,
} from "./salesOrderMarginStatus.js";
import type {
  SalesOrderCostConfidence,
  SalesOrderCostSource,
  SalesOrderMarginCostMode,
  SalesOrderMarginItemInput,
  SalesOrderMarginItemResult,
  SalesOrderMarginStatus,
  SalesOrderMarginSummary,
  SalesOrderMarginSummaryStatus,
} from "./salesOrderMarginTypes.js";
import { resolveSalesOrderMarginCostMode } from "./salesOrderMarginResolver.js";

function safeFinite(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundRatio(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function resolveNetRevenue(input: SalesOrderMarginItemInput): {
  netRevenue: number;
  netUnitRevenue: number | null;
  notes: string[];
} {
  const quantity = safeFinite(input.quantity) ?? 0;
  const netTotal = safeFinite(input.netTotalValue);
  const netUnit = safeFinite(input.netUnitPrice);

  if (netTotal != null) {
    const netUnitRevenue =
      quantity > 0 ? roundPricingMoney(netTotal / quantity) : netUnit;
    return {
      netRevenue: roundPricingMoney(netTotal),
      netUnitRevenue: netUnitRevenue ?? null,
      notes: ["Receita líquida obtida de netTotalValue."],
    };
  }

  if (netUnit != null && quantity > 0) {
    return {
      netRevenue: roundPricingMoney(quantity * netUnit),
      netUnitRevenue: roundPricingMoney(netUnit),
      notes: ["Receita líquida calculada como quantidade × netUnitPrice."],
    };
  }

  return {
    netRevenue: 0,
    netUnitRevenue: netUnit,
    notes: ["Receita líquida indisponível."],
  };
}

function buildItemResult(
  input: SalesOrderMarginItemInput,
  status: SalesOrderMarginStatus,
  partial: Omit<
    SalesOrderMarginItemResult,
    "status" | "statusLabel" | "statusSeverity"
  >
): SalesOrderMarginItemResult {
  const meta = resolveSalesOrderMarginStatusMeta(status);
  return {
    ...partial,
    status,
    statusLabel: meta.statusLabel,
    statusSeverity: meta.statusSeverity,
  };
}

function resolveCostFields(input: SalesOrderMarginItemInput): {
  unitCost: number | null;
  totalCost: number | null;
  costSource: SalesOrderCostSource;
  costConfidence: SalesOrderCostConfidence;
  marginCostMode: SalesOrderMarginCostMode;
} {
  const quantity = safeFinite(input.quantity) ?? 0;
  const unitCost = safeFinite(input.unitCost);
  const costSource: SalesOrderCostSource =
    unitCost == null ? "MISSING_COST" : (input.costSource ?? "MISSING_COST");
  const costConfidence: SalesOrderCostConfidence =
    unitCost == null ? "MISSING" : (input.costConfidence ?? "MISSING");
  const marginCostMode =
    input.marginCostMode ?? resolveSalesOrderMarginCostMode(costSource);

  return {
    unitCost,
    totalCost: unitCost != null ? roundPricingMoney(quantity * unitCost) : null,
    costSource,
    costConfidence,
    marginCostMode,
  };
}

function baseItemFields(input: SalesOrderMarginItemInput) {
  return {
    salesOrderItemId: input.salesOrderItemId,
    productId: input.productId ?? null,
    productSku: input.productSku ?? input.productCode ?? null,
    productName: input.productName ?? null,
    quantity: safeFinite(input.quantity) ?? 0,
  };
}

/**
 * Calcula margem realizada de um item de pedido de venda.
 */
export function calculateSalesOrderItemMargin(
  input: SalesOrderMarginItemInput
): SalesOrderMarginItemResult {
  const base = baseItemFields(input);
  const costFields = resolveCostFields(input);

  if (isSalesOrderMarginItemCanceled(input)) {
    const { netRevenue, netUnitRevenue, notes } = resolveNetRevenue(input);
    return buildItemResult(input, "ITEM_CANCELADO", {
      ...base,
      netUnitRevenue,
      netRevenue,
      unitCost: costFields.unitCost,
      totalCost: costFields.totalCost,
      marginValue: null,
      marginPercent: null,
      markup: null,
      costSource: costFields.costSource,
      costConfidence: costFields.costConfidence,
      marginCostMode: costFields.marginCostMode,
      notes: [...notes, "Item cancelado — excluído da margem consolidada."],
    });
  }

  if (!hasSalesOrderMarginProductLink(input)) {
    const { netRevenue, netUnitRevenue, notes } = resolveNetRevenue(input);
    return buildItemResult(input, "SEM_PRODUTO_VINCULADO", {
      ...base,
      netUnitRevenue,
      netRevenue,
      unitCost: costFields.unitCost,
      totalCost: costFields.totalCost,
      marginValue: null,
      marginPercent: null,
      markup: null,
      costSource: costFields.costSource,
      costConfidence: costFields.costConfidence,
      marginCostMode: costFields.marginCostMode,
      notes: [...notes, "Produto não identificado para resolução de custo."],
    });
  }

  const { netRevenue, netUnitRevenue, notes: revenueNotes } = resolveNetRevenue(input);

  if (netRevenue <= 0) {
    return buildItemResult(input, "RECEITA_INVALIDA", {
      ...base,
      netUnitRevenue,
      netRevenue,
      unitCost: costFields.unitCost,
      totalCost: costFields.totalCost,
      marginValue: null,
      marginPercent: null,
      markup: null,
      costSource: costFields.costSource,
      costConfidence: costFields.costConfidence,
      marginCostMode: costFields.marginCostMode,
      notes: [...revenueNotes, "Receita líquida deve ser maior que zero."],
    });
  }

  if (costFields.unitCost == null) {
    return buildItemResult(input, "SEM_CUSTO", {
      ...base,
      netUnitRevenue,
      netRevenue,
      unitCost: null,
      totalCost: null,
      marginValue: null,
      marginPercent: null,
      markup: null,
      costSource: "MISSING_COST",
      costConfidence: "MISSING",
      marginCostMode: "MISSING",
      notes: [...revenueNotes, "Custo unitário não informado ou indisponível."],
    });
  }

  if (costFields.unitCost <= 0) {
    return buildItemResult(input, "CUSTO_ZERO", {
      ...base,
      netUnitRevenue,
      netRevenue,
      unitCost: costFields.unitCost,
      totalCost: costFields.totalCost,
      marginValue: null,
      marginPercent: null,
      markup: null,
      costSource: costFields.costSource,
      costConfidence: costFields.costConfidence,
      marginCostMode: costFields.marginCostMode,
      notes: [...revenueNotes, "Custo unitário zerado ou negativo."],
    });
  }

  const totalCost = costFields.totalCost as number;
  const marginValue = roundPricingMoney(netRevenue - totalCost);
  const marginPercent = roundPricingPercent((marginValue / netRevenue) * 100);
  const markup = roundRatio(netRevenue / totalCost);

  if (marginValue < 0) {
    return buildItemResult(input, "MARGEM_NEGATIVA", {
      ...base,
      netUnitRevenue,
      netRevenue,
      unitCost: costFields.unitCost,
      totalCost,
      marginValue,
      marginPercent,
      markup,
      costSource: costFields.costSource,
      costConfidence: costFields.costConfidence,
      marginCostMode: costFields.marginCostMode,
      notes: [
        ...revenueNotes,
        "Margem negativa: receita líquida inferior ao custo total da linha.",
      ],
    });
  }

  return buildItemResult(input, "OK", {
    ...base,
    netUnitRevenue,
    netRevenue,
    unitCost: costFields.unitCost,
    totalCost,
    marginValue,
    marginPercent,
    markup,
    costSource: costFields.costSource,
    costConfidence: costFields.costConfidence,
    marginCostMode: costFields.marginCostMode,
    notes: revenueNotes,
  });
}

function resolveSummaryStatus(
  items: SalesOrderMarginItemResult[],
  flags: {
    hasMissingCost: boolean;
    hasMissingProduct: boolean;
    hasInvalidRevenue: boolean;
    validItemsCount: number;
  }
): SalesOrderMarginSummaryStatus {
  if (flags.validItemsCount === 0) {
    if (flags.hasMissingCost || flags.hasMissingProduct || flags.hasInvalidRevenue) {
      return "PARTIAL";
    }
    const onlyCanceled = items.every((item) => item.status === "ITEM_CANCELADO");
    if (onlyCanceled && items.length > 0) return "ITEM_CANCELADO";
    return "REVISAR_DADOS";
  }

  if (flags.hasMissingCost || flags.hasMissingProduct || flags.hasInvalidRevenue) {
    return "PARTIAL";
  }

  const hasNegative = items.some((item) => item.status === "MARGEM_NEGATIVA");
  if (hasNegative) return "MARGEM_NEGATIVA";

  return "OK";
}

/**
 * Agrega margem de pedido com percentual ponderado por receita (não média simples).
 */
export function calculateSalesOrderMarginSummary(
  items: SalesOrderMarginItemResult[]
): SalesOrderMarginSummary {
  const itemsCount = items.length;

  const eligible = items.filter((item) =>
    isSalesOrderMarginConsolidationEligible(item.status)
  );

  const validItemsCount = eligible.length;
  const ignoredItemsCount = itemsCount - validItemsCount;

  let netRevenue = 0;
  let totalCost = 0;
  let marginValue = 0;

  for (const item of eligible) {
    netRevenue += item.netRevenue;
    totalCost += item.totalCost ?? 0;
    marginValue += item.marginValue ?? 0;
  }

  netRevenue = roundPricingMoney(netRevenue);
  totalCost = roundPricingMoney(totalCost);
  marginValue = roundPricingMoney(marginValue);

  const marginPercent =
    netRevenue > 0 ? roundPricingPercent((marginValue / netRevenue) * 100) : null;
  const markup = totalCost > 0 ? roundRatio(netRevenue / totalCost) : null;

  const hasMissingCost = items.some((item) => item.status === "SEM_CUSTO");
  const hasMissingProduct = items.some((item) => item.status === "SEM_PRODUTO_VINCULADO");
  const hasNegativeMargin = items.some((item) => item.status === "MARGEM_NEGATIVA");
  const hasInvalidRevenue = items.some((item) => item.status === "RECEITA_INVALIDA");

  const status = resolveSummaryStatus(items, {
    hasMissingCost,
    hasMissingProduct,
    hasInvalidRevenue,
    validItemsCount,
  });

  return {
    itemsCount,
    validItemsCount,
    ignoredItemsCount,
    netRevenue,
    totalCost,
    marginValue,
    marginPercent,
    markup,
    hasMissingCost,
    hasMissingProduct,
    hasNegativeMargin,
    hasInvalidRevenue,
    status,
  };
}

/** Utilitário de teste/documentação: média simples (anti-padrão — não usar em produção). */
export function naiveAverageMarginPercent(items: SalesOrderMarginItemResult[]): number | null {
  const percents = items
    .map((item) => item.marginPercent)
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (percents.length === 0) return null;
  return roundPricingPercent(percents.reduce((a, b) => a + b, 0) / percents.length);
}
