/**
 * Comparação ganho negociado × ganho realizado (OP-24) — motor puro.
 * Não altera o mérito histórico da negociação: negociado e realizado ficam separados.
 * Base comparável alinhada ao negotiationSavingsEngine (itens + frete + impostos + despesas − descontos).
 */

export type SavingsComparisonAlertCode =
  | "RECEIVED_PRICE_ABOVE_ORDER"
  | "ADDITIONAL_COST"
  | "MISSING_EVIDENCE"
  | "OUTSIDE_NEGOTIATED_CONDITION"
  | "QUANTITY_VARIATION";

export type SavingsComparisonAlert = {
  code: SavingsComparisonAlertCode;
  severity: "warning" | "critical" | "info";
  message: string;
  purchaseOrderItemId?: string | null;
  amount?: number | null;
};

export type SavingsComparisonLineInput = {
  purchaseOrderItemId: string;
  description: string;
  quantityOrdered: number;
  /** Preço inicial congelado (1ª oferta). */
  initialUnitPrice: number | null;
  /** Preço negociado / pedido (unitPriceSnapshot). */
  orderUnitPrice: number;
  /** Frete/imposto/despesa/desconto congelados no item do pedido (proporcionais à qty pedida). */
  orderFreight: number;
  orderTaxes: number;
  orderExpenses: number;
  orderDiscounts: number;
  /** Quantidade aceita em recebimentos confirmados (APROVADO). */
  quantityAcceptedConfirmed: number;
  /** Custo unitário efetivo médio ponderado dos recebimentos confirmados. */
  receivedUnitCost: number | null;
  /** Extras reais alocados à linha (proporção do header do recebimento × qty aceita). */
  receivedFreight: number;
  receivedTaxes: number;
  receivedExpenses: number;
  receivedDiscounts: number;
};

export type SavingsComparisonHeaderInput = {
  currency: string;
  /** Snapshots históricos do PC — mérito negociado (não recalcular por overwrite). */
  initialComparableTotalSnapshot: number | null;
  negotiatedComparableTotalSnapshot: number | null;
  totalGainSnapshot: number | null;
  /** Frete/imposto/despesa do pedido (header). */
  orderFreightHeader: number;
  orderTaxesHeader: number;
  orderExpensesHeader: number;
  orderDiscountsHeader: number;
  freightIncoterm?: string | null;
  evidenceCount: number;
  lines: SavingsComparisonLineInput[];
};

export type SavingsComparisonLineResult = {
  purchaseOrderItemId: string;
  description: string;
  quantityOrdered: number;
  quantityAcceptedConfirmed: number;
  quantityPending: number;
  quantityVariation: number;
  initialUnitPrice: number | null;
  negotiatedUnitPrice: number;
  orderUnitPrice: number;
  receivedUnitCost: number | null;
  /** Ganho unitário negociado (initial − order), mérito histórico. */
  negotiatedUnitGain: number | null;
  /** Ganho realizado na qty aceita: (initial × qty) − custo comparável realizado. */
  realizedGain: number;
  /** Ganho ainda não realizado: negotiatedUnitGain × qty pendente. */
  unrealizedGain: number;
  /** Erosão do ganho por preço/frete/imposto/despesa vs condição do pedido (na qty aceita). */
  gainErosion: {
    priceDivergence: number;
    freight: number;
    taxes: number;
    expenses: number;
    total: number;
  };
  outsideNegotiatedCondition: boolean;
};

export type SavingsComparisonResult = {
  currency: string;
  prices: {
    initialComparable: number;
    negotiatedComparable: number;
    orderComparable: number;
    realizedComparable: number;
  };
  gains: {
    /** Mérito histórico — não muda com recebimento. */
    negotiatedGain: number;
    /** Concretizado na qty aceita confirmada. */
    realizedGain: number;
    /** Proporcional à quantidade ainda pendente. */
    unrealizedGain: number;
    /** Perda do ganho negociado por extras/divergência na parte recebida. */
    gainErosionTotal: number;
    gainErosionBreakdown: {
      priceDivergence: number;
      freight: number;
      taxes: number;
      expenses: number;
    };
  };
  quantities: {
    ordered: number;
    acceptedConfirmed: number;
    pending: number;
    variation: number;
  };
  lines: SavingsComparisonLineResult[];
  alerts: SavingsComparisonAlert[];
  meta: {
    negotiationMeritImmutable: true;
    partialReceiptsSupported: true;
    comparableBasis: "items+freight+taxes+expenses-discounts";
  };
};

function n(v: number | null | undefined): number {
  if (v == null) return 0;
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function includesBuyerFreight(incoterm: string | null | undefined): boolean {
  return String(incoterm || "FOB").trim().toUpperCase() !== "CIF";
}

function lineItemSubtotal(unit: number, qty: number): number {
  return unit * qty;
}

function lineComparable(input: {
  unit: number;
  qty: number;
  freight: number;
  taxes: number;
  expenses: number;
  discounts: number;
  includeFreight: boolean;
}): number {
  const items = lineItemSubtotal(input.unit, input.qty);
  const freight = input.includeFreight ? input.freight : 0;
  return items + freight + input.taxes + input.expenses - input.discounts;
}

/**
 * Proporciona extras do pedido à quantidade de referência (aceita ou pendente).
 * Extras do item já estão no nível da linha; header é rateado por qtyOrdered.
 */
export function allocateExtrasForQty(input: {
  quantityOrdered: number;
  quantityTarget: number;
  lineFreight: number;
  lineTaxes: number;
  lineExpenses: number;
  lineDiscounts: number;
  headerFreightShare: number;
  headerTaxesShare: number;
  headerExpensesShare: number;
  headerDiscountsShare: number;
}): { freight: number; taxes: number; expenses: number; discounts: number } {
  const ordered = n(input.quantityOrdered);
  const target = n(input.quantityTarget);
  if (ordered <= 0 || target <= 0) {
    return { freight: 0, taxes: 0, expenses: 0, discounts: 0 };
  }
  const ratio = Math.min(1, target / ordered);
  return {
    freight: (n(input.lineFreight) + n(input.headerFreightShare)) * ratio,
    taxes: (n(input.lineTaxes) + n(input.headerTaxesShare)) * ratio,
    expenses: (n(input.lineExpenses) + n(input.headerExpensesShare)) * ratio,
    discounts: (n(input.lineDiscounts) + n(input.headerDiscountsShare)) * ratio,
  };
}

export function computeSavingsComparison(
  input: SavingsComparisonHeaderInput
): SavingsComparisonResult {
  const includeFreight = includesBuyerFreight(input.freightIncoterm);
  const currency = String(input.currency || "BRL").trim().toUpperCase() || "BRL";

  const totalOrdered = input.lines.reduce((s, l) => s + n(l.quantityOrdered), 0);

  // Rateio de header por qty pedida
  const headerPerUnit =
    totalOrdered > 0
      ? {
          freight: n(input.orderFreightHeader) / totalOrdered,
          taxes: n(input.orderTaxesHeader) / totalOrdered,
          expenses: n(input.orderExpensesHeader) / totalOrdered,
          discounts: n(input.orderDiscountsHeader) / totalOrdered,
        }
      : { freight: 0, taxes: 0, expenses: 0, discounts: 0 };

  // Mérito histórico: preferir snapshots do PC; fallback recalcula só para exibição se ausentes.
  let negotiatedGain = input.totalGainSnapshot;
  let initialComparable = input.initialComparableTotalSnapshot;
  let negotiatedComparable = input.negotiatedComparableTotalSnapshot;

  if (initialComparable == null || negotiatedComparable == null || negotiatedGain == null) {
    let init = 0;
    let neg = 0;
    for (const line of input.lines) {
      const qty = n(line.quantityOrdered);
      const initialUnit = line.initialUnitPrice ?? line.orderUnitPrice;
      const orderExtras = allocateExtrasForQty({
        quantityOrdered: qty,
        quantityTarget: qty,
        lineFreight: line.orderFreight,
        lineTaxes: line.orderTaxes,
        lineExpenses: line.orderExpenses,
        lineDiscounts: line.orderDiscounts,
        headerFreightShare: headerPerUnit.freight * qty,
        headerTaxesShare: headerPerUnit.taxes * qty,
        headerExpensesShare: headerPerUnit.expenses * qty,
        headerDiscountsShare: headerPerUnit.discounts * qty,
      });
      init += lineComparable({
        unit: n(initialUnit),
        qty,
        ...orderExtras,
        includeFreight,
      });
      neg += lineComparable({
        unit: n(line.orderUnitPrice),
        qty,
        ...orderExtras,
        includeFreight,
      });
    }
    initialComparable = initialComparable ?? init;
    negotiatedComparable = negotiatedComparable ?? neg;
    negotiatedGain = negotiatedGain ?? initialComparable - negotiatedComparable;
  }

  const orderComparable = n(negotiatedComparable);
  const negotiatedGainValue = n(negotiatedGain);
  const initialComparableValue = n(initialComparable);

  const lines: SavingsComparisonLineResult[] = [];
  const alerts: SavingsComparisonAlert[] = [];

  let realizedGainTotal = 0;
  let unrealizedGainTotal = 0;
  let realizedComparableTotal = 0;
  let erosionPrice = 0;
  let erosionFreight = 0;
  let erosionTaxes = 0;
  let erosionExpenses = 0;
  let acceptedTotal = 0;
  let pendingTotal = 0;

  for (const line of input.lines) {
    const qtyOrdered = n(line.quantityOrdered);
    const qtyAccepted = Math.max(0, n(line.quantityAcceptedConfirmed));
    const qtyPending = Math.max(0, qtyOrdered - qtyAccepted);
    const qtyVariation = qtyAccepted - qtyOrdered;
    acceptedTotal += qtyAccepted;
    pendingTotal += qtyPending;

    const initialUnit = line.initialUnitPrice != null ? n(line.initialUnitPrice) : null;
    const orderUnit = n(line.orderUnitPrice);
    const receivedUnit = line.receivedUnitCost != null ? n(line.receivedUnitCost) : null;
    const negotiatedUnitGain =
      initialUnit != null ? round2(initialUnit - orderUnit) : null;

    const orderExtrasAccepted = allocateExtrasForQty({
      quantityOrdered: qtyOrdered,
      quantityTarget: qtyAccepted,
      lineFreight: line.orderFreight,
      lineTaxes: line.orderTaxes,
      lineExpenses: line.orderExpenses,
      lineDiscounts: line.orderDiscounts,
      headerFreightShare: headerPerUnit.freight * qtyOrdered,
      headerTaxesShare: headerPerUnit.taxes * qtyOrdered,
      headerExpensesShare: headerPerUnit.expenses * qtyOrdered,
      headerDiscountsShare: headerPerUnit.discounts * qtyOrdered,
    });

    const realizedExtras = {
      freight: n(line.receivedFreight),
      taxes: n(line.receivedTaxes),
      expenses: n(line.receivedExpenses),
      discounts: n(line.receivedDiscounts),
    };

    let realizedGain = 0;
    let lineRealizedComparable = 0;
    if (qtyAccepted > 0 && receivedUnit != null) {
      const initialBasis =
        initialUnit != null
          ? lineComparable({
              unit: initialUnit,
              qty: qtyAccepted,
              ...orderExtrasAccepted,
              includeFreight,
            })
          : lineComparable({
              unit: orderUnit,
              qty: qtyAccepted,
              ...orderExtrasAccepted,
              includeFreight,
            });
      lineRealizedComparable = lineComparable({
        unit: receivedUnit,
        qty: qtyAccepted,
        ...realizedExtras,
        includeFreight,
      });
      realizedGain = round2(initialBasis - lineRealizedComparable);
      realizedComparableTotal += lineRealizedComparable;
    } else if (qtyAccepted > 0 && receivedUnit == null) {
      // Sem custo efetivo: usa preço do pedido como realizado (ganho = negociado na fatia)
      lineRealizedComparable = lineComparable({
        unit: orderUnit,
        qty: qtyAccepted,
        ...orderExtrasAccepted,
        includeFreight,
      });
      const initialBasis =
        initialUnit != null
          ? lineComparable({
              unit: initialUnit,
              qty: qtyAccepted,
              ...orderExtrasAccepted,
              includeFreight,
            })
          : lineRealizedComparable;
      realizedGain = round2(initialBasis - lineRealizedComparable);
      realizedComparableTotal += lineRealizedComparable;
    }

    const unrealizedGain =
      negotiatedUnitGain != null ? round2(negotiatedUnitGain * qtyPending) : 0;

    // Erosão: custo realizado acima do custo do pedido na qty aceita
    const orderComparableAccepted = lineComparable({
      unit: orderUnit,
      qty: qtyAccepted,
      ...orderExtrasAccepted,
      includeFreight,
    });
    const priceDivergence =
      qtyAccepted > 0 && receivedUnit != null
        ? round2(Math.max(0, (receivedUnit - orderUnit) * qtyAccepted))
        : 0;
    const freightErosion = round2(
      Math.max(0, (includeFreight ? realizedExtras.freight : 0) - (includeFreight ? orderExtrasAccepted.freight : 0))
    );
    const taxesErosion = round2(Math.max(0, realizedExtras.taxes - orderExtrasAccepted.taxes));
    const expensesErosion = round2(
      Math.max(0, realizedExtras.expenses - orderExtrasAccepted.expenses)
    );
    // Se não houver breakdown de preço, residual da erosão total
    const totalErosionFromComparable =
      qtyAccepted > 0 ? round2(Math.max(0, lineRealizedComparable - orderComparableAccepted)) : 0;
    const breakdownSum = priceDivergence + freightErosion + taxesErosion + expensesErosion;
    const priceDivergenceAdj =
      breakdownSum > 0 || totalErosionFromComparable === 0
        ? priceDivergence
        : totalErosionFromComparable;

    erosionPrice += priceDivergenceAdj;
    erosionFreight += freightErosion;
    erosionTaxes += taxesErosion;
    erosionExpenses += expensesErosion;

    const outside =
      (receivedUnit != null && receivedUnit > orderUnit + 1e-9) ||
      freightErosion > 1e-6 ||
      taxesErosion > 1e-6 ||
      expensesErosion > 1e-6;

    if (receivedUnit != null && receivedUnit > orderUnit + 1e-9) {
      alerts.push({
        code: "RECEIVED_PRICE_ABOVE_ORDER",
        severity: "critical",
        message: `Preço recebido (${receivedUnit}) acima do pedido (${orderUnit}) em "${line.description}".`,
        purchaseOrderItemId: line.purchaseOrderItemId,
        amount: priceDivergenceAdj,
      });
    }
    if (freightErosion + taxesErosion + expensesErosion > 1e-6) {
      alerts.push({
        code: "ADDITIONAL_COST",
        severity: "warning",
        message: `Custo adicional (frete/imposto/despesa) na linha "${line.description}".`,
        purchaseOrderItemId: line.purchaseOrderItemId,
        amount: round2(freightErosion + taxesErosion + expensesErosion),
      });
    }
    if (outside) {
      alerts.push({
        code: "OUTSIDE_NEGOTIATED_CONDITION",
        severity: "warning",
        message: `Recebimento fora da condição negociada em "${line.description}".`,
        purchaseOrderItemId: line.purchaseOrderItemId,
      });
    }
    if (Math.abs(qtyVariation) > 1e-9 && qtyAccepted > 0) {
      alerts.push({
        code: "QUANTITY_VARIATION",
        severity: "info",
        message: `Variação de quantidade em "${line.description}": aceita ${qtyAccepted} vs pedida ${qtyOrdered}.`,
        purchaseOrderItemId: line.purchaseOrderItemId,
        amount: qtyVariation,
      });
    }

    realizedGainTotal += realizedGain;
    unrealizedGainTotal += unrealizedGain;

    lines.push({
      purchaseOrderItemId: line.purchaseOrderItemId,
      description: line.description,
      quantityOrdered: qtyOrdered,
      quantityAcceptedConfirmed: qtyAccepted,
      quantityPending: qtyPending,
      quantityVariation: round2(qtyVariation),
      initialUnitPrice: initialUnit,
      negotiatedUnitPrice: orderUnit,
      orderUnitPrice: orderUnit,
      receivedUnitCost: receivedUnit,
      negotiatedUnitGain,
      realizedGain,
      unrealizedGain,
      gainErosion: {
        priceDivergence: priceDivergenceAdj,
        freight: freightErosion,
        taxes: taxesErosion,
        expenses: expensesErosion,
        total: round2(priceDivergenceAdj + freightErosion + taxesErosion + expensesErosion),
      },
      outsideNegotiatedCondition: outside,
    });
  }

  if (input.evidenceCount <= 0 && acceptedTotal > 0) {
    alerts.push({
      code: "MISSING_EVIDENCE",
      severity: "warning",
      message: "Há quantidade recebida confirmada sem evidência vinculada ao pedido/recebimento.",
    });
  }

  const gainErosionTotal = round2(erosionPrice + erosionFreight + erosionTaxes + erosionExpenses);

  return {
    currency,
    prices: {
      initialComparable: round2(initialComparableValue),
      negotiatedComparable: round2(orderComparable),
      orderComparable: round2(orderComparable),
      realizedComparable: round2(realizedComparableTotal),
    },
    gains: {
      negotiatedGain: round2(negotiatedGainValue),
      realizedGain: round2(realizedGainTotal),
      unrealizedGain: round2(unrealizedGainTotal),
      gainErosionTotal,
      gainErosionBreakdown: {
        priceDivergence: round2(erosionPrice),
        freight: round2(erosionFreight),
        taxes: round2(erosionTaxes),
        expenses: round2(erosionExpenses),
      },
    },
    quantities: {
      ordered: round2(totalOrdered),
      acceptedConfirmed: round2(acceptedTotal),
      pending: round2(pendingTotal),
      variation: round2(acceptedTotal - totalOrdered),
    },
    lines,
    alerts,
    meta: {
      negotiationMeritImmutable: true,
      partialReceiptsSupported: true,
      comparableBasis: "items+freight+taxes+expenses-discounts",
    },
  };
}
