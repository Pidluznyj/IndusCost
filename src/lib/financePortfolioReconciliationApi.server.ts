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
  };
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
  runId: string
): Promise<PortfolioReconciliationFactApiRow[]> {
  const rows = await prisma.portfolioReconciliationFact.findMany({
    where: { runId },
    orderBy: [{ orderCode: "asc" }, { salesOrderItemId: "asc" }, { id: "asc" }],
  });
  return rows.map(mapFact);
}

export async function loadPortfolioReconciliationList(query: Record<string, unknown>) {
  const filters = parsePortfolioReconciliationListFilters(query);
  const run = await resolvePortfolioReconciliationRun(filters);
  if (!run) return buildNoRunPayload();

  const facts = await loadPortfolioReconciliationFactsForRun(run.id);
  return buildListPayload({ run, facts, filters });
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
