/**
 * Client HTTP read-only — Funil Pedido → Caixa.
 * Sem Prisma, sem cálculo de estágio, sem comissão.
 */

import { fetchJsonOk } from "@/src/lib/http";

export type OrderToCashFunnelUiFilters = {
  dateFrom: string;
  dateTo: string;
  dateAxis: string;
  customerName: string;
  sellerName: string;
  funnelStage: string;
  temperature: string;
  alert: string;
  page: number;
  pageSize: number;
};

export function createDefaultOrderToCashFunnelUiFilters(): OrderToCashFunnelUiFilters {
  const year = new Date().getFullYear();
  return {
    dateFrom: `${year}-01-01`,
    dateTo: `${year}-12-31`,
    dateAxis: "ORDER_ISSUE_DATE",
    customerName: "",
    sellerName: "",
    funnelStage: "",
    temperature: "",
    alert: "",
    page: 1,
    pageSize: 50,
  };
}

export type OrderToCashFunnelSummaryCardDto = {
  key: string;
  title: string;
  value: number;
  count: number;
  percent: number | null;
  group: string;
  severity: string;
  explanation: string;
  doesNotSumPortfolio?: boolean;
};

export type OrderToCashFunnelStageDto = {
  stage: string;
  label: string;
  count: number;
  value: number;
  percentOfTotal: number | null;
  confidenceAvg: number | null;
  actionRecommendation: string;
};

export type OrderToCashFunnelListRowDto = {
  salesOrderId: string;
  orderCode: string | null;
  customerName: string | null;
  sellerName: string | null;
  issueDate: string | null;
  expectedDeliveryDate: string | null;
  orderValue: number;
  funnelStage: string;
  funnelStageLabel: string;
  stageGroup: string;
  temperature: string;
  confidenceScore: number;
  confidenceLabel: string;
  financialStatus: string | null;
  operationalStatus: string | null;
  fulfillmentPercent: number | null;
  alerts: string[];
  actionRecommendation: string;
  responsibleArea: string;
  evidenceSource: string;
  forecastDate: string | null;
  forecastValue: number | null;
  lastEvidenceDate: string | null;
};

export type OrderToCashFunnelListPayload = {
  ok: boolean;
  message: string | null;
  summaryCards: OrderToCashFunnelSummaryCardDto[];
  funnelStages: OrderToCashFunnelStageDto[];
  stageGroups: Array<{ group: string; count: number; value: number; percentOfTotal: number | null }>;
  temperatureSummary: Array<{
    temperature: string;
    count: number;
    value: number;
    percentOfTotal: number | null;
  }>;
  riskSummary: {
    valorBloqueado: number;
    valorAtrasadoSemDocumento: number;
    valorDocumentoNfSemCr: number;
    valorComExcesso: number;
    valorComProdutoForaDoPedido: number;
    note: string;
    topRisks: Array<{
      orderId: string;
      orderCode: string | null;
      funnelStage: string;
      value: number;
      reason: string;
    }>;
  };
  rows: OrderToCashFunnelListRowDto[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
  dataFreshness: {
    sourceLabel: string;
    runId: string | null;
    runFinishedAt: string | null;
    isLatestRun: boolean | null;
    lastEvidenceDate: string | null;
    warnings: string[];
    laymanNotice: string;
  } | null;
  warnings: string[];
};

export type OrderToCashFulfillmentMapDto = {
  financialStatus?: string;
  financialStatusLabel?: string;
  operationalStatus?: string;
  operationalStatusLabel?: string;
  technicalAlerts?: string[];
  fulfillmentSummary?: {
    orderValue?: number;
    attributedOrderValueByOrderPrice?: number;
    attributedOrderValue?: number;
    totalOrderedQuantity?: number;
    totalOrderQuantity?: number;
    totalAttendedQuantityCapped?: number;
    attendedQuantity?: number;
    totalRemainingQuantity?: number;
    remainingQuantity?: number;
    totalExcessQuantity?: number;
    fulfillmentPercent?: number | null;
    receivableTotalValue?: number;
    receivedValue?: number;
    openReceivableValue?: number;
    nfeHeaderTotalValue?: number;
    nfeHeaderTotal?: number;
    nfeHeaderNotAttributedToOrderValue?: number;
    nfeHeaderNotAttributed?: number;
    isFullyFulfilledByItems?: boolean;
    hasExcessQuantity?: boolean;
    hasHeaderInflationRisk?: boolean;
    hasProductsOutsideOrder?: boolean;
  };
  orderItemsCoverage?: Array<Record<string, unknown>>;
  stockDocumentsCoverage?: Array<Record<string, unknown>>;
  receivablesCoverage?: Array<Record<string, unknown>>;
  executiveConclusion?: string;
  evidenceWarnings?: string[];
};

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
    funnelStage: string;
    funnelStageLabel: string;
    stageGroup: string;
    temperature: string;
    confidenceScore: number;
    confidenceLabel: string;
    valueForStage: number;
    evidenceSource: string;
    alerts: string[];
    actionRecommendation: string;
    responsibleArea: string;
    explanation: string;
  } | null;
  fulfillmentMap: OrderToCashFulfillmentMapDto | null;
  timeline: Array<{ at: string | null; kind: string; label: string; detail: string | null }>;
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
  freshness: OrderToCashFunnelListPayload["dataFreshness"];
  executiveConclusion: string | null;
  warnings: string[];
};

function append(params: URLSearchParams, key: string, value: string | number | null | undefined) {
  if (value == null) return;
  const s = String(value).trim();
  if (!s) return;
  params.set(key, s);
}

export function buildOrderToCashFunnelListUrl(filters: OrderToCashFunnelUiFilters): string {
  const params = new URLSearchParams();
  append(params, "page", filters.page);
  append(params, "pageSize", filters.pageSize);
  append(params, "dateAxis", filters.dateAxis);
  append(params, "dateFrom", filters.dateFrom);
  append(params, "dateTo", filters.dateTo);
  append(params, "cliente", filters.customerName);
  append(params, "vendedor", filters.sellerName);
  append(params, "estagio", filters.funnelStage);
  append(params, "temperatura", filters.temperature);
  append(params, "alerta", filters.alert);
  const qs = params.toString();
  return `/api/sales/order-to-cash-funnel${qs ? `?${qs}` : ""}`;
}

export async function fetchOrderToCashFunnelList(
  filters: OrderToCashFunnelUiFilters
): Promise<OrderToCashFunnelListPayload> {
  return fetchJsonOk<OrderToCashFunnelListPayload>(buildOrderToCashFunnelListUrl(filters));
}

export async function fetchOrderToCashFunnelDetail(
  salesOrderId: string
): Promise<OrderToCashFunnelDetailPayload> {
  const id = encodeURIComponent(salesOrderId);
  return fetchJsonOk<OrderToCashFunnelDetailPayload>(
    `/api/sales/order-to-cash-funnel/orders/${id}`
  );
}
