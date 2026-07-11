/**
 * Analytics de maturidade da carteira (camada paralela / read-only).
 *
 * Agrega PortfolioReconciliationFact por pedido, aplica classifyPortfolioOrder
 * e calcula cards/KPIs sem duplicar valor entre status principais.
 *
 * Não altera Fluxo de Caixa, CR oficial, Comissões nem Relatório Presidencial.
 *
 * @see docs/finance/portfolio-intelligence-requirements.md
 */

import {
  computeOrderRateadoReceivableTotals,
  parseAlertsJson,
  resolveOrderValorPedido,
  type PortfolioReconciliationFactApiRow,
} from "./portfolioReconciliationApi.js";
import { sumUniqueNfeHeaderValue } from "./portfolioReconciliationComparison.js";
import {
  resolveOrderAggregatedForecast,
} from "./portfolioReconciliationProjectedBalance.js";
import {
  classifyPortfolioOrder,
  getMetricExplanation,
  PORTFOLIO_INFO_UNAVAILABLE,
  type PortfolioConfidenceLabel,
  type PortfolioMaturityAlertTag,
  type PortfolioMaturityStatus,
  type PortfolioMetricExplanation,
} from "./portfolioMaturityClassification.js";

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
    if (!trimmed) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
    const d = new Date(trimmed);
    if (Number.isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  if (Number.isNaN(value.getTime())) return null;
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function startOfDayIso(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((parseIso(toIso).getTime() - parseIso(fromIso).getTime()) / 86_400_000);
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

function pickWorseConfidence(a: string, b: string): string {
  const rank: Record<string, number> = { HIGH: 1, MEDIUM: 2, LOW: 3, BLOCKED: 4 };
  const ra = rank[a.toUpperCase()] ?? 2;
  const rb = rank[b.toUpperCase()] ?? 2;
  return ra >= rb ? a.toUpperCase() : b.toUpperCase();
}

const STATUS_PRIORITY: Record<string, number> = {
  RECEIVED: 100,
  RECEIVABLE_CONFIRMED: 90,
  FULLY_ALLOCATED: 80,
  ITEM_ALLOCATED: 70,
  STOCK_DOCUMENT_ITEMIZED: 60,
  PARTIALLY_ALLOCATED: 50,
  ORDER_ONLY: 40,
  HEADER_ONLY_LINK: 30,
  PRICE_MISMATCH: 25,
  QUANTITY_SURPLUS_IN_NFE: 20,
  OVER_LINKED_BY_HEADER: 15,
  DATA_QUALITY_ISSUE: 10,
  AMBIGUOUS_ALLOCATION: 5,
};

function pickDominantStatus(current: string | null, next: string | null): string {
  const c = current ?? "ORDER_ONLY";
  const n = next ?? c;
  return (STATUS_PRIORITY[n] ?? 0) >= (STATUS_PRIORITY[c] ?? 0) ? n : c;
}

function earliestIso(dates: Array<string | null | undefined>): string | null {
  const sorted = dates.filter((d): d is string => Boolean(d)).sort();
  return sorted[0] ?? null;
}

function latestIso(dates: Array<string | null | undefined>): string | null {
  const sorted = dates.filter((d): d is string => Boolean(d)).sort();
  return sorted.length ? sorted[sorted.length - 1]! : null;
}

export type PortfolioMaturityDateAxis =
  | "ORDER_ISSUE_DATE"
  | "EXPECTED_DELIVERY_DATE"
  | "NFE_DATE"
  | "STOCK_DOCUMENT_DATE"
  | "RECEIVABLE_DUE_DATE"
  | "RECEIVABLE_SETTLEMENT_DATE"
  | "FORECAST_DATE"
  | "UPDATED_AT";

export type PortfolioMaturityAnalyticsFilters = {
  customerExternalId?: number | null;
  customerId?: string | null;
  sellerExternalId?: number | null;
  sellerId?: string | null;
  sellerName?: string | null;
  companyId?: string | null;
  orderCode?: string | null;
  productExternalId?: number | null;
  statusPrincipal?: PortfolioMaturityStatus | null;
  confidenceLabel?: PortfolioConfidenceLabel | null;
  tagsAlerta?: readonly PortfolioMaturityAlertTag[] | null;
  minValue?: number | null;
  maxValue?: number | null;
  dateAxis?: PortfolioMaturityDateAxis | null;
  from?: string | null;
  to?: string | null;
  runId?: string | null;
  page?: number;
  pageSize?: number;
  asOfDate?: string | null;
  sortBy?: PortfolioMaturitySortBy | null;
  sortDirection?: "asc" | "desc" | null;
  /** Filtros de evidência (não alteram classificação — só recorte). */
  onlyWithoutNfe?: boolean | null;
  onlyWithoutStockDocument?: boolean | null;
  onlyWithoutReceivable?: boolean | null;
  /** Pedidos sem vendedor identificado no pedido. */
  onlyWithoutSeller?: boolean | null;
};

export type PortfolioMaturitySortBy =
  | "orderCode"
  | "orderValue"
  | "confidenceScore"
  | "statusPrincipal"
  | "issueDate"
  | "forecastDate"
  | "customerName"
  | "sellerName";

export type PortfolioOrderEnrichment = {
  salesOrderId: string;
  orderValue?: number | null;
  sellerName?: string | null;
  sellerExternalId?: number | null;
  sellerId?: string | null;
  companyId?: string | null;
  paymentTerms?: string | null;
  paymentMethod?: string | null;
  updatedAt?: Date | string | null;
};

export type PortfolioMaturityEvidenceFlags = {
  hasNfe: boolean;
  hasStockDocument: boolean;
  hasAllocatedStockDocument: boolean;
  hasReceivable: boolean;
  hasReceived: boolean;
  hasOpenReceivable: boolean;
};

export type PortfolioMaturityOrderRow = {
  salesOrderId: string | null;
  orderCode: string;
  externalSalesOrderId: number | null;
  customerName: string | null;
  customerExternalId: number | null;
  customerId: string | null;
  sellerName: string | null;
  sellerExternalId: number | null;
  sellerId: string | null;
  companyId: string | null;
  issueDate: string | null;
  expectedDeliveryDate: string | null;
  nfeDate: string | null;
  stockDocumentDate: string | null;
  receivableDueDate: string | null;
  receivableSettlementDate: string | null;
  forecastDate: string | null;
  updatedAt: string | null;
  orderValue: number;
  receivableTotalValue: number;
  receivedValue: number;
  openReceivableValue: number;
  nfeHeaderValue: number;
  stockDocumentValue: number;
  itemizedAllocatedValue: number;
  statusPrincipal: PortfolioMaturityStatus;
  tagsAlerta: PortfolioMaturityAlertTag[];
  confidenceScore: number;
  confidenceLabel: PortfolioConfidenceLabel;
  confidenceReasons: string[];
  recommendedAction: string;
  executiveSummary: string;
  daysSinceIssue: number | null;
  daysSinceExpected: number | null;
  nextRelevantDate: string | null;
  mainReason: string;
  evidenceFlags: PortfolioMaturityEvidenceFlags;
  forecastSource: string;
  factStatus: string;
  productExternalIds: number[];
};

export type PortfolioMaturityCardTone =
  | "money"
  | "success"
  | "info"
  | "warning"
  | "danger"
  | "neutral"
  | "alert";

export type PortfolioMaturitySummaryCard = {
  key: string;
  title: string;
  value: number;
  count: number;
  percentage: number | null;
  colorTone: PortfolioMaturityCardTone;
  /** true = card de alerta/tag; pode coexistir com status principal. */
  isAlertCard: boolean;
  explanation: {
    whatItMeans: string;
    howWeCalculate: string;
    whatIsIncluded: string;
    whatIsExcluded: string;
    howToInterpret: string;
  };
};

export type PortfolioMaturityStatusGroup = {
  statusPrincipal: PortfolioMaturityStatus;
  title: string;
  ordersCount: number;
  orderValue: number;
  averageConfidence: number;
  orderCodes: string[];
};

export type PortfolioMaturitySellerKpi = {
  sellerKey: string;
  sellerName: string;
  sellerExternalId: number | null;
  /** Fonte do vendedor: pedido (SalesOrder/Nomus), nunca CRM/comissões. */
  sellerSource: "SALES_ORDER" | "UNAVAILABLE";
  ordersCount: number;
  orderValue: number;
  /** Soma dos valores de CR rateados aos pedidos do vendedor. */
  receivableValue: number;
  /** Σ orderValue dos pedidos com CR / orderValue. */
  conversionCrValuePct: number | null;
  /** Qtd pedidos com CR / qtd pedidos. */
  conversionCrQtyPct: number | null;
  /** Σ orderValue dos pedidos com documento de saída. */
  documentConvertedValue: number;
  conversionDocValuePct: number | null;
  receivedValue: number;
  /** receivedValue / receivableValue. */
  receiptRatePct: number | null;
  /** Pedidos sem NF e sem CR (valor). */
  stuckWithoutNfCrValue: number;
  /** Status CARTEIRA_VENCIDA_BLOQUEADA (valor). */
  blockedValue: number;
  /** Participação em valor com confiança BAIXA ou MUITO_BAIXA. */
  lowConfidenceValuePct: number | null;
  averageConfidence: number;
  confidenceAvailable: boolean;
  mainBottleneck: string;
  mainBottleneckKey: string;
  note: string | null;
};

export type PortfolioMaturityAnalyticsResult = {
  summaryCards: PortfolioMaturitySummaryCard[];
  statusGroups: PortfolioMaturityStatusGroup[];
  sellerKpis: PortfolioMaturitySellerKpi[];
  rows: PortfolioMaturityOrderRow[];
  pagination: {
    page: number;
    pageSize: number;
    totalRows: number;
    totalPages: number;
  };
  metricExplanations: Record<string, PortfolioMetricExplanation>;
  appliedFilters: PortfolioMaturityAnalyticsFilters;
  warnings: string[];
  totals: {
    totalPedidos: number;
    valorTotalPedidos: number;
    pedidosSemNfDocCr: number;
    valorSemNfDocCr: number;
    valorFuturoPresentePlausivel: number;
    valorVencidoBloqueado: number;
  };
};

const STATUS_TITLES: Record<PortfolioMaturityStatus, string> = {
  RECEBIDO: "Recebido",
  CR_ABERTO: "CR aberto",
  FATURADO_SEM_CR: "Faturado sem CR",
  CARTEIRA_FUTURA_PROVAVEL: "Carteira futura provável",
  CARTEIRA_PRESENTE_ATENCAO: "Presente / atenção",
  CARTEIRA_VENCIDA_BLOQUEADA: "Carteira vencida / bloqueada",
  SEM_EVIDENCIA: "Sem evidência suficiente",
};

const STATUS_TONES: Record<PortfolioMaturityStatus, PortfolioMaturityCardTone> = {
  RECEBIDO: "success",
  CR_ABERTO: "money",
  FATURADO_SEM_CR: "warning",
  CARTEIRA_FUTURA_PROVAVEL: "info",
  CARTEIRA_PRESENTE_ATENCAO: "warning",
  CARTEIRA_VENCIDA_BLOQUEADA: "danger",
  SEM_EVIDENCIA: "neutral",
};

function explanationFromMetric(key: string) {
  const e = getMetricExplanation(key);
  return {
    whatItMeans: e.oQueSignifica,
    howWeCalculate: e.comoCalculamos,
    whatIsIncluded: e.oQueEntra,
    whatIsExcluded: e.oQueNaoEntra,
    howToInterpret: e.comoInterpretar,
  };
}

function sumStockDocumentValue(facts: readonly PortfolioReconciliationFactApiRow[]): number {
  const byDocItem = new Map<string, number>();
  for (const fact of facts) {
    if (fact.stockDocumentItemExternalId == null && fact.stockDocumentItemId == null) {
      continue;
    }
    const key =
      fact.stockDocumentItemId ??
      `ext:${fact.stockDocumentExternalId ?? "x"}:${fact.stockDocumentItemExternalId}`;
    if (byDocItem.has(key)) continue;
    const v =
      toNumber(fact.stockItemValue) ||
      (toNumber(fact.stockQuantity) * toNumber(fact.stockUnitValue));
    if (v > 0) byDocItem.set(key, v);
  }
  let sum = 0;
  for (const v of byDocItem.values()) sum += v;
  return round2(sum);
}

function collectDueDates(facts: readonly PortfolioReconciliationFactApiRow[]): string[] {
  const out: string[] = [];
  for (const fact of facts) {
    if (!Array.isArray(fact.dueDatesJson)) continue;
    for (const due of fact.dueDatesJson) {
      const iso = toIsoDate(due as string | Date | null);
      if (iso) out.push(iso);
    }
  }
  return out;
}

function collectSettlementDates(facts: readonly PortfolioReconciliationFactApiRow[]): string[] {
  const out: string[] = [];
  for (const fact of facts) {
    if (!Array.isArray(fact.settlementDatesJson)) continue;
    for (const settle of fact.settlementDatesJson) {
      const iso = toIsoDate(settle as string | Date | null);
      if (iso) out.push(iso);
    }
  }
  return out;
}

/**
 * Agrega facts de um pedido + enrichment opcional → linha de maturidade.
 */
export function buildMaturityOrderFromFacts(args: {
  facts: readonly PortfolioReconciliationFactApiRow[];
  enrichment?: PortfolioOrderEnrichment | null;
  orderTotalBySalesOrderId?: ReadonlyMap<string, number> | null;
  asOfDate?: string | null;
}): PortfolioMaturityOrderRow {
  const facts = args.facts;
  const first = facts[0]!;
  const salesOrderId = first.salesOrderId ?? args.enrichment?.salesOrderId ?? null;

  const itemValues = new Map<string, number>();
  let factStatus = first.status ?? "ORDER_ONLY";
  let factConfidence = first.confidenceLevel ?? "LOW";
  const alerts = new Set<string>();
  const productIds = new Set<number>();
  let hasNfe = false;
  let hasStockDocument = false;
  let hasAllocation = false;
  let allocated = 0;
  const nfeDates: string[] = [];
  const stockDates: string[] = [];

  for (const fact of facts) {
    const itemKey =
      fact.salesOrderItemId ??
      (fact.externalSalesOrderItemId != null
        ? `ext-item:${fact.externalSalesOrderItemId}`
        : null);
    if (itemKey != null && fact.orderItemValue != null && !itemValues.has(itemKey)) {
      itemValues.set(itemKey, toNumber(fact.orderItemValue));
    }
    factStatus = pickDominantStatus(factStatus, fact.status);
    factConfidence = pickWorseConfidence(factConfidence, fact.confidenceLevel);
    for (const a of parseAlertsJson(fact.alertsJson)) alerts.add(a);
    if (fact.externalProductId != null) productIds.add(fact.externalProductId);
    if (fact.nfeExternalId != null || fact.nomusNfeId != null) hasNfe = true;
    if (fact.stockDocumentId != null || fact.stockDocumentExternalId != null) {
      hasStockDocument = true;
    }
    if ((fact.allocatedQuantity ?? 0) > 0) {
      hasAllocation = true;
      allocated += toNumber(fact.allocatedValueByOrderPrice);
    }
    const nfeAt = toIsoDate(fact.nfeProcessedAt);
    if (nfeAt) nfeDates.push(nfeAt);
    const stockAt = toIsoDate(fact.stockDocumentDate);
    if (stockAt) stockDates.push(stockAt);
  }

  let itemSum = 0;
  for (const v of itemValues.values()) itemSum += v;

  const orderValue = resolveOrderValorPedido({
    facts,
    itemValuesSum: itemSum,
    salesOrderId,
    orderTotalBySalesOrderId: args.orderTotalBySalesOrderId,
  });
  const enrichedValue =
    args.enrichment?.orderValue != null && Number.isFinite(args.enrichment.orderValue)
      ? round2(args.enrichment.orderValue)
      : orderValue;
  const finalOrderValue =
    args.enrichment?.orderValue != null ? enrichedValue : orderValue;

  const { receivable, received } = computeOrderRateadoReceivableTotals(facts);
  let open = 0;
  for (const fact of facts) {
    if ((fact.allocatedQuantity ?? 0) <= 0) continue;
    if (fact.openReceivableValue == null) continue;
    open += toNumber(fact.openReceivableValue);
  }
  open = round2(open);
  if (open <= 0 && receivable > received) open = round2(receivable - received);

  const nfeHeaderValue = sumUniqueNfeHeaderValue(facts);
  const stockDocumentValue = sumStockDocumentValue(facts);
  const forecast = resolveOrderAggregatedForecast(facts);
  const asOf = toIsoDate(args.asOfDate) ?? startOfDayIso();

  const issueDate = toIsoDate(first.orderIssueDate);
  const expectedDeliveryDate = toIsoDate(first.expectedDeliveryDate);
  const dueDates = collectDueDates(facts);
  const settleDates = collectSettlementDates(facts);
  const paymentTerms = args.enrichment?.paymentTerms ?? args.enrichment?.paymentMethod;
  const paymentTermsAvailable = Boolean(paymentTerms && String(paymentTerms).trim());

  const classification = classifyPortfolioOrder({
    orderCode: first.orderCode ?? salesOrderId ?? "—",
    orderValue: finalOrderValue,
    orderIssueDate: issueDate,
    forecastDate: forecast.primaryDate,
    forecastSource: forecast.source,
    receivedValue: received,
    openReceivableValue: open,
    receivableTotalValue: receivable,
    hasNfe,
    hasStockDocument,
    hasAllocation,
    itemizedAllocatedValue: round2(allocated),
    nfeHeaderValue,
    factStatus,
    factConfidenceLevel: factConfidence,
    alerts: [...alerts],
    paymentTermsAvailable,
    asOfDate: asOf,
  });

  const sellerName = args.enrichment?.sellerName?.trim() || null;
  const nextRelevantDate =
    forecast.primaryDate ??
    earliestIso([
      ...dueDates.filter((d) => d >= asOf),
      expectedDeliveryDate && expectedDeliveryDate >= asOf ? expectedDeliveryDate : null,
    ]);

  return {
    salesOrderId,
    orderCode: first.orderCode ?? "—",
    externalSalesOrderId: first.externalSalesOrderId,
    customerName: first.customerNameSnapshot,
    customerExternalId: first.customerExternalId,
    customerId: first.customerId,
    sellerName,
    sellerExternalId: args.enrichment?.sellerExternalId ?? null,
    sellerId: args.enrichment?.sellerId ?? null,
    companyId: args.enrichment?.companyId ?? null,
    issueDate,
    expectedDeliveryDate,
    nfeDate: earliestIso(nfeDates),
    stockDocumentDate: earliestIso(stockDates),
    receivableDueDate: earliestIso(dueDates),
    receivableSettlementDate: latestIso(settleDates),
    forecastDate: forecast.primaryDate,
    updatedAt: toIsoDate(args.enrichment?.updatedAt) ?? null,
    orderValue: finalOrderValue,
    receivableTotalValue: receivable,
    receivedValue: received,
    openReceivableValue: open,
    nfeHeaderValue,
    stockDocumentValue,
    itemizedAllocatedValue: round2(allocated),
    statusPrincipal: classification.statusPrincipal,
    tagsAlerta: classification.tagsAlerta,
    confidenceScore: classification.confidenceScore,
    confidenceLabel: classification.confidenceLabel,
    confidenceReasons: classification.motivosConfianca,
    recommendedAction: classification.acaoRecomendada,
    executiveSummary: classification.resumoExecutivo,
    daysSinceIssue: issueDate ? daysBetween(issueDate, asOf) : null,
    daysSinceExpected: expectedDeliveryDate
      ? daysBetween(expectedDeliveryDate, asOf)
      : null,
    nextRelevantDate,
    mainReason: classification.resumoExecutivo,
    evidenceFlags: {
      hasNfe,
      hasStockDocument,
      hasAllocatedStockDocument: hasAllocation && hasStockDocument,
      hasReceivable: receivable > 0 || open > 0 || received > 0,
      hasReceived: received > 0,
      hasOpenReceivable: open > 0,
    },
    forecastSource: forecast.source,
    factStatus,
    productExternalIds: [...productIds],
  };
}

export function aggregateFactsToMaturityOrders(args: {
  facts: readonly PortfolioReconciliationFactApiRow[];
  enrichmentsBySalesOrderId?: ReadonlyMap<string, PortfolioOrderEnrichment> | null;
  orderTotalBySalesOrderId?: ReadonlyMap<string, number> | null;
  asOfDate?: string | null;
}): PortfolioMaturityOrderRow[] {
  const byOrder = new Map<string, PortfolioReconciliationFactApiRow[]>();
  for (const fact of args.facts) {
    const key = factOrderKey(fact);
    const list = byOrder.get(key) ?? [];
    list.push(fact);
    byOrder.set(key, list);
  }

  const rows: PortfolioMaturityOrderRow[] = [];
  for (const facts of byOrder.values()) {
    const salesOrderId = facts[0]?.salesOrderId ?? null;
    const enrichment =
      (salesOrderId && args.enrichmentsBySalesOrderId?.get(salesOrderId)) || null;
    rows.push(
      buildMaturityOrderFromFacts({
        facts,
        enrichment,
        orderTotalBySalesOrderId: args.orderTotalBySalesOrderId,
        asOfDate: args.asOfDate,
      })
    );
  }

  rows.sort((a, b) => a.orderCode.localeCompare(b.orderCode, "pt-BR"));
  return rows;
}

function dateForAxis(
  row: PortfolioMaturityOrderRow,
  axis: PortfolioMaturityDateAxis
): string | null {
  switch (axis) {
    case "ORDER_ISSUE_DATE":
      return row.issueDate;
    case "EXPECTED_DELIVERY_DATE":
      return row.expectedDeliveryDate;
    case "NFE_DATE":
      return row.nfeDate;
    case "STOCK_DOCUMENT_DATE":
      return row.stockDocumentDate;
    case "RECEIVABLE_DUE_DATE":
      return row.receivableDueDate;
    case "RECEIVABLE_SETTLEMENT_DATE":
      return row.receivableSettlementDate;
    case "FORECAST_DATE":
      return row.forecastDate;
    case "UPDATED_AT":
      return row.updatedAt;
    default:
      return null;
  }
}

export function filterMaturityOrders(
  rows: readonly PortfolioMaturityOrderRow[],
  filters: PortfolioMaturityAnalyticsFilters,
  warnings: string[]
): PortfolioMaturityOrderRow[] {
  const from = toIsoDate(filters.from);
  const to = toIsoDate(filters.to);
  const axis = filters.dateAxis ?? null;
  let missingDateAxisCount = 0;

  const filtered = rows.filter((row) => {
    if (
      filters.customerExternalId != null &&
      row.customerExternalId !== filters.customerExternalId
    ) {
      return false;
    }
    if (filters.customerId != null && row.customerId !== filters.customerId) return false;
    if (
      filters.sellerExternalId != null &&
      row.sellerExternalId !== filters.sellerExternalId
    ) {
      return false;
    }
    if (filters.sellerId != null && row.sellerId !== filters.sellerId) return false;
    if (filters.sellerName != null && filters.sellerName.trim()) {
      const needle = filters.sellerName.trim().toLowerCase();
      if (!(row.sellerName ?? "").toLowerCase().includes(needle)) return false;
    }
    if (filters.companyId != null && row.companyId !== filters.companyId) return false;
    if (filters.orderCode != null) {
      if (!row.orderCode.toLowerCase().includes(filters.orderCode.toLowerCase())) {
        return false;
      }
    }
    if (filters.productExternalId != null) {
      if (!row.productExternalIds.includes(filters.productExternalId)) return false;
    }
    if (filters.statusPrincipal != null && row.statusPrincipal !== filters.statusPrincipal) {
      return false;
    }
    if (
      filters.confidenceLabel != null &&
      row.confidenceLabel !== filters.confidenceLabel
    ) {
      return false;
    }
    if (filters.tagsAlerta != null && filters.tagsAlerta.length > 0) {
      if (!filters.tagsAlerta.every((t) => row.tagsAlerta.includes(t))) return false;
    }
    if (filters.minValue != null && row.orderValue < filters.minValue) return false;
    if (filters.maxValue != null && row.orderValue > filters.maxValue) return false;
    if (filters.onlyWithoutNfe && row.evidenceFlags.hasNfe) return false;
    if (filters.onlyWithoutStockDocument && row.evidenceFlags.hasStockDocument) {
      return false;
    }
    if (filters.onlyWithoutReceivable && row.evidenceFlags.hasReceivable) return false;
    if (filters.onlyWithoutSeller) {
      const hasSeller = Boolean(row.sellerName || row.sellerExternalId != null);
      if (hasSeller) return false;
    }

    if (axis && (from || to)) {
      const d = dateForAxis(row, axis);
      if (!d) {
        missingDateAxisCount += 1;
        return false;
      }
      if (from && d < from) return false;
      if (to && d > to) return false;
    }
    return true;
  });

  if (axis && (from || to) && missingDateAxisCount > 0) {
    warnings.push(
      `${missingDateAxisCount} pedido(s) sem data no eixo ${axis}: ${PORTFOLIO_INFO_UNAVAILABLE}`
    );
  }

  return filtered;
}

function pct(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return round2((part / whole) * 100);
}

function buildSummaryCards(
  rows: readonly PortfolioMaturityOrderRow[]
): PortfolioMaturitySummaryCard[] {
  const totalPedidos = rows.length;
  const valorTotal = round2(rows.reduce((s, r) => s + r.orderValue, 0));

  const byStatus = new Map<PortfolioMaturityStatus, { value: number; count: number }>();
  for (const status of Object.keys(STATUS_TITLES) as PortfolioMaturityStatus[]) {
    byStatus.set(status, { value: 0, count: 0 });
  }
  let divergenceValue = 0;
  let divergenceCount = 0;
  let receivedCr = 0;
  let totalCr = 0;
  let confWeighted = 0;

  for (const row of rows) {
    const bucket = byStatus.get(row.statusPrincipal)!;
    bucket.value = round2(bucket.value + row.orderValue);
    bucket.count += 1;
    if (row.tagsAlerta.includes("DIVERGENCIA_TECNICA")) {
      divergenceValue = round2(divergenceValue + row.orderValue);
      divergenceCount += 1;
    }
    if (row.evidenceFlags.hasReceivable || row.statusPrincipal === "CR_ABERTO" || row.statusPrincipal === "RECEBIDO") {
      totalCr = round2(totalCr + row.receivableTotalValue);
      receivedCr = round2(receivedCr + row.receivedValue);
    }
    confWeighted += row.confidenceScore * row.orderValue;
  }

  const withCr = rows.filter(
    (r) =>
      r.evidenceFlags.hasReceivable ||
      r.statusPrincipal === "CR_ABERTO" ||
      r.statusPrincipal === "RECEBIDO"
  );
  const withDoc = rows.filter((r) => r.evidenceFlags.hasStockDocument);
  const blocked = byStatus.get("CARTEIRA_VENCIDA_BLOQUEADA")!;
  const avgConf = valorTotal > 0 ? round2(confWeighted / valorTotal) : 0;

  const statusCard = (
    key: PortfolioMaturityStatus
  ): PortfolioMaturitySummaryCard => {
    const b = byStatus.get(key)!;
    return {
      key,
      title: STATUS_TITLES[key],
      value: b.value,
      count: b.count,
      percentage: pct(b.value, valorTotal),
      colorTone: STATUS_TONES[key],
      isAlertCard: false,
      explanation: explanationFromMetric(key),
    };
  };

  const cards: PortfolioMaturitySummaryCard[] = [
    {
      key: "CARTEIRA_TOTAL_ANALISADA",
      title: "Carteira total analisada",
      value: valorTotal,
      count: totalPedidos,
      percentage: 100,
      colorTone: "money",
      isAlertCard: false,
      explanation: explanationFromMetric("CARTEIRA_TOTAL_ANALISADA"),
    },
    statusCard("RECEBIDO"),
    statusCard("CR_ABERTO"),
    statusCard("FATURADO_SEM_CR"),
    statusCard("CARTEIRA_FUTURA_PROVAVEL"),
    statusCard("CARTEIRA_PRESENTE_ATENCAO"),
    statusCard("CARTEIRA_VENCIDA_BLOQUEADA"),
    {
      key: "DIVERGENCIA_TECNICA",
      title: "Divergência técnica (alerta)",
      value: divergenceValue,
      count: divergenceCount,
      percentage: pct(divergenceValue, valorTotal),
      colorTone: "alert",
      isAlertCard: true,
      explanation: explanationFromMetric("DIVERGENCIA_TECNICA"),
    },
    statusCard("SEM_EVIDENCIA"),
    {
      key: "RISCO_SUPERESTIMACAO",
      title: "Risco de superestimação",
      value: blocked.value,
      count: blocked.count,
      percentage: pct(blocked.value, valorTotal),
      colorTone: "danger",
      // Derivado de CARTEIRA_VENCIDA_BLOQUEADA — alerta, não soma no bucket principal.
      isAlertCard: true,
      explanation: explanationFromMetric("RISCO_SUPERESTIMACAO"),
    },
    {
      key: "CONVERSAO_PEDIDOS_CR_QTD",
      title: "Conversão pedidos → CR (qtd)",
      value: pct(withCr.length, totalPedidos) ?? 0,
      count: withCr.length,
      percentage: pct(withCr.length, totalPedidos),
      colorTone: "info",
      isAlertCard: false,
      explanation: explanationFromMetric("CONVERSAO_PEDIDOS_CR_QTD"),
    },
    {
      key: "CONVERSAO_PEDIDOS_CR_VALOR",
      title: "Conversão pedidos → CR (valor)",
      value: pct(
        withCr.reduce((s, r) => s + r.orderValue, 0),
        valorTotal
      ) ?? 0,
      count: withCr.length,
      percentage: pct(
        withCr.reduce((s, r) => s + r.orderValue, 0),
        valorTotal
      ),
      colorTone: "info",
      isAlertCard: false,
      explanation: explanationFromMetric("CONVERSAO_PEDIDOS_CR_VALOR"),
    },
    {
      key: "CONVERSAO_DOC_SAIDA_QTD",
      title: "Conversão → documento saída (qtd)",
      value: pct(withDoc.length, totalPedidos) ?? 0,
      count: withDoc.length,
      percentage: pct(withDoc.length, totalPedidos),
      colorTone: "info",
      isAlertCard: false,
      explanation: explanationFromMetric("CONVERSAO_DOC_SAIDA_QTD"),
    },
    {
      key: "CONVERSAO_DOC_SAIDA_VALOR",
      title: "Conversão → documento saída (valor)",
      value: pct(
        withDoc.reduce((s, r) => s + r.orderValue, 0),
        valorTotal
      ) ?? 0,
      count: withDoc.length,
      percentage: pct(
        withDoc.reduce((s, r) => s + r.orderValue, 0),
        valorTotal
      ),
      colorTone: "info",
      isAlertCard: false,
      explanation: explanationFromMetric("CONVERSAO_DOC_SAIDA_VALOR"),
    },
    {
      key: "TAXA_RECEBIMENTO_CR",
      title: "Taxa de recebimento do CR",
      value: pct(receivedCr, totalCr) ?? 0,
      count: rows.filter((r) => r.evidenceFlags.hasReceived).length,
      percentage: pct(receivedCr, totalCr),
      colorTone: "success",
      isAlertCard: false,
      explanation: explanationFromMetric("TAXA_RECEBIMENTO_CR"),
    },
    {
      key: "CONFIANCA_MEDIA_CARTEIRA",
      title: "Índice médio de confiança",
      value: avgConf,
      count: totalPedidos,
      percentage: avgConf,
      colorTone: avgConf >= 80 ? "success" : avgConf >= 60 ? "info" : avgConf >= 30 ? "warning" : "danger",
      isAlertCard: false,
      explanation: explanationFromMetric("CONFIANCA_MEDIA_CARTEIRA"),
    },
  ];

  return cards;
}

function buildStatusGroups(
  rows: readonly PortfolioMaturityOrderRow[]
): PortfolioMaturityStatusGroup[] {
  const map = new Map<
    PortfolioMaturityStatus,
    { value: number; count: number; conf: number; codes: string[] }
  >();
  for (const status of Object.keys(STATUS_TITLES) as PortfolioMaturityStatus[]) {
    map.set(status, { value: 0, count: 0, conf: 0, codes: [] });
  }
  for (const row of rows) {
    const g = map.get(row.statusPrincipal)!;
    g.value = round2(g.value + row.orderValue);
    g.count += 1;
    g.conf += row.confidenceScore * row.orderValue;
    g.codes.push(row.orderCode);
  }
  return (Object.keys(STATUS_TITLES) as PortfolioMaturityStatus[]).map((status) => {
    const g = map.get(status)!;
    return {
      statusPrincipal: status,
      title: STATUS_TITLES[status],
      ordersCount: g.count,
      orderValue: g.value,
      averageConfidence: g.value > 0 ? round2(g.conf / g.value) : 0,
      orderCodes: g.codes.sort((a, b) => a.localeCompare(b, "pt-BR")),
    };
  });
}

export function buildSellerKpis(
  rows: readonly PortfolioMaturityOrderRow[]
): PortfolioMaturitySellerKpi[] {
  type Acc = {
    sellerName: string;
    sellerExternalId: number | null;
    available: boolean;
    value: number;
    count: number;
    conf: number;
    receivableValue: number;
    receivedValue: number;
    withCrCount: number;
    withCrOrderValue: number;
    withDocOrderValue: number;
    stuckWithoutNfCrValue: number;
    blockedValue: number;
    lowConfidenceValue: number;
    faturadoSemCrValue: number;
    presenteValue: number;
    futuraValue: number;
    divergenceValue: number;
  };

  const map = new Map<string, Acc>();

  for (const row of rows) {
    const available = Boolean(row.sellerName || row.sellerExternalId != null);
    const key = available
      ? `seller:${row.sellerExternalId ?? row.sellerId ?? row.sellerName}`
      : "seller:unavailable";
    const name = available
      ? row.sellerName ?? `Vendedor ${row.sellerExternalId}`
      : "Sem vendedor informado";
    let g = map.get(key);
    if (!g) {
      g = {
        sellerName: name,
        sellerExternalId: row.sellerExternalId,
        available,
        value: 0,
        count: 0,
        conf: 0,
        receivableValue: 0,
        receivedValue: 0,
        withCrCount: 0,
        withCrOrderValue: 0,
        withDocOrderValue: 0,
        stuckWithoutNfCrValue: 0,
        blockedValue: 0,
        lowConfidenceValue: 0,
        faturadoSemCrValue: 0,
        presenteValue: 0,
        futuraValue: 0,
        divergenceValue: 0,
      };
      map.set(key, g);
    }
    g.value = round2(g.value + row.orderValue);
    g.count += 1;
    g.conf += row.confidenceScore * row.orderValue;
    g.receivableValue = round2(g.receivableValue + row.receivableTotalValue);
    g.receivedValue = round2(g.receivedValue + row.receivedValue);

    const hasCr =
      row.evidenceFlags.hasReceivable ||
      row.statusPrincipal === "CR_ABERTO" ||
      row.statusPrincipal === "RECEBIDO";
    if (hasCr) {
      g.withCrCount += 1;
      g.withCrOrderValue = round2(g.withCrOrderValue + row.orderValue);
    }
    if (row.evidenceFlags.hasStockDocument) {
      g.withDocOrderValue = round2(g.withDocOrderValue + row.orderValue);
    }
    if (!row.evidenceFlags.hasNfe && !row.evidenceFlags.hasReceivable) {
      g.stuckWithoutNfCrValue = round2(g.stuckWithoutNfCrValue + row.orderValue);
    }
    if (row.statusPrincipal === "CARTEIRA_VENCIDA_BLOQUEADA") {
      g.blockedValue = round2(g.blockedValue + row.orderValue);
    }
    if (row.confidenceLabel === "BAIXA" || row.confidenceLabel === "MUITO_BAIXA") {
      g.lowConfidenceValue = round2(g.lowConfidenceValue + row.orderValue);
    }
    if (row.statusPrincipal === "FATURADO_SEM_CR") {
      g.faturadoSemCrValue = round2(g.faturadoSemCrValue + row.orderValue);
    }
    if (row.statusPrincipal === "CARTEIRA_PRESENTE_ATENCAO") {
      g.presenteValue = round2(g.presenteValue + row.orderValue);
    }
    if (row.statusPrincipal === "CARTEIRA_FUTURA_PROVAVEL") {
      g.futuraValue = round2(g.futuraValue + row.orderValue);
    }
    if (row.tagsAlerta.includes("DIVERGENCIA_TECNICA")) {
      g.divergenceValue = round2(g.divergenceValue + row.orderValue);
    }
  }

  return [...map.entries()]
    .map(([sellerKey, g]) => {
      const bottleneckCandidates: Array<{ key: string; label: string; value: number }> = [
        {
          key: "CARTEIRA_VENCIDA_BLOQUEADA",
          label: "Carteira vencida / bloqueada",
          value: g.blockedValue,
        },
        {
          key: "SEM_NF_CR",
          label: "Parado sem NF/CR",
          value: g.stuckWithoutNfCrValue,
        },
        {
          key: "FATURADO_SEM_CR",
          label: "Faturado sem CR",
          value: g.faturadoSemCrValue,
        },
        {
          key: "CARTEIRA_PRESENTE_ATENCAO",
          label: "Presente / atenção",
          value: g.presenteValue,
        },
        {
          key: "DIVERGENCIA_TECNICA",
          label: "Divergência técnica",
          value: g.divergenceValue,
        },
        {
          key: "CARTEIRA_FUTURA_PROVAVEL",
          label: "Carteira futura (ainda sem evolução)",
          value: g.futuraValue,
        },
      ];
      bottleneckCandidates.sort((a, b) => b.value - a.value);
      const top = bottleneckCandidates[0];
      const mainBottleneck =
        !top || top.value <= 0 ? "Sem gargalo evidente" : top.label;
      const mainBottleneckKey = !top || top.value <= 0 ? "NONE" : top.key;

      return {
        sellerKey,
        sellerName: g.sellerName,
        sellerExternalId: g.sellerExternalId,
        sellerSource: g.available ? ("SALES_ORDER" as const) : ("UNAVAILABLE" as const),
        ordersCount: g.count,
        orderValue: g.value,
        receivableValue: g.receivableValue,
        conversionCrValuePct: pct(g.withCrOrderValue, g.value),
        conversionCrQtyPct: pct(g.withCrCount, g.count),
        documentConvertedValue: g.withDocOrderValue,
        conversionDocValuePct: pct(g.withDocOrderValue, g.value),
        receivedValue: g.receivedValue,
        receiptRatePct: pct(g.receivedValue, g.receivableValue),
        stuckWithoutNfCrValue: g.stuckWithoutNfCrValue,
        blockedValue: g.blockedValue,
        lowConfidenceValuePct: pct(g.lowConfidenceValue, g.value),
        averageConfidence: g.value > 0 ? round2(g.conf / g.value) : 0,
        confidenceAvailable: g.available,
        mainBottleneck,
        mainBottleneckKey,
        note: g.available
          ? "Vendedor do pedido (SalesOrder / Nomus)."
          : "Sem vendedor informado na importação do pedido.",
      };
    })
    .sort((a, b) => b.orderValue - a.orderValue || a.sellerName.localeCompare(b.sellerName, "pt-BR"));
}

function buildTotals(rows: readonly PortfolioMaturityOrderRow[]) {
  const semEvidenciaOperacional = rows.filter(
    (r) =>
      !r.evidenceFlags.hasNfe &&
      !r.evidenceFlags.hasStockDocument &&
      !r.evidenceFlags.hasReceivable
  );
  const futuroPresente = rows.filter(
    (r) =>
      r.statusPrincipal === "CARTEIRA_FUTURA_PROVAVEL" ||
      r.statusPrincipal === "CARTEIRA_PRESENTE_ATENCAO"
  );
  const vencido = rows.filter((r) => r.statusPrincipal === "CARTEIRA_VENCIDA_BLOQUEADA");

  return {
    totalPedidos: rows.length,
    valorTotalPedidos: round2(rows.reduce((s, r) => s + r.orderValue, 0)),
    pedidosSemNfDocCr: semEvidenciaOperacional.length,
    valorSemNfDocCr: round2(semEvidenciaOperacional.reduce((s, r) => s + r.orderValue, 0)),
    valorFuturoPresentePlausivel: round2(
      futuroPresente.reduce((s, r) => s + r.orderValue, 0)
    ),
    valorVencidoBloqueado: round2(vencido.reduce((s, r) => s + r.orderValue, 0)),
  };
}

export function sortMaturityOrders(
  rows: readonly PortfolioMaturityOrderRow[],
  sortBy?: PortfolioMaturitySortBy | null,
  sortDirection?: "asc" | "desc" | null
): PortfolioMaturityOrderRow[] {
  const dir = sortDirection === "desc" ? -1 : 1;
  const key = sortBy ?? "orderCode";
  const copy = [...rows];
  copy.sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av == null && bv == null) return a.orderCode.localeCompare(b.orderCode, "pt-BR");
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") {
      const c = av - bv;
      return c !== 0 ? c * dir : a.orderCode.localeCompare(b.orderCode, "pt-BR");
    }
    const c = String(av).localeCompare(String(bv), "pt-BR");
    return c !== 0 ? c * dir : a.orderCode.localeCompare(b.orderCode, "pt-BR");
  });
  return copy;
}

/**
 * Pipeline completo: agrega → classifica → filtra → cards/KPIs → página.
 */
export function buildPortfolioMaturityAnalytics(args: {
  facts: readonly PortfolioReconciliationFactApiRow[];
  filters?: PortfolioMaturityAnalyticsFilters | null;
  enrichmentsBySalesOrderId?: ReadonlyMap<string, PortfolioOrderEnrichment> | null;
  orderTotalBySalesOrderId?: ReadonlyMap<string, number> | null;
}): PortfolioMaturityAnalyticsResult {
  const filters: PortfolioMaturityAnalyticsFilters = {
    page: 1,
    pageSize: 50,
    ...(args.filters ?? {}),
  };
  const warnings: string[] = [];
  const asOf = toIsoDate(filters.asOfDate) ?? toIsoDate(filters.to) ?? startOfDayIso();

  const allRows = aggregateFactsToMaturityOrders({
    facts: args.facts,
    enrichmentsBySalesOrderId: args.enrichmentsBySalesOrderId,
    orderTotalBySalesOrderId: args.orderTotalBySalesOrderId,
    asOfDate: asOf,
  });

  const filtered = filterMaturityOrders(allRows, filters, warnings);
  const sorted = sortMaturityOrders(filtered, filters.sortBy, filters.sortDirection);
  const summaryCards = buildSummaryCards(sorted);
  const statusGroups = buildStatusGroups(sorted);
  const sellerKpis = buildSellerKpis(sorted);
  const totals = buildTotals(sorted);

  // Não duplicidade: soma dos status principais = carteira total
  const statusSum = statusGroups.reduce((s, g) => s + g.orderValue, 0);
  if (Math.abs(statusSum - totals.valorTotalPedidos) > 0.05) {
    warnings.push(
      `Inconsistência de não duplicidade: soma status ${statusSum} ≠ total ${totals.valorTotalPedidos}.`
    );
  }

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 50));
  const totalRows = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const start = (page - 1) * pageSize;
  const rows = sorted.slice(start, start + pageSize);

  const metricExplanations: Record<string, PortfolioMetricExplanation> = {};
  for (const card of summaryCards) {
    metricExplanations[card.key] = {
      metricKey: card.key,
      oQueSignifica: card.explanation.whatItMeans,
      comoCalculamos: card.explanation.howWeCalculate,
      oQueEntra: card.explanation.whatIsIncluded,
      oQueNaoEntra: card.explanation.whatIsExcluded,
      comoInterpretar: card.explanation.howToInterpret,
    };
  }

  return {
    summaryCards,
    statusGroups,
    sellerKpis,
    rows,
    pagination: { page, pageSize, totalRows, totalPages },
    metricExplanations,
    appliedFilters: { ...filters, asOfDate: asOf },
    warnings,
    totals,
  };
}

/** Constantes de validação Britânia (run 1dc2ead7…). */
export const BRITANIA_INTELLIGENCE_EXPECTED = {
  runId: "1dc2ead7-533d-4ad4-bc4c-621061fa5623",
  customerExternalId: 200,
  totalPedidos: 31,
  valorTotalPedidos: 3_324_636.5,
  pedidosSemNfDocCr: 13,
  valorSemNfDocCr: 1_380_296,
  valorFuturoPresentePlausivel: 495_460,
  valorVencidoBloqueado: 884_836,
  futurePresentOrders: [
    { orderCode: "PD 02607", orderValue: 202_860, statusPrincipal: "CARTEIRA_FUTURA_PROVAVEL" },
    { orderCode: "PD 02740", orderValue: 175_600, statusPrincipal: "CARTEIRA_FUTURA_PROVAVEL" },
    { orderCode: "PD 02739", orderValue: 117_000, statusPrincipal: "CARTEIRA_PRESENTE_ATENCAO" },
  ],
  blockedOrders: [
    { orderCode: "PD 02159", orderValue: 320_070 },
    { orderCode: "PD 01604", orderValue: 216_700 },
    { orderCode: "PD 01953", orderValue: 123_050 },
    { orderCode: "PD 02092", orderValue: 41_328 },
    { orderCode: "PD 01954", orderValue: 39_360 },
    { orderCode: "PD 01955", orderValue: 39_360 },
    { orderCode: "PD 02080", orderValue: 36_975 },
    { orderCode: "PD 01603", orderValue: 31_065 },
    { orderCode: "PD 02158", orderValue: 26_568 },
    { orderCode: "PD 01562", orderValue: 10_360 },
  ],
} as const;
