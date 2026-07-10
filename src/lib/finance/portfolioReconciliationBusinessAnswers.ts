/**
 * Respostas executivas da Conciliação de Carteira (camada paralela, read-only).
 *
 * Toda a regra de negócio fica aqui — a UI só renderiza.
 * Prioridade oficial: RECEIVABLE > NFE > ORDER > UNRESOLVED.
 * Não soma forecastValue bruto, cabeçalho NF nem CR bruto sem rateio.
 */

import type {
  PortfolioReconciliationFactApiRow,
  PortfolioReconciliationOrderRow,
  PortfolioReconciliationSummaryCards,
  PortfolioRunSummaryJsonLike,
} from "./portfolioReconciliationApi.js";
import {
  computeOrderProjectedOpenBalance,
  resolveOrderAggregatedForecast,
  selectOrderForecastContributingFacts,
} from "./portfolioReconciliationProjectedBalance.js";
import type { PortfolioForecastSource } from "./portfolioReconciliationAllocationEngine.js";

export type PortfolioReceiptBucketId =
  | "OPEN_OVERDUE_RECEIVABLE"
  | "OUTDATED_FORECAST"
  | "NEXT_7_DAYS"
  | "NEXT_30_DAYS"
  | "AFTER_30_DAYS"
  | "WITHOUT_RELIABLE_DATE";

export type PortfolioReceiptBucket = {
  id: PortfolioReceiptBucketId;
  label: string;
  value: number;
  ordersCount: number;
};

export type PortfolioBusinessAnswerFilterHint = {
  forecastSource?: "RECEIVABLE" | "NFE" | "ORDER" | "UNRESOLVED" | null;
  onlyIssues?: boolean;
  receiptBucket?: PortfolioReceiptBucketId | null;
};

export type PortfolioQuandoHighlightKind =
  | "OPEN_OVERDUE_RECEIVABLE"
  | "NEXT_DATE"
  | "OUTDATED_FORECAST"
  | "EMPTY";

export type PortfolioBusinessAnswers = {
  quantoTenhoParaReceber: {
    value: number;
    label: string;
    explanation: string;
    validationHint: string;
    question: string;
    filterHint: PortfolioBusinessAnswerFilterHint;
  };
  quandoVouReceber: {
    nextDate: string | null;
    nextDateLabel: string | null;
    nextDateValue: number;
    /** @deprecated use openOverdueReceivablesValue — só títulos CR abertos vencidos. */
    overdueValue: number;
    openOverdueReceivablesValue: number;
    outdatedForecastValue: number;
    next7DaysValue: number;
    next30DaysValue: number;
    over30DaysValue: number;
    withoutReliableDateValue: number;
    highlightKind: PortfolioQuandoHighlightKind;
    highlightValue: number;
    headlineLabel: string;
    highlightSubtitle: string;
    buckets: PortfolioReceiptBucket[];
    explanation: string;
    question: string;
    filterHint: PortfolioBusinessAnswerFilterHint;
  };
  jaVirouContasReceber: {
    value: number;
    ordersCount: number;
    label: string;
    explanation: string;
    question: string;
    filterHint: PortfolioBusinessAnswerFilterHint;
  };
  faturadoSemContasReceber: {
    value: number;
    ordersCount: number;
    label: string;
    explanation: string;
    question: string;
    filterHint: PortfolioBusinessAnswerFilterHint;
  };
  soPedidoCarteira: {
    value: number;
    ordersCount: number;
    reviewValue: number;
    reviewOrdersCount: number;
    totalOrderOnlyValue: number;
    totalOrderOnlyOrdersCount: number;
    label: string;
    explanation: string;
    displayPrimaryValue: number;
    displaySubtitle: string;
    question: string;
    filterHint: PortfolioBusinessAnswerFilterHint;
  };
  precisaRevisar: {
    ordersCount: number;
    alertsCount: number;
    valueAtRisk: number;
    valorPedidosComAlerta: number;
    mainReasons: Array<{ reason: string; count: number; label?: string }>;
    explanation: string;
    question: string;
    filterHint: PortfolioBusinessAnswerFilterHint;
  };
};

function round2(n: number): number {
  return Number(n.toFixed(2));
}

function toNumber(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return value;
}

function toIsoDate(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
    const d = new Date(trimmed);
    if (Number.isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  if (Number.isNaN(value.getTime())) return null;
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function formatBrDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function startOfDayIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y!, m! - 1, d!);
  dt.setDate(dt.getDate() + days);
  return startOfDayIso(dt);
}

function isLowConfidence(level: string): boolean {
  const u = level.toUpperCase();
  return u === "LOW" || u === "BLOCKED";
}

function isUnreliableStatus(status: string | null): boolean {
  return (
    status === "DATA_QUALITY_ISSUE" ||
    status === "HEADER_ONLY_LINK" ||
    status === "AMBIGUOUS_ALLOCATION" ||
    status === "OVER_LINKED_BY_HEADER"
  );
}

function groupFactsByOrder(
  facts: readonly PortfolioReconciliationFactApiRow[]
): Map<string, PortfolioReconciliationFactApiRow[]> {
  const map = new Map<string, PortfolioReconciliationFactApiRow[]>();
  for (const fact of facts) {
    const key =
      fact.salesOrderId ??
      (fact.externalSalesOrderId != null
        ? `ext:${fact.externalSalesOrderId}`
        : fact.orderCode
          ? `code:${fact.orderCode}`
          : fact.id);
    const list = map.get(key) ?? [];
    list.push(fact);
    map.set(key, list);
  }
  return map;
}

function factOpenValue(fact: {
  openReceivableValue: number | null;
  forecastValue: number | null;
  allocatedValueByOrderPrice?: number | null;
}): number {
  if (fact.openReceivableValue != null) return toNumber(fact.openReceivableValue);
  if (fact.forecastValue != null) return toNumber(fact.forecastValue);
  return toNumber(fact.allocatedValueByOrderPrice);
}

function primaryDateForFact(fact: PortfolioReconciliationFactApiRow): string | null {
  const dates: string[] = [];
  if (Array.isArray(fact.dueDatesJson)) {
    for (const due of fact.dueDatesJson) {
      const iso = toIsoDate(due as string | Date | null);
      if (iso) dates.push(iso);
    }
  }
  const forecastIso = toIsoDate(fact.forecastDate);
  if (forecastIso) dates.push(forecastIso);
  if (dates.length === 0) return null;
  dates.sort();
  return dates[0]!;
}

function asForecastSource(value: string): PortfolioForecastSource {
  if (value === "RECEIVABLE" || value === "NFE" || value === "ORDER" || value === "UNRESOLVED") {
    return value;
  }
  return "UNRESOLVED";
}

/**
 * Título real de CR aberto e vencido (atraso financeiro).
 * Não inclui ORDER/NFE, RECEIVED, nem previsão de calendário.
 */
export function isOpenOverdueReceivableFact(
  fact: PortfolioReconciliationFactApiRow,
  asOf: string
): boolean {
  if (asForecastSource(fact.forecastSource) !== "RECEIVABLE") return false;
  if (fact.status === "RECEIVED") return false;
  const open = toNumber(fact.openReceivableValue);
  if (open <= 0) return false;
  const due = primaryDateForFact(fact);
  if (!due || due >= asOf) return false;
  return true;
}

function classifyReceiptBucket(
  fact: PortfolioReconciliationFactApiRow,
  asOf: string,
  date: string | null
): PortfolioReceiptBucketId {
  if (!date) return "WITHOUT_RELIABLE_DATE";
  if (date < asOf) {
    return isOpenOverdueReceivableFact(fact, asOf)
      ? "OPEN_OVERDUE_RECEIVABLE"
      : "OUTDATED_FORECAST";
  }
  const d7 = addDaysIso(asOf, 7);
  const d30 = addDaysIso(asOf, 30);
  if (date <= d7) return "NEXT_7_DAYS";
  if (date <= d30) return "NEXT_30_DAYS";
  return "AFTER_30_DAYS";
}

const BUCKET_LABELS: Record<PortfolioReceiptBucketId, string> = {
  OPEN_OVERDUE_RECEIVABLE: "Títulos vencidos",
  OUTDATED_FORECAST: "Previsões para revisar",
  NEXT_7_DAYS: "Próximos 7 dias",
  NEXT_30_DAYS: "Próximos 30 dias",
  AFTER_30_DAYS: "Depois de 30 dias",
  WITHOUT_RELIABLE_DATE: "Sem data confiável",
};

const BUCKET_ORDER: PortfolioReceiptBucketId[] = [
  "OPEN_OVERDUE_RECEIVABLE",
  "OUTDATED_FORECAST",
  "NEXT_7_DAYS",
  "NEXT_30_DAYS",
  "AFTER_30_DAYS",
  "WITHOUT_RELIABLE_DATE",
];

/**
 * Distribui o saldo projetado por data de forecast (sem duplicar rollup + item).
 * Separa título CR vencido de previsão ultrapassada (ORDER/NFE/calendário).
 */
export function buildReceiptTimingBuckets(args: {
  factsByOrder: Map<string, PortfolioReconciliationFactApiRow[]>;
  asOfDate?: Date | string;
}): {
  buckets: PortfolioReceiptBucket[];
  nextDate: string | null;
  nextDateValue: number;
  openOverdueReceivablesValue: number;
  outdatedForecastValue: number;
  /** Alias de openOverdueReceivablesValue (compat). */
  overdueValue: number;
  next7DaysValue: number;
  next30DaysValue: number;
  over30DaysValue: number;
  withoutReliableDateValue: number;
} {
  const asOf =
    typeof args.asOfDate === "string"
      ? args.asOfDate.slice(0, 10)
      : startOfDayIso(args.asOfDate ?? new Date());

  const valueByBucket = new Map<PortfolioReceiptBucketId, number>();
  const ordersByBucket = new Map<PortfolioReceiptBucketId, Set<string>>();
  const valueByFutureDate = new Map<string, number>();

  for (const id of BUCKET_ORDER) {
    valueByBucket.set(id, 0);
    ordersByBucket.set(id, new Set());
  }

  for (const [orderKey, facts] of args.factsByOrder) {
    const forecast = resolveOrderAggregatedForecast(facts);
    if (forecast.source === "UNRESOLVED") {
      const saldo = computeOrderProjectedOpenBalance(facts);
      if (saldo <= 0) continue;
      valueByBucket.set(
        "WITHOUT_RELIABLE_DATE",
        (valueByBucket.get("WITHOUT_RELIABLE_DATE") ?? 0) + saldo
      );
      ordersByBucket.get("WITHOUT_RELIABLE_DATE")!.add(orderKey);
      continue;
    }

    const contributing = selectOrderForecastContributingFacts(facts, forecast.source);
    if (contributing.length === 0) {
      const saldo = computeOrderProjectedOpenBalance(facts);
      if (saldo <= 0) continue;
      valueByBucket.set(
        "WITHOUT_RELIABLE_DATE",
        (valueByBucket.get("WITHOUT_RELIABLE_DATE") ?? 0) + saldo
      );
      ordersByBucket.get("WITHOUT_RELIABLE_DATE")!.add(orderKey);
      continue;
    }

    for (const fact of contributing) {
      const apiFact = fact as PortfolioReconciliationFactApiRow;
      const value = factOpenValue(apiFact);
      if (value <= 0) continue;
      // Baixado: não entra em título vencido nem como previsão futura do CR.
      if (apiFact.status === "RECEIVED") continue;

      const date = primaryDateForFact(apiFact);
      const bucket = classifyReceiptBucket(apiFact, asOf, date);
      valueByBucket.set(bucket, (valueByBucket.get(bucket) ?? 0) + value);
      ordersByBucket.get(bucket)!.add(orderKey);
      if (date && date >= asOf) {
        valueByFutureDate.set(date, (valueByFutureDate.get(date) ?? 0) + value);
      }
    }
  }

  const futureDates = [...valueByFutureDate.keys()].sort();
  const nextDate = futureDates[0] ?? null;
  const nextDateValue = nextDate ? round2(valueByFutureDate.get(nextDate) ?? 0) : 0;

  const buckets: PortfolioReceiptBucket[] = BUCKET_ORDER.map((id) => ({
    id,
    label: BUCKET_LABELS[id],
    value: round2(valueByBucket.get(id) ?? 0),
    ordersCount: ordersByBucket.get(id)?.size ?? 0,
  }));

  const openOverdueReceivablesValue = buckets.find(
    (b) => b.id === "OPEN_OVERDUE_RECEIVABLE"
  )!.value;
  const outdatedForecastValue = buckets.find((b) => b.id === "OUTDATED_FORECAST")!.value;
  const next7DaysValue = buckets.find((b) => b.id === "NEXT_7_DAYS")!.value;
  const next30Window =
    next7DaysValue + buckets.find((b) => b.id === "NEXT_30_DAYS")!.value;
  const over30DaysValue = buckets.find((b) => b.id === "AFTER_30_DAYS")!.value;
  const withoutReliableDateValue = buckets.find(
    (b) => b.id === "WITHOUT_RELIABLE_DATE"
  )!.value;

  return {
    buckets,
    nextDate,
    nextDateValue,
    openOverdueReceivablesValue,
    outdatedForecastValue,
    overdueValue: openOverdueReceivablesValue,
    next7DaysValue,
    next30DaysValue: round2(next30Window),
    over30DaysValue,
    withoutReliableDateValue,
  };
}

function classifyOrderSource(
  facts: readonly PortfolioReconciliationFactApiRow[]
): PortfolioForecastSource {
  return resolveOrderAggregatedForecast(facts).source;
}

function isConfidentForSlice(row: PortfolioReconciliationOrderRow): boolean {
  if (isLowConfidence(row.confidenceLevel)) return false;
  if (isUnreliableStatus(row.status)) return false;
  if (row.alertas.length > 0) return false;
  return true;
}

function isOrderOnlyCarteira(
  row: PortfolioReconciliationOrderRow,
  source: PortfolioForecastSource,
  facts: readonly PortfolioReconciliationFactApiRow[]
): boolean {
  if (source === "ORDER") return true;
  if (row.status === "ORDER_ONLY") return true;
  if (facts.length > 0 && facts.every((f) => f.status === "ORDER_ONLY")) return true;
  return false;
}

/** Valor oficial do pedido (nunca cabeçalho NF). */
function orderOfficialValue(row: PortfolioReconciliationOrderRow): number {
  if (row.valorPedido > 0) return row.valorPedido;
  if (row.saldo > 0) return row.saldo;
  return Math.max(row.valorAlocado, 0);
}

function moneyBrCompact(n: number): string {
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

function buildQuandoHighlight(timing: {
  openOverdueReceivablesValue: number;
  outdatedForecastValue: number;
  nextDate: string | null;
  nextDateValue: number;
  next30DaysValue: number;
}): {
  highlightKind: PortfolioQuandoHighlightKind;
  highlightValue: number;
  headlineLabel: string;
  highlightSubtitle: string;
  nextDateLabel: string | null;
} {
  const nextDateLabel = timing.nextDate ? formatBrDate(timing.nextDate) : null;

  if (timing.openOverdueReceivablesValue > 0) {
    const nextLine = nextDateLabel
      ? `Próximo vencimento: ${nextDateLabel}`
      : "Sem próximo vencimento confiável";
    return {
      highlightKind: "OPEN_OVERDUE_RECEIVABLE",
      highlightValue: timing.openOverdueReceivablesValue,
      headlineLabel: "em títulos vencidos",
      highlightSubtitle: `Contas a Receber em aberto com vencimento já passado. ${nextLine} · ${moneyBrCompact(timing.next30DaysValue)} nos próximos 30 dias`,
      nextDateLabel,
    };
  }

  if (nextDateLabel) {
    return {
      highlightKind: "NEXT_DATE",
      highlightValue: timing.nextDateValue,
      headlineLabel: "Próximo recebimento",
      highlightSubtitle: `${moneyBrCompact(timing.next30DaysValue)} nos próximos 30 dias.`,
      nextDateLabel,
    };
  }

  if (timing.outdatedForecastValue > 0) {
    return {
      highlightKind: "OUTDATED_FORECAST",
      highlightValue: timing.outdatedForecastValue,
      headlineLabel: "em previsões para revisar",
      highlightSubtitle:
        "Não são títulos vencidos; são pedidos/NFs com previsão antiga ou pendente de atualização.",
      nextDateLabel: null,
    };
  }

  return {
    highlightKind: "EMPTY",
    highlightValue: 0,
    headlineLabel: "Sem data confiável",
    highlightSubtitle: "Sem data confiável de recebimento no filtro atual",
    nextDateLabel: null,
  };
}

/**
 * Monta as 6 respostas executivas a partir de rows/facts já filtrados.
 */
export function buildPortfolioReconciliationBusinessAnswers(args: {
  orderRows: readonly PortfolioReconciliationOrderRow[];
  facts: readonly PortfolioReconciliationFactApiRow[];
  summary: PortfolioReconciliationSummaryCards;
  runSummary?: PortfolioRunSummaryJsonLike | null;
  asOfDate?: Date | string;
}): PortfolioBusinessAnswers {
  const factsByOrder = groupFactsByOrder(args.facts);

  let jaVirouValue = 0;
  let jaVirouOrders = 0;
  let faturadoValue = 0;
  let faturadoOrders = 0;
  let pedidoValue = 0;
  let pedidoOrders = 0;
  let pedidoReviewValue = 0;
  let pedidoReviewOrders = 0;
  let valorPedidosComAlerta = 0;
  const reasonCounts = new Map<string, number>();

  for (const row of args.orderRows) {
    const key =
      row.salesOrderId ?? (row.pedido ? `code:${row.pedido}` : null);
    const facts =
      (key && factsByOrder.get(key)) ||
      (row.salesOrderId ? factsByOrder.get(row.salesOrderId) : undefined) ||
      [];
    const source =
      facts.length > 0
        ? classifyOrderSource(facts)
        : (row.forecastSource as PortfolioForecastSource);

    if (row.alertas.length > 0) {
      valorPedidosComAlerta += orderOfficialValue(row);
      for (const alert of row.alertas) {
        reasonCounts.set(alert, (reasonCounts.get(alert) ?? 0) + 1);
      }
    }

    if (source === "RECEIVABLE") {
      jaVirouValue += row.valorCR;
      jaVirouOrders += 1;
      continue;
    }

    if (source === "NFE" && isConfidentForSlice(row)) {
      faturadoValue += row.valorAlocado > 0 ? row.valorAlocado : row.saldo;
      faturadoOrders += 1;
      continue;
    }

    if (isOrderOnlyCarteira(row, source, facts)) {
      const orderValue = orderOfficialValue(row);
      if (isConfidentForSlice(row)) {
        pedidoValue += orderValue;
        pedidoOrders += 1;
      } else {
        pedidoReviewValue += orderValue;
        pedidoReviewOrders += 1;
      }
    }
  }

  const quantoReceber = round2(args.summary.saldoCarteira);
  const jaVirouOfficial =
    args.runSummary?.totalReceivableValue != null
      ? round2(args.runSummary.totalReceivableValue)
      : round2(args.summary.totalContasReceber);
  const jaVirouFinal =
    args.runSummary?.totalReceivableValue != null
      ? jaVirouOfficial
      : round2(jaVirouValue || args.summary.totalContasReceber);

  const timing = buildReceiptTimingBuckets({
    factsByOrder,
    asOfDate: args.asOfDate,
  });
  const quandoHighlight = buildQuandoHighlight(timing);

  const mainReasons = [...reasonCounts.entries()]
    .map(([reason, count]) => ({ reason, label: reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason, "pt-BR"))
    .slice(0, 8);

  const ordersComAlerta = args.summary.pedidosComAlerta;
  const alertsCount =
    args.runSummary?.alertCount != null &&
    args.orderRows.length === (args.runSummary.ordersAnalyzed ?? -1)
      ? args.runSummary.alertCount
      : args.summary.alertasEncontrados;

  const totalOrderOnlyValue = round2(pedidoValue + pedidoReviewValue);
  const totalOrderOnlyOrdersCount = pedidoOrders + pedidoReviewOrders;
  const soPedidoPrimary = totalOrderOnlyValue;
  const soPedidoSubtitle =
    totalOrderOnlyOrdersCount === 0
      ? "Nenhum pedido só em carteira no filtro atual."
      : `${pedidoValue.toLocaleString("pt-BR", {
          style: "currency",
          currency: "BRL",
        })} confiável · ${pedidoReviewValue.toLocaleString("pt-BR", {
          style: "currency",
          currency: "BRL",
        })} em revisão · ${totalOrderOnlyOrdersCount} pedido${
          totalOrderOnlyOrdersCount === 1 ? "" : "s"
        } sem NF/CR`;

  return {
    quantoTenhoParaReceber: {
      value: quantoReceber,
      label: "Tenho para receber",
      explanation: "Carteira projetada sem duplicar pedido, NF e CR.",
      validationHint:
        "Usa saldo projetado oficial (RECEIVABLE > NFE > ORDER). Não soma forecastValue bruto nem cabeçalho de NF.",
      question: "Quanto eu tenho para receber?",
      filterHint: {},
    },
    quandoVouReceber: {
      nextDate: timing.nextDate,
      nextDateLabel: quandoHighlight.nextDateLabel,
      nextDateValue: timing.nextDateValue,
      overdueValue: timing.openOverdueReceivablesValue,
      openOverdueReceivablesValue: timing.openOverdueReceivablesValue,
      outdatedForecastValue: timing.outdatedForecastValue,
      next7DaysValue: timing.next7DaysValue,
      next30DaysValue: timing.next30DaysValue,
      over30DaysValue: timing.over30DaysValue,
      withoutReliableDateValue: timing.withoutReliableDateValue,
      highlightKind: quandoHighlight.highlightKind,
      highlightValue: round2(quandoHighlight.highlightValue),
      headlineLabel: quandoHighlight.headlineLabel,
      highlightSubtitle: quandoHighlight.highlightSubtitle,
      buckets: timing.buckets,
      explanation:
        '"Títulos vencidos" são só Contas a Receber em aberto com vencimento passado. Datas projetadas antigas de pedido/NF aparecem como "Previsões para revisar", não como atraso do cliente.',
      question: "Quando vou receber?",
      filterHint: {},
    },
    jaVirouContasReceber: {
      value: jaVirouFinal,
      ordersCount: jaVirouOrders,
      label: "Já virou Contas a Receber",
      explanation:
        "Valores que já existem no financeiro como títulos de Contas a Receber.",
      question: "O que já virou CR?",
      filterHint: { forecastSource: "RECEIVABLE" },
    },
    faturadoSemContasReceber: {
      value: round2(faturadoValue),
      ordersCount: faturadoOrders,
      label: "Faturado, mas sem CR",
      explanation:
        "Já tem NF/documento de saída, mas ainda não encontramos título de Contas a Receber vinculado.",
      question: "O que já foi faturado mas ainda não virou CR?",
      filterHint: { forecastSource: "NFE" },
    },
    soPedidoCarteira: {
      value: round2(pedidoValue),
      ordersCount: pedidoOrders,
      reviewValue: round2(pedidoReviewValue),
      reviewOrdersCount: pedidoReviewOrders,
      totalOrderOnlyValue,
      totalOrderOnlyOrdersCount,
      label: "Só pedido em carteira",
      explanation:
        "Pedidos sem NF, documento de saída ou Contas a Receber. Baixa confiança ou alerta entram em revisão, não somem.",
      displayPrimaryValue: soPedidoPrimary,
      displaySubtitle: soPedidoSubtitle,
      question: "O que ainda é só pedido em carteira?",
      filterHint: { forecastSource: "ORDER" },
    },
    precisaRevisar: {
      ordersCount: ordersComAlerta,
      alertsCount,
      valueAtRisk: round2(valorPedidosComAlerta),
      valorPedidosComAlerta: round2(valorPedidosComAlerta),
      mainReasons,
      explanation:
        "Pedidos com divergência, baixa confiança ou dados incompletos. O valor usa o pedido oficial, não cabeçalho de NF.",
      question: "O que está errado ou incompleto?",
      filterHint: { onlyIssues: true },
    },
  };
}

export const PORTFOLIO_BUSINESS_ANSWERS_BANNER =
  'Esta tela mostra a carteira sem duplicar valores. Quando um pedido já virou Contas a Receber, usamos o CR. Quando ainda não virou CR, usamos a NF/documento de saída. Quando ainda não foi faturado, usamos o pedido. "Títulos vencidos" são somente CR em aberto com vencimento passado — previsões antigas de pedido/NF aparecem como "Previsões para revisar", não como atraso do cliente.';
