/**
 * Read model canônico da Margem comercial do Pedido.
 *
 * Não recalcula a fórmula do motor — apenas monta DTOs de leitura a partir de:
 * - salesOrderCommercialMargin (motor oficial)
 * - salesOrderItemCommercialValues (bruto / desconto / líquido)
 *
 * Sem Prisma. Sem Proposta. Sem margem gerencial.
 */
import { roundPricingMoney, roundPricingPercent } from "./pricingCalculations.js";
import { toCivilDateKey } from "./financeCivilDate.js";
import {
  summarizeSalesOrderCommercialMargins,
  type SalesOrderCommercialMarginItemPayload,
  type SalesOrderCommercialMarginReasonCode,
  type SalesOrderCommercialMarginSummaryPayload,
} from "./salesOrderCommercialMargin.js";
import type {
  SalesOrderItemCommercialDiscountStatus,
  SalesOrderItemCommercialValues,
  SalesOrderItemCommercialValuesReasonCode,
} from "./salesOrderItemCommercialValues.js";

/** Composição comercial (bruto / desconto / líquido) anexada ao item. */
export type SalesOrderCommercialCompositionDTO = {
  activeQuantity: number;
  orderedQuantity: number;
  canceledQuantity: number;
  grossUnitPrice: number;
  grossActiveValue: number;
  netActiveValue: number | null;
  effectiveNetUnitPrice: number | null;
  effectiveDiscountValue: number;
  effectiveDiscountRate: number;
  commercialAdditionValue: number;
  commercialAdditionRate: number;
  discountStatus: SalesOrderItemCommercialDiscountStatus;
  compositionReasonCode: SalesOrderItemCommercialValuesReasonCode;
  compositionWarnings: string[];
  compositionComplete: boolean;
};

export type SalesOrderCommercialMarginItemDTO = SalesOrderCommercialMarginItemPayload & {
  itemId: string;
  orderId: string;
  composition: SalesOrderCommercialCompositionDTO;
};

export type SalesOrderCommercialCompositionTotalsDTO = {
  grossActiveTotalValue: number;
  discountTotalValue: number;
  discountTotalRate: number | null;
  netActiveTotalValue: number;
  additionTotalValue: number;
};

export type SalesOrderCommercialMarginSummaryDTO = {
  orderId: string;
  /** Payload oficial do motor (compatível com contratos existentes). */
  commercialMargin: SalesOrderCommercialMarginSummaryPayload;
  composition: SalesOrderCommercialCompositionTotalsDTO;
  items: SalesOrderCommercialMarginItemDTO[];
  /** Atalhos de cobertura / status (espelham commercialMargin). */
  commercialMarginTotalValue: number | null;
  commercialMarginTotalPercent: number | null;
  commercialSoldTotalValue: number;
  totalActiveSoldValue: number;
  commercialMarginCoveragePercent: number | null;
  itemsCalculated: number;
  itemsUnavailable: number;
  itemsActive: number;
  isComplete: boolean;
  warnings: string[];
  unavailableReasonCodes: SalesOrderCommercialMarginReasonCode[];
};

export type SalesOrderCommercialMarginAggregateFiltersDTO = {
  orderIds?: string[];
  issueDateFrom?: string | null;
  issueDateTo?: string | null;
  customerId?: string | null;
  /** Limite de segurança para filtros amplos (padrão do service). */
  take?: number | null;
};

export type SalesOrderCommercialMarginAggregateDTO = {
  filters: SalesOrderCommercialMarginAggregateFiltersDTO;
  /** Agregado ponderado oficial (Σ R$ / Σ vendido coberto). */
  commercialMargin: SalesOrderCommercialMarginSummaryPayload;
  composition: SalesOrderCommercialCompositionTotalsDTO;
  orders: SalesOrderCommercialMarginSummaryDTO[];
  orderCount: number;
  commercialMarginTotalValue: number | null;
  commercialMarginTotalPercent: number | null;
  commercialSoldTotalValue: number;
  totalActiveSoldValue: number;
  commercialMarginCoveragePercent: number | null;
  itemsCalculated: number;
  itemsUnavailable: number;
  itemsActive: number;
  isComplete: boolean;
  warnings: string[];
};

export function toCompositionDTO(
  values: SalesOrderItemCommercialValues
): SalesOrderCommercialCompositionDTO {
  return {
    activeQuantity: values.activeQuantity,
    orderedQuantity: values.orderedQuantity,
    canceledQuantity: values.canceledQuantity,
    grossUnitPrice: values.grossUnitPrice,
    grossActiveValue: values.grossActiveValue,
    netActiveValue: values.netActiveValue,
    effectiveNetUnitPrice: values.effectiveNetUnitPrice,
    effectiveDiscountValue: values.effectiveDiscountValue,
    effectiveDiscountRate: values.effectiveDiscountRate,
    commercialAdditionValue: values.commercialAdditionValue,
    commercialAdditionRate: values.commercialAdditionRate,
    discountStatus: values.discountStatus,
    compositionReasonCode: values.reasonCode,
    compositionWarnings: [...values.warnings],
    compositionComplete: values.isComplete,
  };
}

export function summarizeCompositionTotals(
  items: ReadonlyArray<Pick<SalesOrderCommercialMarginItemDTO, "composition">>
): SalesOrderCommercialCompositionTotalsDTO {
  let grossActiveTotalValue = 0;
  let discountTotalValue = 0;
  let netActiveTotalValue = 0;
  let additionTotalValue = 0;

  for (const item of items) {
    const c = item.composition;
    if (c.activeQuantity <= 0) continue;
    grossActiveTotalValue += c.grossActiveValue;
    discountTotalValue += c.effectiveDiscountValue;
    additionTotalValue += c.commercialAdditionValue;
    if (c.netActiveValue != null) netActiveTotalValue += c.netActiveValue;
  }

  grossActiveTotalValue = roundPricingMoney(grossActiveTotalValue);
  discountTotalValue = roundPricingMoney(discountTotalValue);
  netActiveTotalValue = roundPricingMoney(netActiveTotalValue);
  additionTotalValue = roundPricingMoney(additionTotalValue);

  return {
    grossActiveTotalValue,
    discountTotalValue,
    discountTotalRate:
      grossActiveTotalValue > 0
        ? roundPricingPercent((discountTotalValue / grossActiveTotalValue) * 100) / 100
        : null,
    netActiveTotalValue,
    additionTotalValue,
  };
}

export function buildCommercialMarginItemDTO(input: {
  orderId: string;
  itemId: string;
  margin: SalesOrderCommercialMarginItemPayload;
  composition: SalesOrderItemCommercialValues;
}): SalesOrderCommercialMarginItemDTO {
  return {
    itemId: input.itemId,
    orderId: input.orderId,
    ...input.margin,
    composition: toCompositionDTO(input.composition),
  };
}

export function buildCommercialMarginSummaryDTO(input: {
  orderId: string;
  commercialMargin: SalesOrderCommercialMarginSummaryPayload;
  items: SalesOrderCommercialMarginItemDTO[];
}): SalesOrderCommercialMarginSummaryDTO {
  const unavailableReasonCodes = [
    ...new Set(
      input.items
        .filter((item) => !item.isComplete && item.reasonCode != null)
        .map((item) => item.reasonCode as SalesOrderCommercialMarginReasonCode)
    ),
  ];

  return {
    orderId: input.orderId,
    commercialMargin: input.commercialMargin,
    composition: summarizeCompositionTotals(input.items),
    items: input.items,
    commercialMarginTotalValue: input.commercialMargin.commercialMarginTotalValue,
    commercialMarginTotalPercent: input.commercialMargin.commercialMarginTotalPercent,
    commercialSoldTotalValue: input.commercialMargin.commercialSoldTotalValue,
    totalActiveSoldValue: input.commercialMargin.totalActiveSoldValue,
    commercialMarginCoveragePercent: input.commercialMargin.commercialMarginCoveragePercent,
    itemsCalculated: input.commercialMargin.itemsCalculated,
    itemsUnavailable: input.commercialMargin.itemsUnavailable,
    itemsActive: input.commercialMargin.itemsActive,
    isComplete: input.commercialMargin.isComplete,
    warnings: [...input.commercialMargin.warnings],
    unavailableReasonCodes,
  };
}

/**
 * Agrega vários Pedidos com a mesma regra do motor:
 * Σ margem comercial R$ / Σ valor vendido coberto.
 * Não usa média simples. Não usa margem gerencial.
 */
export function aggregateCommercialMarginSummaries(
  orderSummaries: ReadonlyArray<SalesOrderCommercialMarginSummaryDTO>,
  filters: SalesOrderCommercialMarginAggregateFiltersDTO = {}
): SalesOrderCommercialMarginAggregateDTO {
  const calculatedItems: SalesOrderCommercialMarginItemPayload[] = [];
  let totalActiveSoldValue = 0;

  for (const order of orderSummaries) {
    totalActiveSoldValue += order.totalActiveSoldValue;
    for (const item of order.items) {
      if (item.soldQuantity <= 0 || item.soldValue <= 0) continue;
      calculatedItems.push(item);
    }
  }

  const commercialMargin = summarizeSalesOrderCommercialMargins(calculatedItems, {
    totalActiveSoldValue,
  });

  const composition = summarizeCompositionTotals(
    orderSummaries.flatMap((order) => order.items)
  );

  return {
    filters,
    commercialMargin,
    composition,
    orders: [...orderSummaries],
    orderCount: orderSummaries.length,
    commercialMarginTotalValue: commercialMargin.commercialMarginTotalValue,
    commercialMarginTotalPercent: commercialMargin.commercialMarginTotalPercent,
    commercialSoldTotalValue: commercialMargin.commercialSoldTotalValue,
    totalActiveSoldValue: commercialMargin.totalActiveSoldValue,
    commercialMarginCoveragePercent: commercialMargin.commercialMarginCoveragePercent,
    itemsCalculated: commercialMargin.itemsCalculated,
    itemsUnavailable: commercialMargin.itemsUnavailable,
    itemsActive: commercialMargin.itemsActive,
    isComplete: commercialMargin.isComplete,
    warnings: [...commercialMargin.warnings],
  };
}

/** Extrai o núcleo comparável (R$ / % / cobertura) para testes de consistência. */
export function commercialMarginIdentityKey(
  summary: Pick<
    SalesOrderCommercialMarginSummaryPayload,
    | "commercialMarginTotalValue"
    | "commercialMarginTotalPercent"
    | "commercialMarginCoveragePercent"
    | "isComplete"
    | "itemsCalculated"
    | "itemsUnavailable"
  >
) {
  return {
    commercialMarginTotalValue: summary.commercialMarginTotalValue,
    commercialMarginTotalPercent: summary.commercialMarginTotalPercent,
    commercialMarginCoveragePercent: summary.commercialMarginCoveragePercent,
    isComplete: summary.isComplete,
    itemsCalculated: summary.itemsCalculated,
    itemsUnavailable: summary.itemsUnavailable,
  };
}

/** Remove metadados do DTO — payload compatível com contratos existentes. */
export function toCommercialMarginItemPayload(
  dto: SalesOrderCommercialMarginItemDTO
): SalesOrderCommercialMarginItemPayload {
  const { itemId: _itemId, orderId: _orderId, composition: _composition, ...payload } = dto;
  return payload;
}

/**
 * Consolida payloads comerciais já calculados no servidor (Σ R$ / Σ vendido coberto).
 * Não recalcula margem a partir de custo/preço — só agrega resultados oficiais.
 */
export function aggregateCommercialMarginPayloads(
  payloads: ReadonlyArray<SalesOrderCommercialMarginSummaryPayload>
): SalesOrderCommercialMarginSummaryPayload {
  let commercialMarginTotalValue = 0;
  let commercialSoldTotalValue = 0;
  let totalActiveSoldValue = 0;
  let itemsCalculated = 0;
  let itemsUnavailable = 0;
  let itemsActive = 0;
  const warnings: string[] = [];
  let hasAnyCalculated = false;

  for (const row of payloads) {
    totalActiveSoldValue += row.totalActiveSoldValue ?? 0;
    itemsCalculated += row.itemsCalculated ?? 0;
    itemsUnavailable += row.itemsUnavailable ?? 0;
    itemsActive += row.itemsActive ?? 0;
    if (
      row.commercialMarginTotalValue != null &&
      Number.isFinite(row.commercialMarginTotalValue) &&
      row.itemsCalculated > 0
    ) {
      hasAnyCalculated = true;
      commercialMarginTotalValue += row.commercialMarginTotalValue;
      commercialSoldTotalValue += row.commercialSoldTotalValue ?? 0;
    }
    for (const w of row.warnings ?? []) {
      if (!warnings.includes(w)) warnings.push(w);
    }
  }

  commercialMarginTotalValue = roundPricingMoney(commercialMarginTotalValue);
  commercialSoldTotalValue = roundPricingMoney(commercialSoldTotalValue);
  totalActiveSoldValue = roundPricingMoney(totalActiveSoldValue);

  const commercialMarginTotalPercent =
    commercialSoldTotalValue > 0
      ? roundPricingPercent((commercialMarginTotalValue / commercialSoldTotalValue) * 100)
      : null;
  const commercialMarginCoveragePercent =
    totalActiveSoldValue > 0
      ? roundPricingPercent((commercialSoldTotalValue / totalActiveSoldValue) * 100)
      : null;
  const isComplete =
    itemsActive > 0 && itemsUnavailable === 0 && commercialMarginTotalPercent != null;

  if (!isComplete && itemsUnavailable > 0) {
    warnings.unshift(
      `Margem comercial parcial: ${itemsCalculated} de ${itemsActive} itens calculados.`
    );
  }

  return {
    commercialMarginTotalValue: hasAnyCalculated ? commercialMarginTotalValue : null,
    commercialMarginTotalPercent,
    commercialSoldTotalValue,
    totalActiveSoldValue,
    commercialMarginCoveragePercent,
    itemsCalculated,
    itemsUnavailable,
    itemsActive,
    isComplete,
    warnings,
  };
}

const MONTH_LABELS_PT = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
] as const;

export type CommercialMarginMonthlyOrderInput = {
  issueDate: Date | string | null | undefined;
  commercialMargin: SalesOrderCommercialMarginSummaryPayload | null | undefined;
};

export type CommercialMarginMonthlyRow = {
  month: number;
  monthLabel: string;
  salesAmount: number;
  taxAmount: number;
  netSalesAmount: number;
  costAmount: number;
  marginAmount: number;
  marginPercent: number | null;
  ordersCount: number;
  /** Σ líquido coberto (denominador da %). */
  coveredNetValue: number;
  /** Σ líquido ativo dos pedidos do mês (inclui sem cobertura). */
  totalNetValue: number;
  isPartial: boolean;
  coveredOrders: number;
  totalEligibleOrders: number;
};

/**
 * Margem comercial % mês a mês — mesma ponderação do card
 * (Σ R$ margem / Σ líquido coberto), agrupada por issueDate.
 * Meses sem denominador válido → `marginPercent: null` (nunca 0 artificial).
 */
export function buildMonthlyCommercialMarginRows(
  orders: ReadonlyArray<CommercialMarginMonthlyOrderInput>,
  year: number
): CommercialMarginMonthlyRow[] {
  const buckets = new Map<
    number,
    {
      marginSum: number;
      coveredSoldSum: number;
      totalActiveSoldSum: number;
      ordersCount: number;
      coveredOrders: number;
      hasCalculated: boolean;
      hasPartial: boolean;
    }
  >();
  for (let m = 1; m <= 12; m += 1) {
    buckets.set(m, {
      marginSum: 0,
      coveredSoldSum: 0,
      totalActiveSoldSum: 0,
      ordersCount: 0,
      coveredOrders: 0,
      hasCalculated: false,
      hasPartial: false,
    });
  }

  for (const order of orders) {
    const civil = toCivilDateKey(order.issueDate);
    if (!civil || !civil.startsWith(`${year}-`)) continue;
    const month = Number(civil.slice(5, 7));
    const bucket = buckets.get(month);
    if (!bucket) continue;
    bucket.ordersCount += 1;

    const cm = order.commercialMargin;
    const activeSold =
      cm && Number.isFinite(cm.totalActiveSoldValue) ? cm.totalActiveSoldValue : 0;
    bucket.totalActiveSoldSum += activeSold;

    if (
      !cm ||
      cm.itemsCalculated <= 0 ||
      cm.commercialMarginTotalValue == null ||
      !Number.isFinite(cm.commercialMarginTotalValue)
    ) {
      continue;
    }
    bucket.hasCalculated = true;
    bucket.coveredOrders += 1;
    if (!cm.isComplete) bucket.hasPartial = true;
    bucket.marginSum += cm.commercialMarginTotalValue;
    bucket.coveredSoldSum += cm.commercialSoldTotalValue ?? 0;
  }

  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const bucket = buckets.get(month)!;
    const marginAmount = roundPricingMoney(bucket.marginSum);
    const coveredNetValue = roundPricingMoney(bucket.coveredSoldSum);
    const totalNetValue = roundPricingMoney(bucket.totalActiveSoldSum);
    const marginPercent =
      bucket.hasCalculated && coveredNetValue > 0
        ? roundPricingPercent((marginAmount / coveredNetValue) * 100)
        : null;
    const isPartial =
      bucket.hasCalculated &&
      (bucket.hasPartial || bucket.coveredOrders < bucket.ordersCount);
    return {
      month,
      monthLabel: MONTH_LABELS_PT[index]!,
      salesAmount: coveredNetValue,
      taxAmount: 0,
      netSalesAmount: coveredNetValue,
      costAmount: 0,
      marginAmount: bucket.hasCalculated ? marginAmount : 0,
      marginPercent,
      ordersCount: bucket.ordersCount,
      coveredNetValue,
      totalNetValue,
      isPartial,
      coveredOrders: bucket.coveredOrders,
      totalEligibleOrders: bucket.ordersCount,
    };
  });
}

/** Status de exibição canônico da margem comercial. */
export function resolveCommercialMarginDisplayStatus(
  commercial: SalesOrderCommercialMarginSummaryPayload | null | undefined
): "COMPLETE" | "PARTIAL" | "UNAVAILABLE" {
  if (!commercial || commercial.itemsActive <= 0 || commercial.itemsCalculated <= 0) {
    return "UNAVAILABLE";
  }
  if (commercial.isComplete) return "COMPLETE";
  return "PARTIAL";
}

export function resolveCommercialMarginDisplayLabel(
  commercial: SalesOrderCommercialMarginSummaryPayload | null | undefined
): string {
  switch (resolveCommercialMarginDisplayStatus(commercial)) {
    case "PARTIAL":
      return "Margem comercial parcial";
    case "UNAVAILABLE":
      return "Margem não calculada";
    default:
      return "Margem comercial";
  }
}
