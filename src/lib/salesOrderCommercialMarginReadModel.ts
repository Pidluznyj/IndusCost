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
