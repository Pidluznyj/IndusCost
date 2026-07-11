/**
 * API pura — Funil Pedido → Caixa (parse de filtros + payloads).
 * Sem Prisma / write / migration. Não usa Proposal nem Comissões.
 *
 * @see docs/sales/sales-order-to-cash-funnel-requirements.md
 */

import {
  buildSalesOrderToCashFunnelAnalytics,
  type SalesOrderToCashFunnelAnalytics,
} from "./salesOrderToCashFunnelAnalytics.js";
import {
  SALES_ORDER_TO_CASH_FUNNEL_STAGES,
  type ClassifiedSalesOrderFunnelRow,
  type SalesOrderToCashAlert,
  type SalesOrderToCashConfidenceLabel,
  type SalesOrderToCashFunnelStage,
  type SalesOrderToCashStageGroup,
  type SalesOrderToCashTemperature,
} from "./salesOrderToCashFunnelClassification.js";

export const ORDER_TO_CASH_FUNNEL_DEFAULT_PAGE_SIZE = 50;
export const ORDER_TO_CASH_FUNNEL_MAX_PAGE_SIZE = 200;

export const ORDER_TO_CASH_FUNNEL_NO_DATA_MESSAGE =
  "Não há dados suficientes para montar o Funil Pedido → Caixa. Verifique pedidos importados e a Conciliação de Carteira.";

export const ORDER_TO_CASH_FULFILLMENT_MAP_UNAVAILABLE_WARNING =
  "Não foi possível montar o mapa de atendimento com os dados disponíveis.";

export type OrderToCashFunnelDateAxis =
  | "ORDER_ISSUE_DATE"
  | "EXPECTED_DELIVERY_DATE"
  | "STOCK_DOCUMENT_DATE"
  | "NFE_DATE"
  | "RECEIVABLE_DUE_DATE"
  | "RECEIVABLE_SETTLEMENT_DATE"
  | "FORECAST_DATE"
  | "UPDATED_AT";

export type OrderToCashFunnelFilters = {
  customerId: string | null;
  customerName: string | null;
  sellerId: string | null;
  sellerName: string | null;
  companyId: string | null;
  companyName: string | null;
  orderCode: string | null;
  salesOrderId: string | null;
  productSku: string | null;
  productName: string | null;
  funnelStage: SalesOrderToCashFunnelStage | null;
  stageGroup: SalesOrderToCashStageGroup | null;
  temperature: SalesOrderToCashTemperature | null;
  confidenceLabel: SalesOrderToCashConfidenceLabel | null;
  alert: SalesOrderToCashAlert | null;
  /** Área responsável sugerida pela classificação (ex.: COMERCIAL). */
  responsibleArea: string | null;
  minValue: number | null;
  maxValue: number | null;
  dateAxis: OrderToCashFunnelDateAxis | null;
  dateFrom: string | null;
  dateTo: string | null;
  page: number;
  pageSize: number;
  runId: string | null;
};

export type OrderToCashFunnelListRow = {
  salesOrderId: string;
  orderCode: string | null;
  customerName: string | null;
  sellerName: string | null;
  issueDate: string | null;
  expectedDeliveryDate: string | null;
  orderValue: number;
  funnelStage: SalesOrderToCashFunnelStage;
  funnelStageLabel: string;
  stageGroup: SalesOrderToCashStageGroup;
  temperature: SalesOrderToCashTemperature;
  confidenceScore: number;
  confidenceLabel: SalesOrderToCashConfidenceLabel;
  financialStatus: string | null;
  operationalStatus: string | null;
  fulfillmentPercent: number | null;
  alerts: SalesOrderToCashAlert[];
  actionRecommendation: string;
  responsibleArea: string;
  evidenceSource: string;
  forecastDate: string | null;
  forecastValue: number | null;
  lastEvidenceDate: string | null;
};

export type OrderToCashFunnelDataFreshness = {
  sourceLabel: string;
  runId: string | null;
  runFinishedAt: string | null;
  isLatestRun: boolean | null;
  lastEvidenceDate: string | null;
  warnings: string[];
  laymanNotice: string;
};

export type OrderToCashFunnelEnrichedRow = ClassifiedSalesOrderFunnelRow & {
  issueDate: string | null;
  expectedDeliveryDate: string | null;
  financialStatus: string | null;
  operationalStatus: string | null;
  fulfillmentPercent: number | null;
  forecastDate: string | null;
  forecastValue: number | null;
  lastEvidenceDate: string | null;
  companyId: string | null;
  companyName: string | null;
  productSkus: string[];
  productNames: string[];
  axisDates: Partial<Record<OrderToCashFunnelDateAxis, string | null>>;
  updatedAt: string | null;
};

export class OrderToCashFunnelApiParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderToCashFunnelApiParseError";
  }
}

const DATE_AXES = new Set<OrderToCashFunnelDateAxis>([
  "ORDER_ISSUE_DATE",
  "EXPECTED_DELIVERY_DATE",
  "STOCK_DOCUMENT_DATE",
  "NFE_DATE",
  "RECEIVABLE_DUE_DATE",
  "RECEIVABLE_SETTLEMENT_DATE",
  "FORECAST_DATE",
  "UPDATED_AT",
]);

const STAGE_GROUPS = new Set<SalesOrderToCashStageGroup>([
  "COMERCIAL",
  "OPERACIONAL",
  "FISCAL",
  "FINANCEIRO",
  "CAIXA",
  "RISCO",
]);

const TEMPERATURES = new Set<SalesOrderToCashTemperature>([
  "QUENTE",
  "MORNO",
  "FRIO",
  "CONGELADO",
]);

const CONFIDENCE_LABELS = new Set<SalesOrderToCashConfidenceLabel>([
  "ALTA",
  "MEDIA",
  "BAIXA",
  "MUITO_BAIXA",
]);

const ALERTS = new Set<SalesOrderToCashAlert>([
  "ENTREGA_VENCIDA_SEM_DOCUMENTO",
  "RECEBIMENTO_PREVISTO_SEM_CR",
  "DOCUMENTO_PARCIAL",
  "DOCUMENTO_COM_EXCEDENTE",
  "PRODUTO_FORA_DO_PEDIDO",
  "NF_SEM_CR",
  "CR_VENCIDO",
  "BAIXA_NAO_ENCONTRADA",
  "FORECAST_EM_RISCO",
  "PEDIDO_ANTIGO_SEM_EVOLUCAO",
]);

const STAGES = new Set<SalesOrderToCashFunnelStage>(SALES_ORDER_TO_CASH_FUNNEL_STAGES);

function asQueryString(value: unknown): string | null {
  if (value == null) return null;
  const s = Array.isArray(value) ? String(value[0] ?? "") : String(value);
  const trimmed = s.trim();
  return trimmed.length ? trimmed : null;
}

function asPageInt(value: unknown, field: string, fallback: number): number {
  const raw = asQueryString(value);
  if (raw == null) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new OrderToCashFunnelApiParseError(`${field} inválido.`);
  }
  return n;
}

function asNonNegativeNumber(value: unknown, field: string): number | null {
  const raw = asQueryString(value);
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new OrderToCashFunnelApiParseError(`${field} inválido.`);
  }
  return n;
}

function asIsoDate(value: unknown, field: string): string | null {
  const raw = asQueryString(value);
  if (raw == null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new OrderToCashFunnelApiParseError(
      `${field} inválido. Use o formato AAAA-MM-DD.`
    );
  }
  return raw;
}

function includesInsensitive(haystack: string | null | undefined, needle: string): boolean {
  if (!haystack) return false;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Parse seguro dos query params do Funil Pedido → Caixa.
 * Aceita aliases: cliente/customerId/customerName, vendedor/seller*, empresa/company*,
 * pedido/orderCode, produto/productSku, estágio/funnelStage|stage, etc.
 */
export function parseOrderToCashFunnelFilters(
  query: Record<string, unknown>
): OrderToCashFunnelFilters {
  const page = asPageInt(query.page, "page", 1);
  let pageSize = asPageInt(
    query.pageSize,
    "pageSize",
    ORDER_TO_CASH_FUNNEL_DEFAULT_PAGE_SIZE
  );
  if (pageSize > ORDER_TO_CASH_FUNNEL_MAX_PAGE_SIZE) {
    pageSize = ORDER_TO_CASH_FUNNEL_MAX_PAGE_SIZE;
  }

  const dateAxisRaw = asQueryString(query.dateAxis);
  let dateAxis: OrderToCashFunnelDateAxis | null = null;
  if (dateAxisRaw) {
    const u = dateAxisRaw.toUpperCase() as OrderToCashFunnelDateAxis;
    if (!DATE_AXES.has(u)) {
      throw new OrderToCashFunnelApiParseError(
        `dateAxis inválido. Use um de: ${[...DATE_AXES].join(", ")}.`
      );
    }
    dateAxis = u;
  }

  const dateFrom = asIsoDate(query.dateFrom ?? query.from, "dateFrom");
  const dateTo = asIsoDate(query.dateTo ?? query.to, "dateTo");
  if ((dateFrom || dateTo) && !dateAxis) {
    throw new OrderToCashFunnelApiParseError(
      "Informe dateAxis ao filtrar por dateFrom/dateTo."
    );
  }

  const stageRaw = asQueryString(query.funnelStage ?? query.stage ?? query.estagio);
  let funnelStage: SalesOrderToCashFunnelStage | null = null;
  if (stageRaw) {
    const u = stageRaw.toUpperCase() as SalesOrderToCashFunnelStage;
    if (!STAGES.has(u)) {
      throw new OrderToCashFunnelApiParseError(
        `estágio inválido. Use um de: ${[...STAGES].join(", ")}.`
      );
    }
    funnelStage = u;
  }

  const groupRaw = asQueryString(query.stageGroup ?? query.group ?? query.grupo);
  let stageGroup: SalesOrderToCashStageGroup | null = null;
  if (groupRaw) {
    const u = groupRaw.toUpperCase() as SalesOrderToCashStageGroup;
    if (!STAGE_GROUPS.has(u)) {
      throw new OrderToCashFunnelApiParseError(
        `grupo inválido. Use um de: ${[...STAGE_GROUPS].join(", ")}.`
      );
    }
    stageGroup = u;
  }

  const tempRaw = asQueryString(query.temperature ?? query.temperatura);
  let temperature: SalesOrderToCashTemperature | null = null;
  if (tempRaw) {
    const u = tempRaw.toUpperCase() as SalesOrderToCashTemperature;
    if (!TEMPERATURES.has(u)) {
      throw new OrderToCashFunnelApiParseError(
        `temperatura inválida. Use um de: ${[...TEMPERATURES].join(", ")}.`
      );
    }
    temperature = u;
  }

  const confRaw = asQueryString(
    query.confidenceLabel ?? query.confidence ?? query.confianca
  );
  let confidenceLabel: SalesOrderToCashConfidenceLabel | null = null;
  if (confRaw) {
    const u = confRaw.toUpperCase() as SalesOrderToCashConfidenceLabel;
    if (!CONFIDENCE_LABELS.has(u)) {
      throw new OrderToCashFunnelApiParseError(
        `confiança inválida. Use um de: ${[...CONFIDENCE_LABELS].join(", ")}.`
      );
    }
    confidenceLabel = u;
  }

  const alertRaw = asQueryString(query.alert ?? query.alerta);
  let alert: SalesOrderToCashAlert | null = null;
  if (alertRaw) {
    const u = alertRaw.toUpperCase() as SalesOrderToCashAlert;
    if (!ALERTS.has(u)) {
      throw new OrderToCashFunnelApiParseError(
        `alerta inválido. Use um de: ${[...ALERTS].join(", ")}.`
      );
    }
    alert = u;
  }

  const responsibleArea = asQueryString(
    query.responsibleArea ?? query.responsavel ?? query.responsible
  );

  const minValue = asNonNegativeNumber(
    query.minValue ?? query.valorMinimo,
    "minValue"
  );
  const maxValue = asNonNegativeNumber(
    query.maxValue ?? query.valorMaximo,
    "maxValue"
  );
  if (minValue != null && maxValue != null && minValue > maxValue) {
    throw new OrderToCashFunnelApiParseError(
      "valor mínimo não pode ser maior que o valor máximo."
    );
  }

  return {
    customerId: asQueryString(query.customerId ?? query.clienteId),
    customerName: asQueryString(query.customerName ?? query.cliente),
    sellerId: asQueryString(query.sellerId ?? query.vendedorId),
    sellerName: asQueryString(query.sellerName ?? query.vendedor),
    companyId: asQueryString(query.companyId ?? query.empresaId),
    companyName: asQueryString(query.companyName ?? query.empresa),
    orderCode: asQueryString(query.orderCode ?? query.pedido),
    salesOrderId: asQueryString(query.salesOrderId),
    productSku: asQueryString(query.productSku ?? query.sku ?? query.produto),
    productName: asQueryString(query.productName),
    funnelStage,
    stageGroup,
    temperature,
    confidenceLabel,
    alert,
    responsibleArea: responsibleArea ? responsibleArea.toUpperCase() : null,
    minValue,
    maxValue,
    dateAxis,
    dateFrom,
    dateTo,
    page,
    pageSize,
    runId: asQueryString(query.runId),
  };
}

export function filterOrderToCashFunnelRows(
  rows: readonly OrderToCashFunnelEnrichedRow[],
  filters: OrderToCashFunnelFilters
): OrderToCashFunnelEnrichedRow[] {
  return rows.filter((row) => {
    if (filters.salesOrderId && row.orderId !== filters.salesOrderId) return false;
    if (filters.customerId && row.customerId !== filters.customerId) return false;
    if (
      filters.customerName &&
      !includesInsensitive(row.customerName, filters.customerName)
    ) {
      return false;
    }
    if (filters.sellerId && row.sellerId !== filters.sellerId) return false;
    if (
      filters.sellerName &&
      !includesInsensitive(row.sellerName, filters.sellerName)
    ) {
      return false;
    }
    if (filters.companyId && row.companyId !== filters.companyId) return false;
    if (
      filters.companyName &&
      !includesInsensitive(row.companyName, filters.companyName)
    ) {
      return false;
    }
    if (
      filters.orderCode &&
      !includesInsensitive(row.orderCode, filters.orderCode)
    ) {
      return false;
    }
    if (filters.productSku) {
      const ok = row.productSkus.some((s) =>
        includesInsensitive(s, filters.productSku!)
      );
      if (!ok) return false;
    }
    if (filters.productName) {
      const ok = row.productNames.some((s) =>
        includesInsensitive(s, filters.productName!)
      );
      if (!ok) return false;
    }
    if (filters.funnelStage && row.funnelStage !== filters.funnelStage) return false;
    if (filters.stageGroup && row.stageGroup !== filters.stageGroup) return false;
    if (filters.temperature && row.temperature !== filters.temperature) return false;
    if (filters.confidenceLabel && row.confidenceLabel !== filters.confidenceLabel) {
      return false;
    }
    if (filters.alert && !row.alerts.includes(filters.alert)) return false;
    if (
      filters.responsibleArea &&
      String(row.responsibleArea ?? "").toUpperCase() !==
        filters.responsibleArea.toUpperCase()
    ) {
      return false;
    }

    const value = row.valueForStage;
    if (filters.minValue != null && value < filters.minValue) return false;
    if (filters.maxValue != null && value > filters.maxValue) return false;

    if (filters.dateAxis && (filters.dateFrom || filters.dateTo)) {
      const axisDate = row.axisDates[filters.dateAxis] ?? null;
      if (!axisDate) return false;
      const d = axisDate.slice(0, 10);
      if (filters.dateFrom && d < filters.dateFrom) return false;
      if (filters.dateTo && d > filters.dateTo) return false;
    }

    return true;
  });
}

export function toOrderToCashFunnelListRow(
  row: OrderToCashFunnelEnrichedRow
): OrderToCashFunnelListRow {
  return {
    salesOrderId: row.orderId,
    orderCode: row.orderCode,
    customerName: row.customerName,
    sellerName: row.sellerName,
    issueDate: row.issueDate,
    expectedDeliveryDate: row.expectedDeliveryDate,
    orderValue: row.orderValue,
    funnelStage: row.funnelStage,
    funnelStageLabel: row.funnelStageLabel,
    stageGroup: row.stageGroup,
    temperature: row.temperature,
    confidenceScore: row.confidenceScore,
    confidenceLabel: row.confidenceLabel,
    financialStatus: row.financialStatus,
    operationalStatus: row.operationalStatus,
    fulfillmentPercent: row.fulfillmentPercent,
    alerts: [...row.alerts],
    actionRecommendation: row.actionRecommendation,
    responsibleArea: row.responsibleArea,
    evidenceSource: row.evidenceSource,
    forecastDate: row.forecastDate,
    forecastValue: row.forecastValue,
    lastEvidenceDate: row.lastEvidenceDate,
  };
}

export function buildOrderToCashFunnelListPayload(args: {
  filters: OrderToCashFunnelFilters;
  enrichedRows: readonly OrderToCashFunnelEnrichedRow[];
  dataFreshness: OrderToCashFunnelDataFreshness;
  warnings?: string[];
}): {
  ok: true;
  message: string | null;
  filters: OrderToCashFunnelFilters;
  summaryCards: SalesOrderToCashFunnelAnalytics["summaryCards"];
  funnelStages: SalesOrderToCashFunnelAnalytics["funnelStages"];
  stageGroups: SalesOrderToCashFunnelAnalytics["stageGroups"];
  temperatureSummary: SalesOrderToCashFunnelAnalytics["temperatureSummary"];
  riskSummary: SalesOrderToCashFunnelAnalytics["riskSummary"];
  sellerSummary: SalesOrderToCashFunnelAnalytics["sellerSummary"];
  customerSummary: SalesOrderToCashFunnelAnalytics["customerSummary"];
  conversionMetrics: SalesOrderToCashFunnelAnalytics["conversionMetrics"];
  agingMetrics: SalesOrderToCashFunnelAnalytics["agingMetrics"];
  recommendedActions: SalesOrderToCashFunnelAnalytics["recommendedActions"];
  rows: OrderToCashFunnelListRow[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
  dataFreshness: OrderToCashFunnelDataFreshness;
  warnings: string[];
  totals: SalesOrderToCashFunnelAnalytics["totals"];
} {
  const filtered = filterOrderToCashFunnelRows(args.enrichedRows, args.filters);
  const analytics = buildSalesOrderToCashFunnelAnalytics({ rows: filtered });

  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / args.filters.pageSize));
  const page = Math.min(args.filters.page, totalPages);
  const start = (page - 1) * args.filters.pageSize;
  const pageRows = filtered.slice(start, start + args.filters.pageSize).map(toOrderToCashFunnelListRow);

  return {
    ok: true,
    message: null,
    filters: { ...args.filters, page },
    summaryCards: analytics.summaryCards,
    funnelStages: analytics.funnelStages,
    stageGroups: analytics.stageGroups,
    temperatureSummary: analytics.temperatureSummary,
    riskSummary: analytics.riskSummary,
    sellerSummary: analytics.sellerSummary,
    customerSummary: analytics.customerSummary,
    conversionMetrics: analytics.conversionMetrics,
    agingMetrics: analytics.agingMetrics,
    recommendedActions: analytics.recommendedActions,
    rows: pageRows,
    pagination: {
      page,
      pageSize: args.filters.pageSize,
      totalItems,
      totalPages,
    },
    dataFreshness: args.dataFreshness,
    warnings: [...(args.warnings ?? []), ...args.dataFreshness.warnings],
    totals: analytics.totals,
  };
}

export type OrderToCashFunnelDetailPayload = {
  ok: boolean;
  message: string | null;
  order: {
    salesOrderId: string;
    orderCode: string | null;
    customerName: string | null;
    sellerName: string | null;
    issueDate: string | null;
    expectedDeliveryDate: string | null;
    orderValue: number;
    status: string | null;
    companyName: string | null;
  } | null;
  classification: {
    funnelStage: SalesOrderToCashFunnelStage;
    funnelStageLabel: string;
    stageGroup: SalesOrderToCashStageGroup;
    temperature: SalesOrderToCashTemperature;
    confidenceScore: number;
    confidenceLabel: SalesOrderToCashConfidenceLabel;
    valueForStage: number;
    evidenceSource: string;
    alerts: SalesOrderToCashAlert[];
    actionRecommendation: string;
    responsibleArea: string;
    explanation: string;
  } | null;
  fulfillmentMap: Record<string, unknown> | null;
  timeline: Array<{
    at: string | null;
    kind: string;
    label: string;
    detail: string | null;
  }>;
  documents: Array<{
    stockDocumentExternalId: number | null;
    nfeExternalId: number | null;
    nfeNumber: string | null;
    date: string | null;
  }>;
  nfes: Array<{
    nfeExternalId: number | null;
    nfeNumber: string | null;
    processedAt: string | null;
    headerValue: number | null;
  }>;
  receivables: Array<{
    receivableId: number | null;
    dueDate: string | null;
    settlementDate: string | null;
    totalValue: number | null;
    receivedValue: number | null;
    openValue: number | null;
  }>;
  freshness: OrderToCashFunnelDataFreshness | null;
  executiveConclusion: string | null;
  warnings: string[];
};

export function buildOrderToCashFunnelDetailPayload(args: {
  salesOrderId: string;
  enrichedRow: OrderToCashFunnelEnrichedRow | null;
  fulfillmentMap: Record<string, unknown> | null;
  timeline: OrderToCashFunnelDetailPayload["timeline"];
  documents: OrderToCashFunnelDetailPayload["documents"];
  nfes: OrderToCashFunnelDetailPayload["nfes"];
  receivables: OrderToCashFunnelDetailPayload["receivables"];
  freshness: OrderToCashFunnelDataFreshness | null;
  executiveConclusion: string | null;
  orderStatus?: string | null;
  warnings?: string[];
}): OrderToCashFunnelDetailPayload {
  if (!args.enrichedRow) {
    return {
      ok: false,
      message: "Pedido não encontrado no Funil Pedido → Caixa.",
      order: null,
      classification: null,
      fulfillmentMap: null,
      timeline: [],
      documents: [],
      nfes: [],
      receivables: [],
      freshness: args.freshness,
      executiveConclusion: null,
      warnings: args.warnings ?? [],
    };
  }

  const row = args.enrichedRow;
  return {
    ok: true,
    message: null,
    order: {
      salesOrderId: row.orderId,
      orderCode: row.orderCode,
      customerName: row.customerName,
      sellerName: row.sellerName,
      issueDate: row.issueDate,
      expectedDeliveryDate: row.expectedDeliveryDate,
      orderValue: row.orderValue,
      status: args.orderStatus ?? null,
      companyName: row.companyName,
    },
    classification: {
      funnelStage: row.funnelStage,
      funnelStageLabel: row.funnelStageLabel,
      stageGroup: row.stageGroup,
      temperature: row.temperature,
      confidenceScore: row.confidenceScore,
      confidenceLabel: row.confidenceLabel,
      valueForStage: row.valueForStage,
      evidenceSource: row.evidenceSource,
      alerts: [...row.alerts],
      actionRecommendation: row.actionRecommendation,
      responsibleArea: row.responsibleArea,
      explanation: row.explanation,
    },
    fulfillmentMap: args.fulfillmentMap,
    timeline: args.timeline,
    documents: args.documents,
    nfes: args.nfes,
    receivables: args.receivables,
    freshness: args.freshness,
    executiveConclusion: args.executiveConclusion,
    warnings: args.warnings ?? [],
  };
}

/** Permissões de leitura do Funil Pedido → Caixa (OR). */
export const ORDER_TO_CASH_FUNNEL_VIEW_PERMISSIONS = [
  "sales_orders.view",
  "reports.view",
  "finance.view",
  "finance.accountsReceivable.view",
] as const;

export function canViewOrderToCashFunnel(auth: {
  hasPermission?: (p: string) => boolean;
  hasAnyPermission?: (ps: readonly string[]) => boolean;
}): boolean {
  if (typeof auth.hasAnyPermission === "function") {
    return auth.hasAnyPermission([...ORDER_TO_CASH_FUNNEL_VIEW_PERMISSIONS]);
  }
  if (typeof auth.hasPermission === "function") {
    return ORDER_TO_CASH_FUNNEL_VIEW_PERMISSIONS.some((p) => auth.hasPermission!(p));
  }
  return false;
}
