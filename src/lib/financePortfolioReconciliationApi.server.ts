/**
 * Loaders Prisma read-only da Conciliação de Carteira.
 * Não recalcula alocação; só lê Run + Fact materializados.
 */

import { prisma } from "@/src/lib/prisma.js";
import {
  buildListPayload,
  buildNoRunPayload,
  buildOrderDetailFromFacts,
  parsePortfolioReconciliationListFilters,
  serializeRunMeta,
  type PortfolioReconciliationFactApiRow,
  type PortfolioReconciliationListFilters,
  type PortfolioReconciliationRunMeta,
} from "./finance/portfolioReconciliationApi.js";
import {
  buildPortfolioIntelligenceListPayload,
  buildPortfolioIntelligenceOrderDetailPayload,
  parsePortfolioIntelligenceFilters,
} from "./finance/portfolioMaturityIntelligenceApi.js";
import type { PortfolioOrderEnrichment } from "./finance/portfolioMaturityAnalytics.js";

function decimalToNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    try {
      const n = (value as { toNumber: () => number }).toNumber();
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapFact(row: {
  id: string;
  runId: string;
  customerId: string | null;
  customerExternalId: number | null;
  customerNameSnapshot: string | null;
  salesOrderId: string | null;
  externalSalesOrderId: number | null;
  orderCode: string | null;
  orderIssueDate: Date | null;
  expectedDeliveryDate: Date | null;
  salesOrderItemId: string | null;
  externalSalesOrderItemId: number | null;
  externalProductId: number | null;
  productSkuSnapshot: string | null;
  productNameSnapshot: string | null;
  orderQuantity: unknown;
  orderUnitPrice: unknown;
  orderItemValue: unknown;
  nomusNfeId: string | null;
  nfeExternalId: number | null;
  nfeNumber: string | null;
  nfeSerie: string | null;
  nfeKey: string | null;
  nfeProcessedAt: Date | null;
  nfeHeaderValue: unknown;
  stockDocumentId: string | null;
  stockDocumentExternalId: number | null;
  stockDocumentItemId: string | null;
  stockDocumentItemExternalId: number | null;
  stockDocumentDate: Date | null;
  stockQuantity: unknown;
  stockUnitValue: unknown;
  stockItemValue: unknown;
  allocatedQuantity: unknown;
  allocatedValueByOrderPrice: unknown;
  allocatedValueByStockPrice: unknown;
  remainingOrderQuantityAfterAllocation: unknown;
  remainingOrderValueAfterAllocation: unknown;
  priceDifferenceUnit: unknown;
  priceDifferenceTotal: unknown;
  receivableIdsJson: unknown;
  receivableTotalValue: unknown;
  receivedValue: unknown;
  openReceivableValue: unknown;
  dueDatesJson: unknown;
  settlementDatesJson: unknown;
  forecastSource: string;
  forecastDate: Date | null;
  forecastValue: unknown;
  confidenceLevel: string;
  status: string | null;
  alertsJson: unknown;
  traceJson: unknown;
}): PortfolioReconciliationFactApiRow {
  return {
    id: row.id,
    runId: row.runId,
    customerId: row.customerId,
    customerExternalId: row.customerExternalId,
    customerNameSnapshot: row.customerNameSnapshot,
    salesOrderId: row.salesOrderId,
    externalSalesOrderId: row.externalSalesOrderId,
    orderCode: row.orderCode,
    orderIssueDate: row.orderIssueDate,
    expectedDeliveryDate: row.expectedDeliveryDate,
    salesOrderItemId: row.salesOrderItemId,
    externalSalesOrderItemId: row.externalSalesOrderItemId,
    externalProductId: row.externalProductId,
    productSkuSnapshot: row.productSkuSnapshot,
    productNameSnapshot: row.productNameSnapshot,
    orderQuantity: decimalToNumber(row.orderQuantity),
    orderUnitPrice: decimalToNumber(row.orderUnitPrice),
    orderItemValue: decimalToNumber(row.orderItemValue),
    nomusNfeId: row.nomusNfeId,
    nfeExternalId: row.nfeExternalId,
    nfeNumber: row.nfeNumber,
    nfeSerie: row.nfeSerie,
    nfeKey: row.nfeKey,
    nfeProcessedAt: row.nfeProcessedAt,
    nfeHeaderValue: decimalToNumber(row.nfeHeaderValue),
    stockDocumentId: row.stockDocumentId,
    stockDocumentExternalId: row.stockDocumentExternalId,
    stockDocumentItemId: row.stockDocumentItemId,
    stockDocumentItemExternalId: row.stockDocumentItemExternalId,
    stockDocumentDate: row.stockDocumentDate,
    stockQuantity: decimalToNumber(row.stockQuantity),
    stockUnitValue: decimalToNumber(row.stockUnitValue),
    stockItemValue: decimalToNumber(row.stockItemValue),
    allocatedQuantity: decimalToNumber(row.allocatedQuantity),
    allocatedValueByOrderPrice: decimalToNumber(row.allocatedValueByOrderPrice),
    allocatedValueByStockPrice: decimalToNumber(row.allocatedValueByStockPrice),
    remainingOrderQuantityAfterAllocation: decimalToNumber(
      row.remainingOrderQuantityAfterAllocation
    ),
    remainingOrderValueAfterAllocation: decimalToNumber(
      row.remainingOrderValueAfterAllocation
    ),
    priceDifferenceUnit: decimalToNumber(row.priceDifferenceUnit),
    priceDifferenceTotal: decimalToNumber(row.priceDifferenceTotal),
    receivableIdsJson: row.receivableIdsJson,
    receivableTotalValue: decimalToNumber(row.receivableTotalValue),
    receivedValue: decimalToNumber(row.receivedValue),
    openReceivableValue: decimalToNumber(row.openReceivableValue),
    dueDatesJson: row.dueDatesJson,
    settlementDatesJson: row.settlementDatesJson,
    forecastSource: row.forecastSource,
    forecastDate: row.forecastDate,
    forecastValue: decimalToNumber(row.forecastValue),
    confidenceLevel: row.confidenceLevel,
    status: row.status,
    alertsJson: row.alertsJson,
    traceJson: row.traceJson,
  };
}

function mapRun(run: {
  id: string;
  status: string;
  mode: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  fromDate: Date | null;
  toDate: Date | null;
  customerExternalId: number | null;
  filtersJson: unknown;
  summaryJson: unknown;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt?: Date | null;
}): PortfolioReconciliationRunMeta {
  return {
    id: run.id,
    status: run.status,
    mode: run.mode,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    fromDate: run.fromDate,
    toDate: run.toDate,
    customerExternalId: run.customerExternalId,
    filtersJson: run.filtersJson,
    summaryJson: run.summaryJson,
    errorMessage: run.errorMessage,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt ?? null,
  };
}

/** SUCCESS mais recente (para comparar frescor sem sync automático). */
export async function findLatestSuccessfulPortfolioReconciliationRunId(): Promise<string | null> {
  const run = await prisma.portfolioReconciliationRun.findFirst({
    where: { status: "SUCCESS" },
    orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true },
  });
  return run?.id ?? null;
}

export async function resolvePortfolioReconciliationRun(
  filters: PortfolioReconciliationListFilters
): Promise<PortfolioReconciliationRunMeta | null> {
  if (filters.runId) {
    const run = await prisma.portfolioReconciliationRun.findUnique({
      where: { id: filters.runId },
    });
    if (!run) return null;
    if (run.status !== "SUCCESS") return null;
    return mapRun(run);
  }

  const run = await prisma.portfolioReconciliationRun.findFirst({
    where: { status: "SUCCESS" },
    orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
  });
  return run ? mapRun(run) : null;
}

export async function loadPortfolioReconciliationFactsForRun(
  runId: string,
  options?: {
    customerExternalId?: number | null;
    customerId?: string | null;
  }
): Promise<PortfolioReconciliationFactApiRow[]> {
  const where: {
    runId: string;
    customerExternalId?: number;
    customerId?: string;
  } = { runId };
  if (options?.customerExternalId != null) {
    where.customerExternalId = options.customerExternalId;
  }
  if (options?.customerId != null) {
    where.customerId = options.customerId;
  }
  const rows = await prisma.portfolioReconciliationFact.findMany({
    where,
    orderBy: [{ orderCode: "asc" }, { salesOrderItemId: "asc" }, { id: "asc" }],
  });
  return rows.map(mapFact);
}

export async function loadPortfolioReconciliationList(query: Record<string, unknown>) {
  const filters = parsePortfolioReconciliationListFilters(query);
  const run = await resolvePortfolioReconciliationRun(filters);
  if (!run) return buildNoRunPayload();

  const facts = await loadPortfolioReconciliationFactsForRun(run.id);
  const orderIds = [
    ...new Set(facts.map((f) => f.salesOrderId).filter((id): id is string => id != null)),
  ];
  const orderTotalBySalesOrderId = new Map<string, number>();
  if (orderIds.length > 0) {
    const orders = await prisma.salesOrder.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, totalNetValue: true },
    });
    for (const order of orders) {
      const n = decimalToNumber(order.totalNetValue);
      if (n != null) orderTotalBySalesOrderId.set(order.id, n);
    }
  }

  return buildListPayload({
    run,
    facts,
    filters,
    orderTotalBySalesOrderId,
  });
}

export async function loadPortfolioReconciliationOrderDetail(
  salesOrderId: string,
  query: Record<string, unknown>
) {
  const filters = parsePortfolioReconciliationListFilters(query);
  const run = await resolvePortfolioReconciliationRun(filters);
  if (!run) {
    return {
      ok: false as const,
      message: buildNoRunPayload().message,
      detail: null,
    };
  }

  const facts = await prisma.portfolioReconciliationFact.findMany({
    where: { runId: run.id, salesOrderId },
    orderBy: [{ salesOrderItemId: "asc" }, { id: "asc" }],
  });

  if (facts.length === 0) {
    return {
      ok: false as const,
      message: "Pedido não encontrado na conciliação materializada deste run.",
      detail: null,
      run: serializeRunMeta(run),
    };
  }

  return {
    ok: true as const,
    message: null as string | null,
    detail: buildOrderDetailFromFacts(salesOrderId, facts.map(mapFact), run),
  };
}

export async function listPortfolioReconciliationRuns(limit = 50) {
  const safeLimit = Math.min(Math.max(1, limit), 100);
  const runs = await prisma.portfolioReconciliationRun.findMany({
    orderBy: [{ createdAt: "desc" }],
    take: safeLimit,
  });
  return {
    ok: true as const,
    runs: runs.map((run) => serializeRunMeta(mapRun(run))),
  };
}

export async function loadPortfolioReconciliationRunSummary(runId: string) {
  const run = await prisma.portfolioReconciliationRun.findUnique({
    where: { id: runId },
  });
  if (!run) {
    return {
      ok: false as const,
      message: "Run de conciliação não encontrado.",
      run: null,
      summary: null,
      cards: null,
    };
  }

  const mapped = mapRun(run);
  if (run.status !== "SUCCESS") {
    return {
      ok: true as const,
      message:
        run.status === "FAILED"
          ? run.errorMessage ?? "Run finalizado com falha."
          : `Run em status ${run.status}.`,
      run: serializeRunMeta(mapped),
      summary: run.summaryJson ?? null,
      cards: null,
    };
  }

  const facts = await loadPortfolioReconciliationFactsForRun(runId);
  const orderIds = [
    ...new Set(facts.map((f) => f.salesOrderId).filter((id): id is string => id != null)),
  ];
  const orderTotalBySalesOrderId = new Map<string, number>();
  if (orderIds.length > 0) {
    const orders = await prisma.salesOrder.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, totalNetValue: true },
    });
    for (const order of orders) {
      const n = decimalToNumber(order.totalNetValue);
      if (n != null) orderTotalBySalesOrderId.set(order.id, n);
    }
  }

  const list = buildListPayload({
    run: mapped,
    facts,
    filters: {
      runId,
      customerExternalId: null,
      year: null,
      month: null,
      orderCode: null,
      status: null,
      confidenceLevel: null,
      forecastSource: null,
      onlyIssues: false,
      page: 1,
      pageSize: 1,
    },
    orderTotalBySalesOrderId,
  });

  return {
    ok: true as const,
    message: null as string | null,
    run: list.run,
    summary: run.summaryJson ?? null,
    cards: list.summary,
    factCount: facts.length,
    orderCount: list.summary.totalPedidos,
  };
}

async function loadOrderEnrichments(orderIds: string[]) {
  const orderTotalBySalesOrderId = new Map<string, number>();
  const enrichmentsBySalesOrderId = new Map<string, PortfolioOrderEnrichment>();
  if (orderIds.length === 0) {
    return { orderTotalBySalesOrderId, enrichmentsBySalesOrderId };
  }
  const orders = await prisma.salesOrder.findMany({
    where: { id: { in: orderIds } },
    select: {
      id: true,
      totalNetValue: true,
      nomusSellerName: true,
      externalSellerId: true,
      paymentTerms: true,
      paymentMethod: true,
      externalCompanyId: true,
      updatedAt: true,
    },
  });
  for (const order of orders) {
    const n = decimalToNumber(order.totalNetValue);
    if (n != null) orderTotalBySalesOrderId.set(order.id, n);
    enrichmentsBySalesOrderId.set(order.id, {
      salesOrderId: order.id,
      orderValue: n,
      sellerName: order.nomusSellerName,
      sellerExternalId: order.externalSellerId,
      paymentTerms: order.paymentTerms,
      paymentMethod: order.paymentMethod,
      companyId:
        order.externalCompanyId != null ? String(order.externalCompanyId) : null,
      updatedAt: order.updatedAt,
    });
  }
  return { orderTotalBySalesOrderId, enrichmentsBySalesOrderId };
}

/**
 * Listagem da Central de Inteligência (read-only).
 */
export async function loadPortfolioIntelligenceList(query: Record<string, unknown>) {
  const filters = parsePortfolioIntelligenceFilters(query);
  const run = await resolvePortfolioReconciliationRun({
    runId: filters.runId ?? null,
    customerExternalId: filters.customerExternalId ?? null,
    year: null,
    month: null,
    orderCode: null,
    status: null,
    confidenceLevel: null,
    forecastSource: null,
    onlyIssues: false,
    page: 1,
    pageSize: 1,
  });
  if (!run) {
    return buildPortfolioIntelligenceListPayload({
      run: null,
      facts: [],
      filters,
    });
  }

  const latestRunId = await findLatestSuccessfulPortfolioReconciliationRunId();

  const facts = await loadPortfolioReconciliationFactsForRun(run.id, {
    customerExternalId: filters.customerExternalId,
    customerId: filters.customerId,
  });

  const orderIds = [
    ...new Set(facts.map((f) => f.salesOrderId).filter((id): id is string => id != null)),
  ];
  const { orderTotalBySalesOrderId, enrichmentsBySalesOrderId } =
    await loadOrderEnrichments(orderIds);

  return buildPortfolioIntelligenceListPayload({
    run,
    facts,
    filters,
    orderTotalBySalesOrderId,
    enrichmentsBySalesOrderId,
    latestRunId,
  });
}

/**
 * Detalhe de maturidade de um pedido (read-only).
 */
export async function loadPortfolioIntelligenceOrderDetail(
  salesOrderId: string,
  query: Record<string, unknown>
) {
  const filters = parsePortfolioIntelligenceFilters(query);
  const run = await resolvePortfolioReconciliationRun({
    runId: filters.runId ?? null,
    customerExternalId: filters.customerExternalId ?? null,
    year: null,
    month: null,
    orderCode: null,
    status: null,
    confidenceLevel: null,
    forecastSource: null,
    onlyIssues: false,
    page: 1,
    pageSize: 1,
  });
  if (!run) {
    return buildPortfolioIntelligenceOrderDetailPayload({
      salesOrderId,
      run: null,
      facts: [],
    });
  }

  const latestRunId = await findLatestSuccessfulPortfolioReconciliationRunId();

  const rows = await prisma.portfolioReconciliationFact.findMany({
    where: { runId: run.id, salesOrderId },
    orderBy: [{ salesOrderItemId: "asc" }, { id: "asc" }],
  });
  const facts = rows.map(mapFact);
  const { orderTotalBySalesOrderId, enrichmentsBySalesOrderId } =
    await loadOrderEnrichments(facts[0]?.salesOrderId ? [facts[0].salesOrderId] : []);

  return buildPortfolioIntelligenceOrderDetailPayload({
    salesOrderId,
    run,
    facts,
    enrichment: enrichmentsBySalesOrderId.get(salesOrderId) ?? null,
    orderTotalBySalesOrderId,
    asOfDate: filters.asOfDate,
    latestRunId,
  });
}
