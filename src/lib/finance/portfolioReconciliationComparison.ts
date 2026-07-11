/**
 * Comparação read-only: visão atual/oficial (CR rateado + cabeçalhos NF como risco)
 * vs nova conciliação (businessAnswers / saldo projetado).
 *
 * Não altera Fluxo de Caixa, Contas a Receber, Faturamento, Comissões nem a tabela fato.
 * Não soma forecastValue bruto nem cabeçalho de NF como carteira.
 */

import type { PortfolioBusinessAnswers } from "./portfolioReconciliationBusinessAnswers.js";
import { isOpenOverdueReceivableFact } from "./portfolioReconciliationBusinessAnswers.js";
import type {
  PortfolioReconciliationFactApiRow,
  PortfolioReconciliationOrderRow,
  PortfolioReconciliationSummaryCards,
} from "./portfolioReconciliationApi.js";
import {
  computeOrderProjectedOpenBalance,
  resolveOrderAggregatedForecast,
} from "./portfolioReconciliationProjectedBalance.js";

function round2(n: number): number {
  return Number(n.toFixed(2));
}

function toNumber(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return value;
}

function moneyBr(n: number): string {
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function orderKey(row: PortfolioReconciliationOrderRow): string {
  return (
    row.salesOrderId ??
    (row.pedido ? `code:${row.pedido}` : `anon:${row.cliente ?? "x"}`)
  );
}

function factOrderKey(fact: PortfolioReconciliationFactApiRow): string {
  return (
    fact.salesOrderId ??
    (fact.externalSalesOrderId != null
      ? `ext:${fact.externalSalesOrderId}`
      : fact.orderCode
        ? `code:${fact.orderCode}`
        : fact.id)
  );
}

function groupFactsByOrder(
  facts: readonly PortfolioReconciliationFactApiRow[]
): Map<string, PortfolioReconciliationFactApiRow[]> {
  const map = new Map<string, PortfolioReconciliationFactApiRow[]>();
  for (const fact of facts) {
    const key = factOrderKey(fact);
    const list = map.get(key) ?? [];
    list.push(fact);
    map.set(key, list);
  }
  return map;
}

function readTraceHeaderSum(traceJson: unknown): number | null {
  if (!traceJson || typeof traceJson !== "object" || Array.isArray(traceJson)) {
    return null;
  }
  const raw = (traceJson as Record<string, unknown>).headerSum;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  return null;
}

/**
 * Soma cabeçalhos NF únicos por nfeExternalId.
 * Se não houver nfeHeaderValue nas facts, usa o maior headerSum do trace (alerta).
 * Nunca deve ser tratado como valor da carteira.
 */
export function sumUniqueNfeHeaderValue(
  facts: readonly PortfolioReconciliationFactApiRow[]
): number {
  const byNfe = new Map<number, number>();
  let fromTrace = 0;
  for (const fact of facts) {
    if (fact.nfeExternalId != null && fact.nfeHeaderValue != null) {
      if (!byNfe.has(fact.nfeExternalId)) {
        byNfe.set(fact.nfeExternalId, toNumber(fact.nfeHeaderValue));
      }
    }
    const traced = readTraceHeaderSum(fact.traceJson);
    if (traced != null) fromTrace = Math.max(fromTrace, traced);
  }
  let fromFacts = 0;
  for (const v of byNfe.values()) fromFacts += v;
  return round2(fromFacts > 0 ? fromFacts : fromTrace);
}

function sumItemizedAllocated(
  facts: readonly PortfolioReconciliationFactApiRow[]
): number {
  let sum = 0;
  for (const fact of facts) {
    if ((fact.allocatedQuantity ?? 0) <= 0) continue;
    sum += toNumber(fact.allocatedValueByOrderPrice);
  }
  return round2(sum);
}

function sumItemizedOpenReceivable(
  facts: readonly PortfolioReconciliationFactApiRow[]
): number {
  let sum = 0;
  for (const fact of facts) {
    if ((fact.allocatedQuantity ?? 0) <= 0) continue;
    if (fact.openReceivableValue == null) continue;
    sum += toNumber(fact.openReceivableValue);
  }
  return round2(sum);
}

function sumItemizedReceivableTotal(
  facts: readonly PortfolioReconciliationFactApiRow[]
): number {
  let sum = 0;
  for (const fact of facts) {
    if ((fact.allocatedQuantity ?? 0) <= 0) continue;
    if (fact.receivableTotalValue == null) continue;
    sum += toNumber(fact.receivableTotalValue);
  }
  return round2(sum);
}

function sumItemizedReceived(
  facts: readonly PortfolioReconciliationFactApiRow[]
): number {
  let sum = 0;
  for (const fact of facts) {
    if ((fact.allocatedQuantity ?? 0) <= 0) continue;
    if (fact.receivedValue == null) continue;
    sum += toNumber(fact.receivedValue);
  }
  return round2(sum);
}

function sumOpenOverdueReceivable(
  facts: readonly PortfolioReconciliationFactApiRow[],
  asOf: string
): number {
  let sum = 0;
  for (const fact of facts) {
    if (!isOpenOverdueReceivableFact(fact, asOf)) continue;
    sum += toNumber(fact.openReceivableValue);
  }
  return round2(sum);
}

function startOfDayIso(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export type PortfolioComparisonOrderBreakdown = {
  orderCode: string;
  orderValue: number;
  currentReceivableValue: number;
  receivedValue: number;
  openReceivableValue: number;
  nfeHeaderValue: number;
  itemizedAllocatedValue: number;
  projectedOpenBalance: number;
  orderOnlyValue: number;
  invoicedWithoutReceivableValue: number;
  reviewValue: number;
  headerInflationRiskValue: number;
  mainStatus: string;
  mainExplanation: string;
  alerts: string[];
};

export type PortfolioReconciliationComparison = {
  currentView: {
    officialReceivableOpenValue: number;
    officialReceivableTotalValue: number;
    officialReceivedValue: number;
    officialOverdueReceivableValue: number;
    officialNfeHeaderValue: number;
    officialOrderValue: number;
    explanation: string;
  };
  reconciliationView: {
    projectedOpenBalance: number;
    receivableConfirmedValue: number;
    invoicedWithoutReceivableValue: number;
    orderOnlyValue: number;
    orderOnlyReviewValue: number;
    reviewRequiredValue: number;
    reviewRequiredOrders: number;
    alertsCount: number;
    explanation: string;
  };
  differences: {
    receivableVsReconciledDifference: number;
    invisibleToReceivableValue: number;
    headerInflationRiskValue: number;
    orderOnlyReviewValue: number;
    dataQualityRiskValue: number;
    explanation: string;
  };
  orderBreakdown: PortfolioComparisonOrderBreakdown[];
};

function buildOrderExplanation(args: {
  orderCode: string;
  orderValue: number;
  nfeHeaderValue: number;
  projectedOpenBalance: number;
  openReceivableValue: number;
  source: string;
  alerts: string[];
}): string {
  const { orderCode, orderValue, nfeHeaderValue, projectedOpenBalance, openReceivableValue, source, alerts } =
    args;

  if (nfeHeaderValue > orderValue + 0.01) {
    return `Pedido de ${moneyBr(orderValue)} possui NFs vinculadas com cabeçalhos somando ${moneyBr(nfeHeaderValue)}; a conciliação usa itens/documento e limita ao pedido.`;
  }

  if (source === "ORDER" || (openReceivableValue <= 0 && projectedOpenBalance > 0 && source !== "RECEIVABLE")) {
    if (alerts.length > 0) {
      return `${orderCode}: ${moneyBr(projectedOpenBalance)} ainda só em pedido/carteira e precisa revisão (${alerts[0]}).`;
    }
    return `${orderCode}: ${moneyBr(projectedOpenBalance)} ainda não virou Contas a Receber.`;
  }

  if (source === "NFE") {
    return `${orderCode}: faturado/documento sem CR rateado confiável; saldo projetado ${moneyBr(projectedOpenBalance)}.`;
  }

  if (source === "RECEIVABLE") {
    return `${orderCode}: CR rateado em aberto ${moneyBr(openReceivableValue)}; saldo projetado ${moneyBr(projectedOpenBalance)}.`;
  }

  if (alerts.length > 0) {
    return `${orderCode}: ${alerts[0]}`;
  }

  return `${orderCode}: status ${source}; pedido ${moneyBr(orderValue)}.`;
}

function buildOrderBreakdownRow(
  row: PortfolioReconciliationOrderRow,
  facts: readonly PortfolioReconciliationFactApiRow[]
): PortfolioComparisonOrderBreakdown {
  const orderValue = round2(row.valorPedido);
  const currentReceivableValue = sumItemizedReceivableTotal(facts);
  const receivedValue = sumItemizedReceived(facts);
  const openReceivableValue =
    sumItemizedOpenReceivable(facts) ||
    round2(Math.max(0, currentReceivableValue - receivedValue));
  const nfeHeaderValue = sumUniqueNfeHeaderValue(facts);
  const itemizedAllocatedValue = sumItemizedAllocated(facts);
  const projectedOpenBalance = computeOrderProjectedOpenBalance(facts);
  const forecast = resolveOrderAggregatedForecast(facts);
  const source = forecast.source;

  const orderOnlyValue =
    source === "ORDER" || row.status === "ORDER_ONLY"
      ? round2(Math.max(orderValue, projectedOpenBalance))
      : 0;
  const invoicedWithoutReceivableValue =
    source === "NFE" && openReceivableValue <= 0
      ? round2(Math.max(itemizedAllocatedValue, projectedOpenBalance))
      : 0;
  const reviewValue = row.alertas.length > 0 || row.hasIssues ? orderValue : 0;
  const headerInflationRiskValue =
    nfeHeaderValue > orderValue + 0.01 ? round2(nfeHeaderValue - orderValue) : 0;

  return {
    orderCode: row.pedido ?? row.salesOrderId ?? "—",
    orderValue,
    currentReceivableValue,
    receivedValue,
    openReceivableValue,
    nfeHeaderValue,
    itemizedAllocatedValue,
    projectedOpenBalance: round2(projectedOpenBalance),
    orderOnlyValue,
    invoicedWithoutReceivableValue,
    reviewValue: round2(reviewValue),
    headerInflationRiskValue,
    mainStatus: row.status,
    mainExplanation: buildOrderExplanation({
      orderCode: row.pedido ?? "Pedido",
      orderValue,
      nfeHeaderValue,
      projectedOpenBalance: round2(projectedOpenBalance),
      openReceivableValue,
      source,
      alerts: row.alertas,
    }),
    alerts: [...row.alertas],
  };
}

/**
 * Monta o comparativo visão atual × nova conciliação a partir de rows/facts já filtrados
 * e das businessAnswers oficiais do backend.
 */
export function buildPortfolioReconciliationComparison(args: {
  orderRows: readonly PortfolioReconciliationOrderRow[];
  facts: readonly PortfolioReconciliationFactApiRow[];
  summary: PortfolioReconciliationSummaryCards;
  businessAnswers: PortfolioBusinessAnswers;
  asOfDate?: Date | string;
}): PortfolioReconciliationComparison {
  const asOf =
    typeof args.asOfDate === "string"
      ? args.asOfDate.slice(0, 10)
      : startOfDayIso(args.asOfDate ?? new Date());

  const factsByOrder = groupFactsByOrder(args.facts);
  const breakdown: PortfolioComparisonOrderBreakdown[] = [];

  let officialReceivableTotalValue = 0;
  let officialReceivedValue = 0;
  let officialReceivableOpenValue = 0;
  let officialNfeHeaderValue = 0;
  let officialOrderValue = 0;
  let headerInflationRiskValue = 0;

  for (const row of args.orderRows) {
    const key = orderKey(row);
    const facts =
      factsByOrder.get(key) ||
      (row.salesOrderId ? factsByOrder.get(row.salesOrderId) : undefined) ||
      (row.pedido ? factsByOrder.get(`code:${row.pedido}`) : undefined) ||
      [];

    const line = buildOrderBreakdownRow(row, facts);
    breakdown.push(line);

    officialReceivableTotalValue += line.currentReceivableValue;
    officialReceivedValue += line.receivedValue;
    officialReceivableOpenValue += line.openReceivableValue;
    officialNfeHeaderValue += line.nfeHeaderValue;
    officialOrderValue += line.orderValue;
    headerInflationRiskValue += line.headerInflationRiskValue;
  }

  // Preferir totais oficiais da run/cards quando o universo não está fatiado por pedido.
  const openFromSummary = round2(
    Math.max(0, args.summary.totalContasReceber - args.summary.totalRecebido)
  );
  if (args.summary.totalContasReceber > 0 && officialReceivableTotalValue === 0) {
    officialReceivableTotalValue = round2(args.summary.totalContasReceber);
    officialReceivedValue = round2(args.summary.totalRecebido);
    officialReceivableOpenValue = openFromSummary;
  } else if (
    args.summary.totalContasReceber > 0 &&
    Math.abs(officialReceivableTotalValue - args.summary.totalContasReceber) > 1
  ) {
    // Mantém rateado por pedido; summary já é a fonte dos cards.
    officialReceivableTotalValue = round2(args.summary.totalContasReceber);
    officialReceivedValue = round2(args.summary.totalRecebido);
    officialReceivableOpenValue =
      openFromSummary > 0 ? openFromSummary : round2(officialReceivableOpenValue);
  }

  if (args.summary.totalValorPedidos > 0) {
    officialOrderValue = round2(args.summary.totalValorPedidos);
  }

  const officialOverdueReceivableValue = sumOpenOverdueReceivable(args.facts, asOf);

  const ba = args.businessAnswers;
  const projectedOpenBalance = round2(ba.quantoTenhoParaReceber.value);
  const receivableConfirmedValue = round2(ba.jaVirouContasReceber.value);
  const invoicedWithoutReceivableValue = round2(ba.faturadoSemContasReceber.value);
  const orderOnlyValue = round2(ba.soPedidoCarteira.value);
  const orderOnlyReviewValue = round2(ba.soPedidoCarteira.reviewValue);
  const reviewRequiredValue = round2(ba.precisaRevisar.valueAtRisk);
  const reviewRequiredOrders = ba.precisaRevisar.ordersCount;
  const alertsCount = ba.precisaRevisar.alertsCount;

  const receivableOpenForDiff =
    officialReceivableOpenValue > 0
      ? officialReceivableOpenValue
      : round2(Math.min(officialReceivableTotalValue, receivableConfirmedValue));

  const receivableVsReconciledDifference = round2(
    projectedOpenBalance - receivableOpenForDiff
  );
  const invisibleToReceivableValue = round2(
    Math.max(
      0,
      orderOnlyValue + orderOnlyReviewValue + invoicedWithoutReceivableValue
    )
  );
  const dataQualityRiskValue = round2(reviewRequiredValue);

  // Pedidos que explicam diferença: revisão, fora do CR, ou inflação de cabeçalho.
  breakdown.sort((a, b) => {
    const score = (x: PortfolioComparisonOrderBreakdown) =>
      x.headerInflationRiskValue +
      x.reviewValue +
      x.orderOnlyValue +
      x.invoicedWithoutReceivableValue;
    return score(b) - score(a) || a.orderCode.localeCompare(b.orderCode, "pt-BR");
  });

  return {
    currentView: {
      officialReceivableOpenValue: round2(officialReceivableOpenValue || receivableOpenForDiff),
      officialReceivableTotalValue: round2(officialReceivableTotalValue),
      officialReceivedValue: round2(officialReceivedValue),
      officialOverdueReceivableValue,
      officialNfeHeaderValue: round2(officialNfeHeaderValue),
      officialOrderValue: round2(officialOrderValue),
      explanation:
        "Visão atual a partir do Contas a Receber rateado aos pedidos (total, recebido e aberto). Soma de cabeçalhos de NF é só referência de risco — não entra como carteira.",
    },
    reconciliationView: {
      projectedOpenBalance,
      receivableConfirmedValue,
      invoicedWithoutReceivableValue,
      orderOnlyValue,
      orderOnlyReviewValue,
      reviewRequiredValue,
      reviewRequiredOrders,
      alertsCount,
      explanation:
        "Nova conciliação: saldo projetado sem duplicar pedido/NF/CR (RECEIVABLE > NFE > ORDER). Pedidos só em carteira com baixa confiança entram em revisão.",
    },
    differences: {
      receivableVsReconciledDifference,
      invisibleToReceivableValue,
      headerInflationRiskValue: round2(headerInflationRiskValue),
      orderOnlyReviewValue,
      dataQualityRiskValue,
      explanation:
        "Diferença = saldo projetado da conciliação menos CR aberto rateado. Inclui o que ainda não virou CR, o que precisa revisão e o risco de inflar a carteira se usássemos cabeçalho de NF.",
    },
    orderBreakdown: breakdown,
  };
}
