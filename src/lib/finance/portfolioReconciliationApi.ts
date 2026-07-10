/**
 * Camada pura read-only da API de Conciliação de Carteira.
 * Agrega fatos materializados — não recalcula alocação nem grava no banco.
 */

import type {
  PortfolioConfidenceLevel,
} from "./portfolioReconciliationAllocationEngine.js";
import {
  computeOrderProjectedOpenBalance,
  resolveOrderAggregatedForecast,
} from "./portfolioReconciliationProjectedBalance.js";

export const PORTFOLIO_RECONCILIATION_NO_RUN_MESSAGE =
  "Nenhuma conciliação materializada encontrada. Rode o rebuild manual.";

export const PORTFOLIO_RECONCILIATION_DEFAULT_PAGE_SIZE = 50;
export const PORTFOLIO_RECONCILIATION_MAX_PAGE_SIZE = 200;

const ISSUE_STATUSES = new Set([
  "ORDER_ONLY",
  "HEADER_ONLY_LINK",
  "PARTIALLY_ALLOCATED",
  "OVER_LINKED_BY_HEADER",
  "PRICE_MISMATCH",
  "QUANTITY_SURPLUS_IN_NFE",
  "DATA_QUALITY_ISSUE",
  "AMBIGUOUS_ALLOCATION",
]);

const DIVERGENCE_STATUSES = new Set([
  "PRICE_MISMATCH",
  "QUANTITY_SURPLUS_IN_NFE",
  "OVER_LINKED_BY_HEADER",
  "DATA_QUALITY_ISSUE",
  "AMBIGUOUS_ALLOCATION",
]);

const LOW_CONFIDENCE = new Set<PortfolioConfidenceLevel>(["LOW", "BLOCKED"]);

export type PortfolioReconciliationListFilters = {
  runId: string | null;
  customerExternalId: number | null;
  year: number | null;
  month: number | null;
  orderCode: string | null;
  status: string | null;
  confidenceLevel: string | null;
  forecastSource: string | null;
  onlyIssues: boolean;
  page: number;
  pageSize: number;
};

export type PortfolioReconciliationFactApiRow = {
  id: string;
  runId: string;
  customerId: string | null;
  customerExternalId: number | null;
  customerNameSnapshot: string | null;
  salesOrderId: string | null;
  externalSalesOrderId: number | null;
  orderCode: string | null;
  orderIssueDate: Date | string | null;
  expectedDeliveryDate: Date | string | null;
  salesOrderItemId: string | null;
  externalSalesOrderItemId: number | null;
  externalProductId: number | null;
  productSkuSnapshot: string | null;
  productNameSnapshot: string | null;
  orderQuantity: number | null;
  orderUnitPrice: number | null;
  orderItemValue: number | null;
  nomusNfeId: string | null;
  nfeExternalId: number | null;
  nfeNumber: string | null;
  nfeSerie: string | null;
  nfeKey: string | null;
  nfeProcessedAt: Date | string | null;
  nfeHeaderValue: number | null;
  stockDocumentId: string | null;
  stockDocumentExternalId: number | null;
  stockDocumentItemId: string | null;
  stockDocumentItemExternalId: number | null;
  stockDocumentDate: Date | string | null;
  stockQuantity: number | null;
  stockUnitValue: number | null;
  stockItemValue: number | null;
  allocatedQuantity: number | null;
  allocatedValueByOrderPrice: number | null;
  allocatedValueByStockPrice: number | null;
  remainingOrderQuantityAfterAllocation: number | null;
  remainingOrderValueAfterAllocation: number | null;
  priceDifferenceUnit: number | null;
  priceDifferenceTotal: number | null;
  receivableIdsJson: unknown;
  receivableTotalValue: number | null;
  receivedValue: number | null;
  openReceivableValue: number | null;
  dueDatesJson: unknown;
  settlementDatesJson: unknown;
  forecastSource: string;
  forecastDate: Date | string | null;
  forecastValue: number | null;
  confidenceLevel: string;
  status: string | null;
  alertsJson: unknown;
  traceJson: unknown;
};

export type PortfolioReconciliationRunMeta = {
  id: string;
  status: string;
  mode: string;
  startedAt: Date | string | null;
  finishedAt: Date | string | null;
  fromDate: Date | string | null;
  toDate: Date | string | null;
  customerExternalId: number | null;
  filtersJson: unknown;
  summaryJson: unknown;
  errorMessage: string | null;
  createdAt: Date | string;
};

export type PortfolioReconciliationOrderRow = {
  salesOrderId: string | null;
  pedido: string | null;
  cliente: string | null;
  customerExternalId: number | null;
  valorPedido: number;
  valorAlocado: number;
  valorAlocadoPorDocumento: number;
  valorCR: number;
  recebido: number;
  saldo: number;
  /** Data principal (mais cedo) do forecast agregado — mesma prioridade do saldo. */
  forecastDate: string | null;
  forecastSource: string;
  /** Datas únicas de vencimento/forecast que entram no saldo projetado. */
  forecastDates: string[];
  /** Rótulo curto (ex.: "10/07/2026 + 1 vencimento"). */
  forecastLabel: string;
  forecastDueCount: number;
  confidenceLevel: string;
  status: string;
  alertas: string[];
  hasIssues: boolean;
  nfsHeaderOnly: boolean;
};

export type PortfolioReconciliationSummaryCards = {
  /** Quantidade de pedidos no filtro (para subtexto). */
  totalPedidos: number;
  /** Soma monetária de valorPedido no filtro (= totalOrderValue oficial). */
  totalValorPedidos: number;
  /** Alocado ao pedido (preço pedido × qtde) — summaryJson.totalAllocatedValue. */
  totalAlocadoPorPrecoPedido: number;
  /** Secundário: alocado a preço de documento de estoque. */
  totalAlocadoPorPrecoDocumento: number;
  /** CR rateado/vinculado ao pedido — summaryJson.totalReceivableValue. */
  totalContasReceber: number;
  /** Recebido rateado ao pedido (sem duplicar rollup + item). */
  totalRecebido: number;
  /** Saldo projetado oficial (projectedOpenBalance). */
  saldoCarteira: number;
  /** Valor de pedidos com divergência (deduplicado por pedido). */
  valorComDivergencia: number;
  /** Valor de pedidos com confiança LOW/BLOCKED (deduplicado por pedido). */
  valorSemConfianca: number;
  /** Pedidos com pelo menos um alerta. */
  pedidosComAlerta: number;
  /** Soma de alertas nas facts do filtro (≠ pedidosComAlerta). */
  alertasEncontrados: number;
  /** Quantidade de facts com status divergente no filtro. */
  divergenciasEncontradas: number;
  nfsHeaderOnly: number;
};

export type PortfolioReconciliationAvailableFilters = {
  statuses: string[];
  confidenceLevels: string[];
  forecastSources: string[];
  customers: Array<{ customerExternalId: number; customerName: string | null }>;
  years: number[];
  months: number[];
};

export class PortfolioReconciliationApiParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortfolioReconciliationApiParseError";
  }
}

function asQueryString(value: unknown): string | null {
  if (value == null) return null;
  if (Array.isArray(value)) return asQueryString(value[0]);
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function asPositiveInt(value: unknown, label: string): number | null {
  const text = asQueryString(value);
  if (text == null) return null;
  const n = Number.parseInt(text, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new PortfolioReconciliationApiParseError(`${label} inválido.`);
  }
  return n;
}

function asNonNegativeInt(value: unknown, label: string, fallback: number): number {
  const text = asQueryString(value);
  if (text == null) return fallback;
  const n = Number.parseInt(text, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new PortfolioReconciliationApiParseError(`${label} inválido.`);
  }
  return n;
}

function asBool(value: unknown): boolean {
  const text = asQueryString(value);
  if (text == null) return false;
  return text === "1" || text.toLowerCase() === "true" || text.toLowerCase() === "yes";
}

function toNumber(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return value;
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toIsoDate(value: Date | string | null | undefined): string | null {
  const d = toDate(value);
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseAlertsJson(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : String(item)))
      .filter((item) => item.length > 0);
  }
  if (typeof value === "string") {
    try {
      return parseAlertsJson(JSON.parse(value));
    } catch {
      return value.trim() ? [value.trim()] : [];
    }
  }
  return [];
}

export function parseIdListJson(value: unknown): number[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "number" ? item : Number.parseInt(String(item), 10)))
      .filter((n) => Number.isFinite(n));
  }
  return [];
}

export function parsePortfolioReconciliationListFilters(
  query: Record<string, unknown>
): PortfolioReconciliationListFilters {
  const page = Math.max(1, asNonNegativeInt(query.page, "page", 1) || 1);
  let pageSize = asNonNegativeInt(
    query.pageSize,
    "pageSize",
    PORTFOLIO_RECONCILIATION_DEFAULT_PAGE_SIZE
  );
  if (pageSize < 1) pageSize = PORTFOLIO_RECONCILIATION_DEFAULT_PAGE_SIZE;
  if (pageSize > PORTFOLIO_RECONCILIATION_MAX_PAGE_SIZE) {
    pageSize = PORTFOLIO_RECONCILIATION_MAX_PAGE_SIZE;
  }

  const month = asPositiveInt(query.month, "month");
  if (month != null && month > 12) {
    throw new PortfolioReconciliationApiParseError("month inválido.");
  }

  return {
    runId: asQueryString(query.runId),
    customerExternalId: asPositiveInt(query.customerExternalId, "customerExternalId"),
    year: asPositiveInt(query.year, "year"),
    month,
    orderCode: asQueryString(query.orderCode),
    status: asQueryString(query.status),
    confidenceLevel: asQueryString(query.confidenceLevel)?.toUpperCase() ?? null,
    forecastSource: asQueryString(query.forecastSource)?.toUpperCase() ?? null,
    onlyIssues: asBool(query.onlyIssues),
    page,
    pageSize,
  };
}

export function factMatchesListFilters(
  fact: PortfolioReconciliationFactApiRow,
  filters: PortfolioReconciliationListFilters
): boolean {
  if (
    filters.customerExternalId != null &&
    fact.customerExternalId !== filters.customerExternalId
  ) {
    return false;
  }
  if (filters.orderCode != null) {
    const code = (fact.orderCode ?? "").toLowerCase();
    if (!code.includes(filters.orderCode.toLowerCase())) return false;
  }
  if (filters.status != null && (fact.status ?? "") !== filters.status) return false;
  if (
    filters.confidenceLevel != null &&
    fact.confidenceLevel.toUpperCase() !== filters.confidenceLevel
  ) {
    return false;
  }
  if (
    filters.forecastSource != null &&
    fact.forecastSource.toUpperCase() !== filters.forecastSource
  ) {
    return false;
  }

  if (filters.year != null || filters.month != null) {
    const date = toDate(fact.orderIssueDate) ?? toDate(fact.forecastDate);
    if (!date) return false;
    if (filters.year != null && date.getFullYear() !== filters.year) return false;
    if (filters.month != null && date.getMonth() + 1 !== filters.month) return false;
  }

  return true;
}

function confidenceRank(level: string): number {
  switch (level.toUpperCase()) {
    case "BLOCKED":
      return 0;
    case "LOW":
      return 1;
    case "MEDIUM":
      return 2;
    case "HIGH":
      return 3;
    default:
      return -1;
  }
}

function pickWorseConfidence(a: string, b: string): string {
  return confidenceRank(a) <= confidenceRank(b) ? a : b;
}

function statusPriority(status: string): number {
  if (DIVERGENCE_STATUSES.has(status)) return 0;
  if (ISSUE_STATUSES.has(status)) return 1;
  if (status === "PARTIALLY_ALLOCATED") return 2;
  if (status === "ITEM_ALLOCATED" || status === "FULLY_ALLOCATED") return 4;
  return 3;
}

function pickDominantStatus(current: string | null, next: string | null): string {
  const a = current ?? "ORDER_ONLY";
  const b = next ?? "ORDER_ONLY";
  return statusPriority(a) <= statusPriority(b) ? a : b;
}

function readTraceOrderTotal(traceJson: unknown): number | null {
  if (!traceJson || typeof traceJson !== "object" || Array.isArray(traceJson)) return null;
  const raw = (traceJson as Record<string, unknown>).orderTotal;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  return null;
}

/**
 * CR / recebido rateados ao pedido: só linhas com alocação itemizada (qty > 0).
 * Não usa CR bruto de NF (HEADER_ONLY / DATA_QUALITY) nem linha sintética FULLY_ALLOCATED.
 */
export function computeOrderRateadoReceivableTotals(
  facts: readonly PortfolioReconciliationFactApiRow[]
): { receivable: number; received: number } {
  let receivable = 0;
  let received = 0;
  for (const fact of facts) {
    if ((fact.allocatedQuantity ?? 0) <= 0) continue;
    if (fact.receivableTotalValue == null && fact.receivedValue == null) continue;
    receivable += toNumber(fact.receivableTotalValue);
    received += toNumber(fact.receivedValue);
  }
  return { receivable: round2(receivable), received: round2(received) };
}

export function resolveOrderValorPedido(args: {
  facts: readonly PortfolioReconciliationFactApiRow[];
  itemValuesSum: number;
  salesOrderId: string | null;
  orderTotalBySalesOrderId?: ReadonlyMap<string, number> | null;
}): number {
  if (args.salesOrderId && args.orderTotalBySalesOrderId?.has(args.salesOrderId)) {
    return round2(args.orderTotalBySalesOrderId.get(args.salesOrderId) ?? 0);
  }

  let fromTrace = 0;
  for (const fact of args.facts) {
    const traced = readTraceOrderTotal(fact.traceJson);
    if (traced != null) fromTrace = Math.max(fromTrace, traced);
  }

  const fromItems = args.itemValuesSum;
  if (fromTrace > 0 && fromItems > 0) return round2(Math.max(fromTrace, fromItems));
  if (fromTrace > 0) return round2(fromTrace);
  return round2(fromItems);
}

/**
 * Filtros que restringem o universo além da run/cliente — impedem usar summaryJson da run.
 */
export function hasRestrictivePortfolioListFilters(
  filters: PortfolioReconciliationListFilters
): boolean {
  return (
    filters.year != null ||
    filters.month != null ||
    filters.orderCode != null ||
    filters.status != null ||
    filters.confidenceLevel != null ||
    filters.forecastSource != null ||
    filters.onlyIssues
  );
}

export type PortfolioRunSummaryJsonLike = {
  ordersAnalyzed?: number;
  alertCount?: number;
  divergenceCount?: number;
  totalOrderValue?: number;
  totalAllocatedValue?: number;
  totalReceivableValue?: number;
  projectedOpenBalance?: number;
};

export function parsePortfolioRunSummaryJson(value: unknown): PortfolioRunSummaryJsonLike | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  const num = (k: string): number | undefined => {
    const v = o[k];
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  };
  return {
    ordersAnalyzed: num("ordersAnalyzed"),
    alertCount: num("alertCount"),
    divergenceCount: num("divergenceCount"),
    totalOrderValue: num("totalOrderValue"),
    totalAllocatedValue: num("totalAllocatedValue"),
    totalReceivableValue: num("totalReceivableValue"),
    projectedOpenBalance: num("projectedOpenBalance"),
  };
}

/**
 * Quando o filtro cobre a run inteira (sem restrições), alinha cards ao summaryJson oficial.
 */
export function applyRunSummaryJsonToCards(
  cards: PortfolioReconciliationSummaryCards,
  runSummary: PortfolioRunSummaryJsonLike | null,
  opts: { orderRowCount: number }
): PortfolioReconciliationSummaryCards {
  if (!runSummary) return cards;
  if (
    runSummary.ordersAnalyzed != null &&
    runSummary.ordersAnalyzed !== opts.orderRowCount
  ) {
    return cards;
  }

  return {
    ...cards,
    totalValorPedidos:
      runSummary.totalOrderValue != null
        ? round2(runSummary.totalOrderValue)
        : cards.totalValorPedidos,
    totalAlocadoPorPrecoPedido:
      runSummary.totalAllocatedValue != null
        ? round2(runSummary.totalAllocatedValue)
        : cards.totalAlocadoPorPrecoPedido,
    totalContasReceber:
      runSummary.totalReceivableValue != null
        ? round2(runSummary.totalReceivableValue)
        : cards.totalContasReceber,
    saldoCarteira:
      runSummary.projectedOpenBalance != null
        ? round2(runSummary.projectedOpenBalance)
        : cards.saldoCarteira,
    alertasEncontrados:
      runSummary.alertCount != null ? runSummary.alertCount : cards.alertasEncontrados,
    divergenciasEncontradas:
      runSummary.divergenceCount != null
        ? runSummary.divergenceCount
        : cards.divergenciasEncontradas,
  };
}

export function aggregateFactsToOrderRows(
  facts: readonly PortfolioReconciliationFactApiRow[],
  options?: {
    orderTotalBySalesOrderId?: ReadonlyMap<string, number> | null;
  }
): PortfolioReconciliationOrderRow[] {
  type Acc = {
    salesOrderId: string | null;
    pedido: string | null;
    cliente: string | null;
    customerExternalId: number | null;
    itemValues: Map<string, number>;
    valorAlocado: number;
    valorAlocadoPorDocumento: number;
    confidenceLevel: string;
    status: string;
    alertas: Set<string>;
    nfsHeaderOnly: boolean;
    facts: PortfolioReconciliationFactApiRow[];
  };

  const byOrder = new Map<string, Acc>();
  const orderTotals = options?.orderTotalBySalesOrderId ?? null;

  for (const fact of facts) {
    const key =
      fact.salesOrderId ??
      (fact.externalSalesOrderId != null
        ? `ext:${fact.externalSalesOrderId}`
        : fact.orderCode
          ? `code:${fact.orderCode}`
          : fact.id);

    let acc = byOrder.get(key);
    if (!acc) {
      acc = {
        salesOrderId: fact.salesOrderId,
        pedido: fact.orderCode,
        cliente: fact.customerNameSnapshot,
        customerExternalId: fact.customerExternalId,
        itemValues: new Map(),
        valorAlocado: 0,
        valorAlocadoPorDocumento: 0,
        confidenceLevel: fact.confidenceLevel,
        status: fact.status ?? "ORDER_ONLY",
        alertas: new Set(),
        nfsHeaderOnly: false,
        facts: [],
      };
      byOrder.set(key, acc);
    }

    acc.facts.push(fact);

    if (!acc.pedido && fact.orderCode) acc.pedido = fact.orderCode;
    if (!acc.cliente && fact.customerNameSnapshot) acc.cliente = fact.customerNameSnapshot;
    if (acc.customerExternalId == null && fact.customerExternalId != null) {
      acc.customerExternalId = fact.customerExternalId;
    }
    if (!acc.salesOrderId && fact.salesOrderId) acc.salesOrderId = fact.salesOrderId;

    const itemKey =
      fact.salesOrderItemId ??
      (fact.externalSalesOrderItemId != null
        ? `ext-item:${fact.externalSalesOrderItemId}`
        : fact.externalProductId != null
          ? `prod:${fact.externalProductId}:${fact.orderItemValue ?? 0}`
          : null);
    if (itemKey != null && fact.orderItemValue != null) {
      if (!acc.itemValues.has(itemKey)) {
        acc.itemValues.set(itemKey, toNumber(fact.orderItemValue));
      }
    }

    // Só linhas itemizadas com quantidade alocada — evita rollup FULLY_ALLOCATED.
    if ((fact.allocatedQuantity ?? 0) > 0) {
      acc.valorAlocado += toNumber(fact.allocatedValueByOrderPrice);
      acc.valorAlocadoPorDocumento += toNumber(fact.allocatedValueByStockPrice);
    }

    acc.confidenceLevel = pickWorseConfidence(acc.confidenceLevel, fact.confidenceLevel);
    acc.status = pickDominantStatus(acc.status, fact.status);
    for (const alert of parseAlertsJson(fact.alertsJson)) acc.alertas.add(alert);
    if (fact.status === "HEADER_ONLY_LINK") acc.nfsHeaderOnly = true;
  }

  const rows: PortfolioReconciliationOrderRow[] = [];
  for (const acc of byOrder.values()) {
    let itemValuesSum = 0;
    for (const v of acc.itemValues.values()) itemValuesSum += v;

    const valorPedido = resolveOrderValorPedido({
      facts: acc.facts,
      itemValuesSum,
      salesOrderId: acc.salesOrderId,
      orderTotalBySalesOrderId: orderTotals,
    });

    const { receivable: valorCR, received: recebido } = computeOrderRateadoReceivableTotals(
      acc.facts
    );

    const saldo = computeOrderProjectedOpenBalance(acc.facts);
    const forecast = resolveOrderAggregatedForecast(acc.facts);

    const alertas = [...acc.alertas];
    const hasIssues =
      ISSUE_STATUSES.has(acc.status) ||
      alertas.length > 0 ||
      LOW_CONFIDENCE.has(acc.confidenceLevel as PortfolioConfidenceLevel);

    rows.push({
      salesOrderId: acc.salesOrderId,
      pedido: acc.pedido,
      cliente: acc.cliente,
      customerExternalId: acc.customerExternalId,
      valorPedido: round2(valorPedido),
      valorAlocado: round2(acc.valorAlocado),
      valorAlocadoPorDocumento: round2(acc.valorAlocadoPorDocumento),
      valorCR: round2(valorCR),
      recebido: round2(recebido),
      saldo: round2(saldo),
      forecastDate: forecast.primaryDate,
      forecastSource: forecast.source,
      forecastDates: forecast.dates,
      forecastLabel: forecast.label,
      forecastDueCount: forecast.dueCount,
      confidenceLevel: acc.confidenceLevel,
      status: acc.status,
      alertas,
      hasIssues,
      nfsHeaderOnly: acc.nfsHeaderOnly,
    });
  }

  rows.sort((a, b) => {
    const ca = (a.pedido ?? "").localeCompare(b.pedido ?? "", "pt-BR");
    if (ca !== 0) return ca;
    return (a.salesOrderId ?? "").localeCompare(b.salesOrderId ?? "");
  });

  return rows;
}

export function filterOrderRows(
  rows: readonly PortfolioReconciliationOrderRow[],
  filters: PortfolioReconciliationListFilters
): PortfolioReconciliationOrderRow[] {
  return rows.filter((row) => {
    if (filters.onlyIssues && !row.hasIssues) return false;
    if (filters.status != null && row.status !== filters.status) return false;
    if (
      filters.confidenceLevel != null &&
      row.confidenceLevel.toUpperCase() !== filters.confidenceLevel
    ) {
      return false;
    }
    if (
      filters.forecastSource != null &&
      row.forecastSource.toUpperCase() !== filters.forecastSource
    ) {
      return false;
    }
    if (filters.orderCode != null) {
      const code = (row.pedido ?? "").toLowerCase();
      if (!code.includes(filters.orderCode.toLowerCase())) return false;
    }
    if (
      filters.customerExternalId != null &&
      row.customerExternalId !== filters.customerExternalId
    ) {
      return false;
    }
    return true;
  });
}

export function buildPortfolioReconciliationSummaryCards(
  rows: readonly PortfolioReconciliationOrderRow[],
  options?: {
    facts?: readonly PortfolioReconciliationFactApiRow[];
  }
): PortfolioReconciliationSummaryCards {
  let totalValorPedidos = 0;
  let totalAlocadoPorPrecoPedido = 0;
  let totalAlocadoPorPrecoDocumento = 0;
  let totalContasReceber = 0;
  let totalRecebido = 0;
  let saldoCarteira = 0;
  let valorComDivergencia = 0;
  let valorSemConfianca = 0;
  let pedidosComAlerta = 0;
  let nfsHeaderOnly = 0;

  for (const row of rows) {
    totalValorPedidos += row.valorPedido;
    totalAlocadoPorPrecoPedido += row.valorAlocado;
    totalAlocadoPorPrecoDocumento += row.valorAlocadoPorDocumento;
    totalContasReceber += row.valorCR;
    totalRecebido += row.recebido;
    saldoCarteira += row.saldo;
    if (DIVERGENCE_STATUSES.has(row.status) || row.alertas.some((a) => /diverg|mismatch|preço/i.test(a))) {
      valorComDivergencia += Math.max(row.valorPedido, row.valorAlocado);
    }
    if (LOW_CONFIDENCE.has(row.confidenceLevel as PortfolioConfidenceLevel)) {
      valorSemConfianca += Math.max(row.valorPedido, row.valorAlocado);
    }
    if (row.alertas.length > 0) pedidosComAlerta += 1;
    if (row.nfsHeaderOnly) nfsHeaderOnly += 1;
  }

  let alertasEncontrados = 0;
  let divergenciasEncontradas = 0;
  if (options?.facts) {
    for (const fact of options.facts) {
      alertasEncontrados += parseAlertsJson(fact.alertsJson).length;
      if (fact.status && DIVERGENCE_STATUSES.has(fact.status)) {
        divergenciasEncontradas += 1;
      }
    }
  }

  return {
    totalPedidos: rows.length,
    totalValorPedidos: round2(totalValorPedidos),
    totalAlocadoPorPrecoPedido: round2(totalAlocadoPorPrecoPedido),
    totalAlocadoPorPrecoDocumento: round2(totalAlocadoPorPrecoDocumento),
    totalContasReceber: round2(totalContasReceber),
    totalRecebido: round2(totalRecebido),
    saldoCarteira: round2(saldoCarteira),
    valorComDivergencia: round2(valorComDivergencia),
    valorSemConfianca: round2(valorSemConfianca),
    pedidosComAlerta,
    alertasEncontrados,
    divergenciasEncontradas,
    nfsHeaderOnly,
  };
}

export function paginateRows<T>(
  rows: readonly T[],
  page: number,
  pageSize: number
): { rows: T[]; page: number; pageSize: number; totalRows: number; totalPages: number } {
  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize) || 1);
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    page: safePage,
    pageSize,
    totalRows,
    totalPages,
  };
}

export function buildAvailableFilters(
  facts: readonly PortfolioReconciliationFactApiRow[],
  orderRows: readonly PortfolioReconciliationOrderRow[]
): PortfolioReconciliationAvailableFilters {
  const statuses = new Set<string>();
  const confidenceLevels = new Set<string>();
  const forecastSources = new Set<string>();
  const customers = new Map<number, string | null>();
  const years = new Set<number>();
  const months = new Set<number>();

  for (const fact of facts) {
    if (fact.status) statuses.add(fact.status);
    if (fact.confidenceLevel) confidenceLevels.add(fact.confidenceLevel);
    if (fact.forecastSource) forecastSources.add(fact.forecastSource);
    if (fact.customerExternalId != null) {
      customers.set(fact.customerExternalId, fact.customerNameSnapshot);
    }
    const date = toDate(fact.orderIssueDate) ?? toDate(fact.forecastDate);
    if (date) {
      years.add(date.getFullYear());
      months.add(date.getMonth() + 1);
    }
  }

  for (const row of orderRows) {
    statuses.add(row.status);
    confidenceLevels.add(row.confidenceLevel);
    forecastSources.add(row.forecastSource);
  }

  return {
    statuses: [...statuses].sort(),
    confidenceLevels: [...confidenceLevels].sort(),
    forecastSources: [...forecastSources].sort(),
    customers: [...customers.entries()]
      .map(([customerExternalId, customerName]) => ({ customerExternalId, customerName }))
      .sort((a, b) => a.customerExternalId - b.customerExternalId),
    years: [...years].sort((a, b) => b - a),
    months: [...months].sort((a, b) => a - b),
  };
}

export function serializeRunMeta(run: PortfolioReconciliationRunMeta) {
  return {
    id: run.id,
    status: run.status,
    mode: run.mode,
    startedAt: run.startedAt ? new Date(run.startedAt).toISOString() : null,
    finishedAt: run.finishedAt ? new Date(run.finishedAt).toISOString() : null,
    fromDate: toIsoDate(run.fromDate),
    toDate: toIsoDate(run.toDate),
    customerExternalId: run.customerExternalId,
    filters: run.filtersJson ?? null,
    summary: run.summaryJson ?? null,
    errorMessage: run.errorMessage,
    createdAt: new Date(run.createdAt).toISOString(),
  };
}

/** Trace técnico controlado — remove payloads brutos grandes. */
export function sanitizeTraceJson(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  let obj: unknown = value;
  if (typeof value === "string") {
    try {
      obj = JSON.parse(value);
    } catch {
      return { note: "trace não parseável", preview: value.slice(0, 200) };
    }
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    return { value: obj as unknown };
  }

  const BLOCKED_KEYS = new Set([
    "raw",
    "rawPayload",
    "payload",
    "response",
    "requestBody",
    "xml",
    "html",
  ]);

  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(obj as Record<string, unknown>)) {
    if (BLOCKED_KEYS.has(key)) {
      out[key] = "[omitido]";
      continue;
    }
    if (typeof raw === "string" && raw.length > 500) {
      out[key] = `${raw.slice(0, 500)}…`;
      continue;
    }
    if (Array.isArray(raw) && raw.length > 50) {
      out[key] = { truncated: true, length: raw.length, sample: raw.slice(0, 10) };
      continue;
    }
    out[key] = raw;
  }
  return out;
}

export function buildOrderTimeline(
  facts: readonly PortfolioReconciliationFactApiRow[]
): Array<{ at: string; kind: string; label: string }> {
  const events: Array<{ at: string; kind: string; label: string; sort: number }> = [];

  const first = facts[0];
  if (first) {
    const orderAt = toIsoDate(first.orderIssueDate);
    if (orderAt) {
      events.push({
        at: orderAt,
        kind: "ORDER",
        label: `Pedido ${first.orderCode ?? first.salesOrderId ?? ""}`.trim(),
        sort: 1,
      });
    }
    const deliveryAt = toIsoDate(first.expectedDeliveryDate);
    if (deliveryAt) {
      events.push({
        at: deliveryAt,
        kind: "ORDER_DELIVERY",
        label: "Entrega prevista",
        sort: 2,
      });
    }
  }

  const seenNfe = new Set<string>();
  const seenStock = new Set<string>();
  const seenDue = new Set<string>();
  const seenSettle = new Set<string>();

  for (const fact of facts) {
    if (fact.nfeExternalId != null) {
      const key = String(fact.nfeExternalId);
      if (!seenNfe.has(key)) {
        seenNfe.add(key);
        const at = toIsoDate(fact.nfeProcessedAt) ?? toIsoDate(fact.stockDocumentDate);
        if (at) {
          events.push({
            at,
            kind: "NFE",
            label: `NF emitida ${fact.nfeNumber ?? fact.nfeExternalId}`,
            sort: 3,
          });
        }
      }
    }
    if (fact.stockDocumentExternalId != null) {
      const key = String(fact.stockDocumentExternalId);
      if (!seenStock.has(key)) {
        seenStock.add(key);
        const at = toIsoDate(fact.stockDocumentDate);
        if (at) {
          events.push({
            at,
            kind: "STOCK_DOCUMENT",
            label: `Documento de estoque ${fact.stockDocumentExternalId}`,
            sort: 4,
          });
        }
      }
    }
    if (Array.isArray(fact.dueDatesJson)) {
      for (const due of fact.dueDatesJson) {
        const at =
          typeof due === "string"
            ? due.slice(0, 10)
            : due
              ? toIsoDate(due as string)
              : null;
        if (at && !seenDue.has(at)) {
          seenDue.add(at);
          events.push({ at, kind: "RECEIVABLE_DUE", label: `Vencimento CR ${at}`, sort: 5 });
        }
      }
    }
    if (Array.isArray(fact.settlementDatesJson)) {
      for (const settle of fact.settlementDatesJson) {
        const at =
          typeof settle === "string"
            ? settle.slice(0, 10)
            : settle
              ? toIsoDate(settle as string)
              : null;
        if (at && !seenSettle.has(at)) {
          seenSettle.add(at);
          events.push({ at, kind: "RECEIVABLE_SETTLED", label: `Recebimento ${at}`, sort: 6 });
        }
      }
    }
  }

  const seen = new Set<string>();
  const deduped = events.filter((e) => {
    const key = `${e.kind}:${e.at}:${e.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  deduped.sort((a, b) => {
    const c = a.at.localeCompare(b.at);
    if (c !== 0) return c;
    return a.sort - b.sort;
  });

  return deduped.map(({ at, kind, label }) => ({ at, kind, label }));
}

export { buildPortfolioOrderTraceViewModel as buildOrderDetailFromFacts } from "./portfolioReconciliationOrderTrace.js";

export function buildListPayload(args: {
  run: PortfolioReconciliationRunMeta;
  facts: readonly PortfolioReconciliationFactApiRow[];
  filters: PortfolioReconciliationListFilters;
  orderTotalBySalesOrderId?: ReadonlyMap<string, number> | null;
}) {
  const filteredFacts = args.facts.filter((f) => factMatchesListFilters(f, args.filters));
  const allOrderRows = aggregateFactsToOrderRows(filteredFacts, {
    orderTotalBySalesOrderId: args.orderTotalBySalesOrderId,
  });
  const orderRows = filterOrderRows(allOrderRows, args.filters);

  // Facts que entram nos cards: mesmo universo dos pedidos filtrados (por salesOrderId).
  const orderIds = new Set(
    orderRows.map((r) => r.salesOrderId).filter((id): id is string => id != null)
  );
  const orderCodes = new Set(
    orderRows.filter((r) => r.salesOrderId == null && r.pedido).map((r) => r.pedido as string)
  );
  const summaryFacts = filteredFacts.filter((f) => {
    if (f.salesOrderId && orderIds.has(f.salesOrderId)) return true;
    if (!f.salesOrderId && f.orderCode && orderCodes.has(f.orderCode)) return true;
    if (orderIds.size === 0 && orderCodes.size === 0) return true;
    return f.salesOrderId != null && orderIds.has(f.salesOrderId);
  });

  let summary = buildPortfolioReconciliationSummaryCards(orderRows, {
    facts: summaryFacts,
  });

  if (!hasRestrictivePortfolioListFilters(args.filters)) {
    summary = applyRunSummaryJsonToCards(
      summary,
      parsePortfolioRunSummaryJson(args.run.summaryJson),
      { orderRowCount: orderRows.length }
    );
  }

  const page = paginateRows(orderRows, args.filters.page, args.filters.pageSize);
  const availableFilters = buildAvailableFilters(args.facts, allOrderRows);

  return {
    ok: true as const,
    message: null as string | null,
    run: serializeRunMeta(args.run),
    summary,
    rows: page.rows,
    pagination: {
      page: page.page,
      pageSize: page.pageSize,
      totalRows: page.totalRows,
      totalPages: page.totalPages,
    },
    filters: args.filters,
    availableFilters,
  };
}

export function buildNoRunPayload() {
  return {
    ok: false as const,
    message: PORTFOLIO_RECONCILIATION_NO_RUN_MESSAGE,
    run: null,
    summary: null,
    rows: [] as PortfolioReconciliationOrderRow[],
    pagination: {
      page: 1,
      pageSize: PORTFOLIO_RECONCILIATION_DEFAULT_PAGE_SIZE,
      totalRows: 0,
      totalPages: 0,
    },
    filters: null,
    availableFilters: {
      statuses: [] as string[],
      confidenceLevels: [] as string[],
      forecastSources: [] as string[],
      customers: [] as Array<{ customerExternalId: number; customerName: string | null }>,
      years: [] as number[],
      months: [] as number[],
    },
  };
}

export type { PortfolioConfidenceLevel, PortfolioForecastSource };
