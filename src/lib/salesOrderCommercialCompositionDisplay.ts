/**
 * Exibição da composição comercial do Pedido (bruto / desconto / líquido).
 * Não altera a fórmula de margem — apenas formata e agrega para UI/tooltips.
 */
import {
  resolveSalesOrderItemCommercialValues,
  type SalesOrderItemCommercialDiscountStatus,
  type SalesOrderItemCommercialValues,
} from "./salesOrderItemCommercialValues.js";
import {
  SALES_ORDER_COMMERCIAL_MARGIN_REASON_LABEL,
  type SalesOrderCommercialMarginItemPayload,
  type SalesOrderCommercialMarginReasonCode,
  type SalesOrderCommercialMarginSummaryPayload,
} from "./salesOrderCommercialMargin.js";
import { roundPricingMoney, roundPricingPercent } from "./pricingCalculations.js";

const moneyFmt = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const percentFmt = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatMoney(value: unknown): string {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return moneyFmt.format(n);
}

function formatPercent(value: unknown): string {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${percentFmt.format(n)}%`;
}

export const SALES_ORDER_COMMERCIAL_COMPOSITION_LABELS = {
  grossItems: "Valor bruto dos itens",
  discountValue: "Desconto concedido",
  discountPercent: "Desconto concedido",
  additionValue: "Acréscimo comercial",
  additionPercent: "Acréscimo comercial",
  netSold: "Valor líquido vendido",
  commercialMarginValue: "Margem comercial",
  commercialMarginPercent: "Margem comercial",
  grossUnitPrice: "Preço unitário bruto",
  activeQuantity: "Quantidade ativa",
  grossActiveValue: "Valor bruto",
  discountColumn: "Desconto",
  netUnitPrice: "Preço unitário líquido",
  netActiveValue: "Valor líquido",
  totalValueColumn: "Valor total",
  unavailable: "Margem não calculada",
  partial: "Margem comercial parcial",
} as const;

export type SalesOrderCommercialCompositionTotals = {
  grossActiveTotalValue: number;
  discountTotalValue: number;
  discountRate: number;
  additionTotalValue: number;
  additionRate: number;
  netActiveTotalValue: number;
  discountStatus: SalesOrderItemCommercialDiscountStatus;
  itemsWithDiscount: number;
  itemsWithAddition: number;
  itemsActive: number;
};

export type SalesOrderItemCommercialCompositionInput = {
  orderedQuantity: number;
  canceledQuantity?: number | null;
  isFullyCanceled?: boolean;
  /** Unitário bruto (negotiatedPrice / valorUnitario). */
  grossUnitPrice: number;
  netTotalValue: number | null | undefined;
};

export function resolveItemCommercialCompositionForDisplay(
  input: SalesOrderItemCommercialCompositionInput
): SalesOrderItemCommercialValues {
  return resolveSalesOrderItemCommercialValues({
    orderedQuantity: input.orderedQuantity,
    canceledQuantity: input.canceledQuantity,
    isFullyCanceled: input.isFullyCanceled,
    grossUnitPrice: input.grossUnitPrice,
    netTotalValue: input.netTotalValue,
  });
}

export function summarizeCommercialCompositionForDisplay(
  items: ReadonlyArray<SalesOrderItemCommercialValues>
): SalesOrderCommercialCompositionTotals {
  let grossActiveTotalValue = 0;
  let discountTotalValue = 0;
  let additionTotalValue = 0;
  let netActiveTotalValue = 0;
  let itemsWithDiscount = 0;
  let itemsWithAddition = 0;
  let itemsActive = 0;

  for (const item of items) {
    if (item.activeQuantity <= 0) continue;
    itemsActive += 1;
    grossActiveTotalValue += item.grossActiveValue;
    discountTotalValue += item.effectiveDiscountValue;
    additionTotalValue += item.commercialAdditionValue;
    if (item.netActiveValue != null) netActiveTotalValue += item.netActiveValue;
    if (item.discountStatus === "DISCOUNT") itemsWithDiscount += 1;
    if (item.discountStatus === "ADDITION") itemsWithAddition += 1;
  }

  grossActiveTotalValue = roundPricingMoney(grossActiveTotalValue);
  discountTotalValue = roundPricingMoney(discountTotalValue);
  additionTotalValue = roundPricingMoney(additionTotalValue);
  netActiveTotalValue = roundPricingMoney(netActiveTotalValue);

  const discountRate =
    grossActiveTotalValue > 0
      ? roundPricingMoney(discountTotalValue / grossActiveTotalValue)
      : 0;
  const additionRate =
    grossActiveTotalValue > 0
      ? roundPricingMoney(additionTotalValue / grossActiveTotalValue)
      : 0;

  let discountStatus: SalesOrderItemCommercialDiscountStatus = "NO_DISCOUNT";
  if (additionTotalValue > discountTotalValue && additionTotalValue > 0) {
    discountStatus = "ADDITION";
  } else if (discountTotalValue > 0) {
    discountStatus = "DISCOUNT";
  } else if (itemsActive === 0) {
    discountStatus = "NO_ACTIVE_VALUE";
  }

  return {
    grossActiveTotalValue,
    discountTotalValue,
    discountRate,
    additionTotalValue,
    additionRate,
    netActiveTotalValue,
    discountStatus,
    itemsWithDiscount,
    itemsWithAddition,
    itemsActive,
  };
}

/** Traduz reasonCode comercial para label de UI. */
export function formatCommercialMarginUnavailableReason(
  reasonCode?: SalesOrderCommercialMarginReasonCode | string | null
): string {
  if (reasonCode && reasonCode in SALES_ORDER_COMMERCIAL_MARGIN_REASON_LABEL) {
    return SALES_ORDER_COMMERCIAL_MARGIN_REASON_LABEL[
      reasonCode as SalesOrderCommercialMarginReasonCode
    ];
  }
  switch (reasonCode) {
    case "NET_SOLD_VALUE_NOT_FOUND":
      return "Valor líquido não encontrado.";
    case "PRODUCT_WITHOUT_PRICE_FORMATION":
      return "Produto sem formação de preço.";
    case "COST_NOT_FOUND":
      return "Custo histórico não encontrado.";
    case "INCOMPLETE_MARGIN_TIERS":
      return "Faixas incompletas.";
    case "HISTORICAL_FORMATION_AMBIGUOUS":
      return "Formação ambígua.";
    case "COMMISSION_NOT_DEFINED":
      return "Comissão não definida.";
    default:
      return reasonCode
        ? String(reasonCode)
        : "A formação de preço está incompleta ou ausente.";
  }
}

export function formatCommercialDiscountCompact(input: {
  discountRate: number;
  discountValue: number;
  additionRate?: number;
  additionValue?: number;
  discountStatus?: SalesOrderItemCommercialDiscountStatus | null;
}): string {
  if (input.discountStatus === "ADDITION" || (input.additionValue ?? 0) > 0) {
    return `+${formatPercent((input.additionRate ?? 0) * 100)}`;
  }
  if ((input.discountValue ?? 0) <= 0 && (input.discountRate ?? 0) <= 0) {
    return "—";
  }
  return formatPercent(input.discountRate * 100);
}

export function formatCommercialDiscountDetail(input: {
  discountRate: number;
  discountValue: number;
}): string {
  if (input.discountValue <= 0) return "—";
  return `${formatPercent(input.discountRate * 100)} (${formatMoney(input.discountValue)})`;
}

export function formatListCommercialMarginPercentLabel(
  commercial?: SalesOrderCommercialMarginSummaryPayload | null
): string {
  if (!commercial) return "—";
  if (commercial.commercialMarginTotalPercent != null) {
    return formatPercent(commercial.commercialMarginTotalPercent);
  }
  if (commercial.itemsActive > 0 && commercial.itemsCalculated === 0) {
    return SALES_ORDER_COMMERCIAL_COMPOSITION_LABELS.unavailable;
  }
  if (!commercial.isComplete && commercial.itemsCalculated > 0) {
    return "Parcial";
  }
  return SALES_ORDER_COMMERCIAL_COMPOSITION_LABELS.unavailable;
}

export function formatListCommercialMarginValueLabel(
  commercial?: SalesOrderCommercialMarginSummaryPayload | null
): string {
  if (commercial?.commercialMarginTotalValue != null) {
    return formatMoney(commercial.commercialMarginTotalValue);
  }
  return "—";
}

export function formatPartialCommercialMarginHint(
  commercial?: SalesOrderCommercialMarginSummaryPayload | null
): string | null {
  if (!commercial || commercial.isComplete || commercial.itemsActive <= 0) {
    return null;
  }
  if (commercial.itemsCalculated <= 0) return null;
  const coverage =
    commercial.commercialMarginCoveragePercent != null
      ? formatPercent(commercial.commercialMarginCoveragePercent)
      : "—";
  return [
    SALES_ORDER_COMMERCIAL_COMPOSITION_LABELS.partial,
    `${commercial.itemsCalculated} de ${commercial.itemsActive} itens calculados`,
    `Cobertura de ${coverage} do valor líquido`,
  ].join("\n");
}

/** Linhas de composição bruto/desconto/líquido para tooltip do pedido. */
export function buildOrderCommercialCompositionTooltipLines(
  composition?: SalesOrderCommercialCompositionTotals | null
): string[] {
  if (!composition) return [];
  const lines = [
    `${SALES_ORDER_COMMERCIAL_COMPOSITION_LABELS.grossItems}: ${formatMoney(composition.grossActiveTotalValue)}`,
  ];
  if (composition.discountStatus === "ADDITION") {
    lines.push(
      `${SALES_ORDER_COMMERCIAL_COMPOSITION_LABELS.additionValue}: ${formatMoney(composition.additionTotalValue)}`
    );
    lines.push(
      `${SALES_ORDER_COMMERCIAL_COMPOSITION_LABELS.additionPercent}: ${formatPercent(composition.additionRate * 100)}`
    );
  } else {
    lines.push(
      `${SALES_ORDER_COMMERCIAL_COMPOSITION_LABELS.discountValue}: ${formatMoney(composition.discountTotalValue)}`
    );
    lines.push(
      `${SALES_ORDER_COMMERCIAL_COMPOSITION_LABELS.discountPercent}: ${formatPercent(composition.discountRate * 100)}`
    );
  }
  lines.push(
    `${SALES_ORDER_COMMERCIAL_COMPOSITION_LABELS.netSold}: ${formatMoney(composition.netActiveTotalValue)}`
  );
  return lines;
}

/**
 * Tooltip completo do item: composição comercial + formação.
 * Aceita composition opcional (quando o payload de margem ainda não embute bruto/desconto).
 */
export function buildSalesOrderItemCommercialMarginCompositionTooltipText(input: {
  commercial?: SalesOrderCommercialMarginItemPayload | null;
  composition?: SalesOrderItemCommercialValues | null;
}): string {
  const { commercial, composition } = input;

  if (!commercial || !commercial.isComplete) {
    const reasonText = formatCommercialMarginUnavailableReason(
      commercial?.reasonCode ?? composition?.reasonCode
    );
    return [
      SALES_ORDER_COMMERCIAL_COMPOSITION_LABELS.unavailable,
      "",
      reasonText,
      ...(commercial?.warnings ?? [])
        .filter((w) => w !== reasonText)
        .map((w) => `Aviso: ${w}`),
      ...(composition?.warnings ?? []).map((w) => `Aviso: ${w}`),
    ].join("\n");
  }

  const grossUnit =
    composition?.grossUnitPrice ?? commercial.negotiatedUnitPrice;
  const activeQty = composition?.activeQuantity ?? commercial.soldQuantity;
  const grossActive =
    composition?.grossActiveValue ??
    roundPricingMoney(activeQty * grossUnit);
  const discountRate = composition?.effectiveDiscountRate ?? 0;
  const discountValue = composition?.effectiveDiscountValue ?? 0;
  const additionRate = composition?.commercialAdditionRate ?? 0;
  const additionValue = composition?.commercialAdditionValue ?? 0;
  const netUnit =
    composition?.effectiveNetUnitPrice ?? commercial.negotiatedUnitPrice;
  const netActive = composition?.netActiveValue ?? commercial.soldValue;

  const lines = [
    "Margem comercial",
    "",
    `1. Preço unitário bruto: ${formatMoney(grossUnit)}`,
    `2. Quantidade ativa: ${activeQty}`,
    `3. Valor bruto: ${formatMoney(grossActive)}`,
  ];

  if (additionValue > 0) {
    lines.push(`4. Acréscimo comercial: ${formatPercent(additionRate * 100)}`);
    lines.push(`5. Acréscimo em reais: ${formatMoney(additionValue)}`);
  } else {
    lines.push(`4. Desconto em percentual: ${formatPercent(discountRate * 100)}`);
    lines.push(`5. Desconto em reais: ${formatMoney(discountValue)}`);
  }

  lines.push(
    `6. Preço unitário líquido: ${formatMoney(netUnit)}`,
    `7. Valor líquido vendido: ${formatMoney(netActive)}`,
    `8. Custo histórico: ${formatMoney(commercial.costValue)}`,
    `9. Impostos: ${formatPercent((commercial.taxRate ?? 0) * 100)} (${formatMoney(commercial.taxValue)})`,
    `10. Frete: ${formatPercent((commercial.freightRate ?? 0) * 100)} + ${formatMoney(commercial.freightAbsoluteValue)}`,
    `11. Comissão proporcional: ${formatPercent((commercial.commissionRate ?? 0) * 100)} (${formatMoney(commercial.commissionValue)})`,
    `12. Outras variáveis: ${formatPercent((commercial.otherVariablesRate ?? 0) * 100)} (${formatMoney(commercial.otherVariablesValue)})`,
    `13. Margem comercial em reais: ${formatMoney(commercial.commercialMarginValue)}`,
    `14. Margem comercial percentual: ${formatPercent(commercial.commercialMarginPercent)}`,
    `15. Faixas utilizadas: ${commercial.lowerMarginBand ?? "—"} → ${commercial.upperMarginBand ?? "—"}`,
    `16. Formação histórica: ${commercial.historicalContextId ?? commercial.priceTableVersionId ?? "—"} (${commercial.referenceDate ?? "—"})`,
  );

  if (commercial.warnings.length) {
    lines.push("17. Warnings:");
    for (const w of commercial.warnings) lines.push(`   • ${w}`);
  }

  return lines.join("\n");
}

/** Fixture PD 02820 para testes de exibição. */
export const PD02820_COMMERCIAL_DISPLAY_FIXTURE = {
  items: [
    {
      orderedQuantity: 400,
      canceledQuantity: 0,
      grossUnitPrice: 4.32,
      netTotalValue: 1641.6,
    },
    {
      orderedQuantity: 100,
      canceledQuantity: 0,
      grossUnitPrice: 5.97,
      netTotalValue: 567.15,
    },
    {
      orderedQuantity: 100,
      canceledQuantity: 0,
      grossUnitPrice: 5.97,
      netTotalValue: 567.15,
    },
  ],
  expected: {
    grossActiveTotalValue: 2922,
    discountTotalValue: 146.1,
    discountRatePercent: 5,
    netActiveTotalValue: 2775.9,
  },
} as const;

export function resolvePd02820CommercialCompositionTotals(): SalesOrderCommercialCompositionTotals {
  const rows = PD02820_COMMERCIAL_DISPLAY_FIXTURE.items.map((item) =>
    resolveItemCommercialCompositionForDisplay(item)
  );
  return summarizeCommercialCompositionForDisplay(rows);
}

export function formatDiscountRatePercentPtBr(rateFraction: number): string {
  return `${roundPricingPercent(rateFraction * 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}
