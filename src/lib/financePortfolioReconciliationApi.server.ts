/**
 * Loaders Prisma read-only da Conciliação de Carteira.
 * Preferência: OrderToCashAudit → adapter → contrato Portfolio.
 * Fallback: PortfolioReconciliation legado (rastreabilidade).
 * Não recalcula alocação; só lê facts materializados.
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
import {
  adaptOrderToCashAuditFactsToPortfolioFacts,
  buildEnrichmentsFromOrderToCashFacts,
  ORDER_TO_CASH_AUDIT_INTELLIGENCE_SOURCE,
  type OrderToCashAuditFactAdapterInput,
} from "./finance/orderToCashAuditToPortfolioFactsAdapter.js";
import { yearDateBounds } from "./finance/orderToCashAuditApi.js";

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

/**
 * Listagem da aba Conciliação (read-only).
 * Preferência: OrderToCashAudit → adapter → contrato Portfolio (cards/tabela).
 * Fallback: PortfolioReconciliation legado (rastreabilidade).
 */
export async function loadPortfolioReconciliationList(query: Record<string, unknown>) {
  const filters = parsePortfolioReconciliationListFilters(query);
  const o2c = await resolveOrderToCashAuditRunForIntelligence(filters.runId);

  if (o2c) {
    const o2cFacts = await loadOrderToCashAuditFactsForIntelligence(o2c.id, {
      customerExternalId: filters.customerExternalId,
      year: filters.year,
    });
    const adapted = adaptOrderToCashAuditFactsToPortfolioFacts(o2cFacts);
    const orderIds = [
      ...new Set(
        adapted.map((f) => f.salesOrderId).filter((id): id is string => id != null)
      ),
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
    for (const fact of o2cFacts) {
      if (!fact.salesOrderId || orderTotalBySalesOrderId.has(fact.salesOrderId)) continue;
      const fromFact = fact.orderNetValue ?? fact.orderTotalValue ?? null;
      if (fromFact != null) orderTotalBySalesOrderId.set(fact.salesOrderId, fromFact);
    }

    return buildListPayload({
      run: mapOrderToCashRunToPortfolioMeta(o2c),
      facts: adapted,
      filters,
      orderTotalBySalesOrderId,
      dataSource: ORDER_TO_CASH_AUDIT_INTELLIGENCE_SOURCE,
    });
  }

  const run = await resolvePortfolioReconciliationRun(filters);
  if (!run) return buildNoRunPayload();

  const facts = await loadPortfolioReconciliationFactsForRun(run.id, {
    customerExternalId: filters.customerExternalId,
  });
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
    dataSource: "portfolio_reconciliation",
  });
}

export async function loadPortfolioReconciliationOrderDetail(
  salesOrderId: string,
  query: Record<string, unknown>
) {
  const filters = parsePortfolioReconciliationListFilters(query);
  const o2c = await resolveOrderToCashAuditRunForIntelligence(filters.runId);

  if (o2c) {
    const rows = await prisma.orderToCashAuditFact.findMany({
      where: { runId: o2c.id, salesOrderId },
      orderBy: [{ salesOrderItemId: "asc" }, { id: "asc" }],
    });
    const adapted = adaptOrderToCashAuditFactsToPortfolioFacts(
      rows.map(mapO2cFactForAdapter)
    );
    if (adapted.length === 0) {
      return {
        ok: false as const,
        message: "Pedido não encontrado na auditoria Pedido → Caixa deste run.",
        detail: null,
        run: serializeRunMeta(mapOrderToCashRunToPortfolioMeta(o2c)),
      };
    }
    return {
      ok: true as const,
      message: null as string | null,
      detail: buildOrderDetailFromFacts(
        salesOrderId,
        adapted,
        mapOrderToCashRunToPortfolioMeta(o2c)
      ),
      dataSource: ORDER_TO_CASH_AUDIT_INTELLIGENCE_SOURCE,
    };
  }

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
    dataSource: "portfolio_reconciliation",
  };
}

export async function listPortfolioReconciliationRuns(limit = 50) {
  const safeLimit = Math.min(Math.max(1, limit), 100);
  const [o2cRuns, portfolioRuns] = await Promise.all([
    prisma.orderToCashAuditRun.findMany({
      where: { status: "SUCCESS" },
      orderBy: [{ createdAt: "desc" }],
      take: safeLimit,
    }),
    prisma.portfolioReconciliationRun.findMany({
      orderBy: [{ createdAt: "desc" }],
      take: safeLimit,
    }),
  ]);

  const merged = [
    ...o2cRuns.map((run) => serializeRunMeta(mapOrderToCashRunToPortfolioMeta(run))),
    ...portfolioRuns.map((run) => serializeRunMeta(mapRun(run))),
  ]
    .sort((a, b) => {
      const ta = new Date(a.finishedAt ?? a.createdAt).getTime();
      const tb = new Date(b.finishedAt ?? b.createdAt).getTime();
      return tb - ta;
    })
    .slice(0, safeLimit);

  return {
    ok: true as const,
    runs: merged,
  };
}

export async function loadPortfolioReconciliationRunSummary(runId: string) {
  const o2c = await prisma.orderToCashAuditRun.findUnique({ where: { id: runId } });
  if (o2c?.status === "SUCCESS") {
    const o2cFacts = await loadOrderToCashAuditFactsForIntelligence(o2c.id, {});
    const adapted = adaptOrderToCashAuditFactsToPortfolioFacts(o2cFacts);
    const orderIds = [
      ...new Set(
        adapted.map((f) => f.salesOrderId).filter((id): id is string => id != null)
      ),
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
    const mapped = mapOrderToCashRunToPortfolioMeta(o2c);
    const list = buildListPayload({
      run: mapped,
      facts: adapted,
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
      dataSource: ORDER_TO_CASH_AUDIT_INTELLIGENCE_SOURCE,
    });
    return {
      ok: true as const,
      message: null as string | null,
      run: list.run,
      summary: mapped.summaryJson ?? null,
      cards: list.summary,
      factCount: adapted.length,
      orderCount: list.summary.totalPedidos,
      dataSource: ORDER_TO_CASH_AUDIT_INTELLIGENCE_SOURCE,
    };
  }

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
    dataSource: "portfolio_reconciliation",
  });

  return {
    ok: true as const,
    message: null as string | null,
    run: list.run,
    summary: run.summaryJson ?? null,
    cards: list.summary,
    factCount: facts.length,
    orderCount: list.summary.totalPedidos,
    dataSource: "portfolio_reconciliation",
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
 * Preferência: OrderToCashAudit (run geral SUCCESS) → adapter → motor de maturidade.
 * Fallback: PortfolioReconciliation legado.
 */
export async function loadPortfolioIntelligenceList(query: Record<string, unknown>) {
  const filters = parsePortfolioIntelligenceFilters(query);
  const o2c = await resolveOrderToCashAuditRunForIntelligence(filters.runId);

  if (o2c) {
    const o2cFacts = await loadOrderToCashAuditFactsForIntelligence(o2c.id, {
      customerExternalId: filters.customerExternalId,
      customerId: filters.customerId,
      year: null,
    });
    const adapted = adaptOrderToCashAuditFactsToPortfolioFacts(o2cFacts);
    const fromO2c = buildEnrichmentsFromOrderToCashFacts(o2cFacts);
    const orderIds = [
      ...new Set(
        adapted.map((f) => f.salesOrderId).filter((id): id is string => id != null)
      ),
    ];
    const { orderTotalBySalesOrderId, enrichmentsBySalesOrderId } =
      await loadOrderEnrichments(orderIds);

    for (const [id, enr] of fromO2c) {
      const existing = enrichmentsBySalesOrderId.get(id);
      enrichmentsBySalesOrderId.set(id, {
        salesOrderId: id,
        sellerName: existing?.sellerName ?? enr.sellerName,
        sellerExternalId: existing?.sellerExternalId ?? enr.sellerExternalId,
        sellerId: existing?.sellerId ?? enr.sellerId,
        paymentTerms: existing?.paymentTerms ?? enr.paymentTerms,
        paymentMethod: existing?.paymentMethod ?? enr.paymentMethod,
        orderValue: existing?.orderValue ?? enr.orderValue,
        companyId: existing?.companyId ?? enr.companyId,
        updatedAt: existing?.updatedAt ?? enr.updatedAt,
      });
      if (enr.orderValue != null && !orderTotalBySalesOrderId.has(id)) {
        orderTotalBySalesOrderId.set(id, enr.orderValue);
      }
    }

    const latestO2cId = await findLatestGeneralOrderToCashAuditRunId();
    return buildPortfolioIntelligenceListPayload({
      run: mapOrderToCashRunToPortfolioMeta(o2c),
      facts: adapted,
      filters,
      orderTotalBySalesOrderId,
      enrichmentsBySalesOrderId,
      latestRunId: latestO2cId,
      dataSource: ORDER_TO_CASH_AUDIT_INTELLIGENCE_SOURCE,
    });
  }

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
      dataSource: "portfolio_reconciliation",
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
    dataSource: "portfolio_reconciliation",
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
  const o2c = await resolveOrderToCashAuditRunForIntelligence(filters.runId);

  if (o2c) {
    const rows = await prisma.orderToCashAuditFact.findMany({
      where: { runId: o2c.id, salesOrderId },
      orderBy: [{ salesOrderItemId: "asc" }, { id: "asc" }],
    });
    const o2cFacts = rows.map(mapO2cFactForAdapter);
    const facts = adaptOrderToCashAuditFactsToPortfolioFacts(o2cFacts);
    const fromO2c = buildEnrichmentsFromOrderToCashFacts(o2cFacts);
    const { orderTotalBySalesOrderId, enrichmentsBySalesOrderId } =
      await loadOrderEnrichments(salesOrderId ? [salesOrderId] : []);
    const o2cEnr = fromO2c.get(salesOrderId);
    if (o2cEnr) {
      const existing = enrichmentsBySalesOrderId.get(salesOrderId);
      enrichmentsBySalesOrderId.set(salesOrderId, {
        salesOrderId,
        sellerName: existing?.sellerName ?? o2cEnr.sellerName,
        sellerExternalId: existing?.sellerExternalId ?? o2cEnr.sellerExternalId,
        sellerId: existing?.sellerId ?? o2cEnr.sellerId,
        paymentTerms: existing?.paymentTerms ?? o2cEnr.paymentTerms,
        paymentMethod: existing?.paymentMethod ?? o2cEnr.paymentMethod,
        orderValue: existing?.orderValue ?? o2cEnr.orderValue,
        companyId: existing?.companyId ?? o2cEnr.companyId,
        updatedAt: existing?.updatedAt ?? o2cEnr.updatedAt,
      });
    }
    const latestO2cId = await findLatestGeneralOrderToCashAuditRunId();
    return buildPortfolioIntelligenceOrderDetailPayload({
      salesOrderId,
      run: mapOrderToCashRunToPortfolioMeta(o2c),
      facts,
      enrichment: enrichmentsBySalesOrderId.get(salesOrderId) ?? null,
      orderTotalBySalesOrderId,
      asOfDate: filters.asOfDate,
      latestRunId: latestO2cId,
    });
  }

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

async function findLatestGeneralOrderToCashAuditRunId(): Promise<string | null> {
  const run = await prisma.orderToCashAuditRun.findFirst({
    where: { status: "SUCCESS", customerFilter: null },
    orderBy: [{ createdAt: "desc" }],
    select: { id: true },
  });
  return run?.id ?? null;
}

async function resolveOrderToCashAuditRunForIntelligence(runId: string | null) {
  if (runId) {
    const explicit = await prisma.orderToCashAuditRun.findUnique({
      where: { id: runId },
    });
    if (explicit?.status === "SUCCESS") return explicit;
    // runId de Portfolio legado → não força O2C; deixa fallback Portfolio
    const isPortfolio = await prisma.portfolioReconciliationRun.findUnique({
      where: { id: runId },
      select: { id: true },
    });
    if (isPortfolio) return null;
  }
  return prisma.orderToCashAuditRun.findFirst({
    where: { status: "SUCCESS", customerFilter: null },
    orderBy: [{ createdAt: "desc" }],
  });
}

function mapOrderToCashRunToPortfolioMeta(run: {
  id: string;
  status: string;
  mode: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  periodFrom: Date | null;
  periodTo: Date | null;
  customerFilter: string | null;
  totalOrders: number;
  totalFacts: number;
  totalOrderValue: unknown;
  totalAllocatedValue: unknown;
  totalReceivableValue: unknown;
  totalReceivedValue: unknown;
  totalOpenValue: unknown;
  totalBlockedValue: unknown;
  createdAt: Date;
}): PortfolioReconciliationRunMeta {
  const customerExternalId =
    run.customerFilter != null && /^\d+$/.test(String(run.customerFilter).trim())
      ? Number(run.customerFilter)
      : null;
  return {
    id: run.id,
    status: run.status,
    mode: run.mode,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    fromDate: run.periodFrom,
    toDate: run.periodTo,
    customerExternalId,
    filtersJson: {
      source: ORDER_TO_CASH_AUDIT_INTELLIGENCE_SOURCE,
      customerFilter: run.customerFilter,
    },
    summaryJson: {
      source: ORDER_TO_CASH_AUDIT_INTELLIGENCE_SOURCE,
      ordersAnalyzed: run.totalOrders,
      totalOrders: run.totalOrders,
      totalFacts: run.totalFacts,
      totalOrderValue: decimalToNumber(run.totalOrderValue),
      totalAllocatedValue: decimalToNumber(run.totalAllocatedValue),
      totalReceivableValue: decimalToNumber(run.totalReceivableValue),
      totalReceivedValue: decimalToNumber(run.totalReceivedValue),
      totalOpenValue: decimalToNumber(run.totalOpenValue),
      projectedOpenBalance: decimalToNumber(run.totalOpenValue),
      totalBlockedValue: decimalToNumber(run.totalBlockedValue),
    },
    errorMessage: null,
    createdAt: run.createdAt,
    updatedAt: run.finishedAt ?? run.createdAt,
  };
}

function mapO2cFactForAdapter(row: {
  id: string;
  runId: string;
  salesOrderId: string | null;
  externalSalesOrderId: number | null;
  orderCode: string | null;
  orderIssueDate: Date | null;
  orderExpectedDeliveryDate: Date | null;
  orderNetValue: unknown;
  orderTotalValue: unknown;
  customerId: string | null;
  externalCustomerId: number | null;
  customerName: string | null;
  sellerName: string | null;
  externalSellerId: string | null;
  paymentConditionName: string | null;
  salesOrderItemId: string | null;
  externalSalesOrderItemId: number | null;
  externalProductId: number | null;
  productCode: string | null;
  sku: string | null;
  productName: string | null;
  orderedQuantity: unknown;
  orderUnitPrice: unknown;
  orderItemTotalValue: unknown;
  stockDocumentId: string | null;
  stockDocumentExternalId: number | null;
  stockDocumentItemId: string | null;
  stockDocumentDate: Date | null;
  stockDocumentItemQuantity: unknown;
  stockDocumentItemUnitValue: unknown;
  stockDocumentItemTotalValue: unknown;
  quantityUsedForOrder: unknown;
  allocatedValueByOrderPrice: unknown;
  allocatedValueByDocumentPrice: unknown;
  priceDifferenceValue: unknown;
  nfeId: string | null;
  nfeExternalId: number | null;
  nfeNumber: string | null;
  nfeSerie: string | null;
  nfeKey: string | null;
  nfeProcessedAt: Date | null;
  nfeIssueDate: Date | null;
  nfeHeaderValue: unknown;
  receivableIdsJson: unknown;
  receivableTotalValue: unknown;
  receivableOpenValue: unknown;
  receivableReceivedValue: unknown;
  receivableDueDatesJson: unknown;
  receivableSettlementDatesJson: unknown;
  paymentDueDate: Date | null;
  paymentSettlementDate: Date | null;
  orderToCashStage: string | null;
  confidenceLabel: string | null;
  alertsJson: unknown;
  hasDeliveryDelay: boolean;
  hasMissingStockDocument: boolean;
  hasPartialFulfillment: boolean;
  hasExcessQuantity: boolean;
  hasProductOutsideOrder: boolean;
  hasNfeHeaderGreaterThanOrder: boolean;
  hasPriceMismatch: boolean;
  hasDocumentWithoutReceivable: boolean;
  hasPaymentConditionMissing: boolean;
  hasOverdueReceivable: boolean;
}): OrderToCashAuditFactAdapterInput {
  return {
    id: row.id,
    runId: row.runId,
    salesOrderId: row.salesOrderId,
    externalSalesOrderId: row.externalSalesOrderId,
    orderCode: row.orderCode,
    orderIssueDate: row.orderIssueDate,
    orderExpectedDeliveryDate: row.orderExpectedDeliveryDate,
    orderNetValue: decimalToNumber(row.orderNetValue),
    orderTotalValue: decimalToNumber(row.orderTotalValue),
    customerId: row.customerId,
    externalCustomerId: row.externalCustomerId,
    customerName: row.customerName,
    sellerName: row.sellerName,
    externalSellerId: row.externalSellerId,
    paymentConditionName: row.paymentConditionName,
    salesOrderItemId: row.salesOrderItemId,
    externalSalesOrderItemId: row.externalSalesOrderItemId,
    externalProductId: row.externalProductId,
    productCode: row.productCode,
    sku: row.sku,
    productName: row.productName,
    orderedQuantity: decimalToNumber(row.orderedQuantity),
    orderUnitPrice: decimalToNumber(row.orderUnitPrice),
    orderItemTotalValue: decimalToNumber(row.orderItemTotalValue),
    stockDocumentId: row.stockDocumentId,
    stockDocumentExternalId: row.stockDocumentExternalId,
    stockDocumentItemId: row.stockDocumentItemId,
    stockDocumentDate: row.stockDocumentDate,
    stockDocumentItemQuantity: decimalToNumber(row.stockDocumentItemQuantity),
    stockDocumentItemUnitValue: decimalToNumber(row.stockDocumentItemUnitValue),
    stockDocumentItemTotalValue: decimalToNumber(row.stockDocumentItemTotalValue),
    quantityUsedForOrder: decimalToNumber(row.quantityUsedForOrder),
    allocatedValueByOrderPrice: decimalToNumber(row.allocatedValueByOrderPrice),
    allocatedValueByDocumentPrice: decimalToNumber(row.allocatedValueByDocumentPrice),
    priceDifferenceValue: decimalToNumber(row.priceDifferenceValue),
    nfeId: row.nfeId,
    nfeExternalId: row.nfeExternalId,
    nfeNumber: row.nfeNumber,
    nfeSerie: row.nfeSerie,
    nfeKey: row.nfeKey,
    nfeProcessedAt: row.nfeProcessedAt,
    nfeIssueDate: row.nfeIssueDate,
    nfeHeaderValue: decimalToNumber(row.nfeHeaderValue),
    receivableIdsJson: row.receivableIdsJson,
    receivableTotalValue: decimalToNumber(row.receivableTotalValue),
    receivableOpenValue: decimalToNumber(row.receivableOpenValue),
    receivableReceivedValue: decimalToNumber(row.receivableReceivedValue),
    receivableDueDatesJson: row.receivableDueDatesJson,
    receivableSettlementDatesJson: row.receivableSettlementDatesJson,
    paymentDueDate: row.paymentDueDate,
    paymentSettlementDate: row.paymentSettlementDate,
    orderToCashStage: row.orderToCashStage,
    confidenceLabel: row.confidenceLabel,
    alertsJson: row.alertsJson,
    hasDeliveryDelay: row.hasDeliveryDelay,
    hasMissingStockDocument: row.hasMissingStockDocument,
    hasPartialFulfillment: row.hasPartialFulfillment,
    hasExcessQuantity: row.hasExcessQuantity,
    hasProductOutsideOrder: row.hasProductOutsideOrder,
    hasNfeHeaderGreaterThanOrder: row.hasNfeHeaderGreaterThanOrder,
    hasPriceMismatch: row.hasPriceMismatch,
    hasDocumentWithoutReceivable: row.hasDocumentWithoutReceivable,
    hasPaymentConditionMissing: row.hasPaymentConditionMissing,
    hasOverdueReceivable: row.hasOverdueReceivable,
  };
}

async function loadOrderToCashAuditFactsForIntelligence(
  runId: string,
  options: {
    customerExternalId?: number | null;
    customerId?: string | null;
    year?: number | null;
  }
): Promise<OrderToCashAuditFactAdapterInput[]> {
  const and: Array<Record<string, unknown>> = [{ runId }];
  if (options.customerExternalId != null) {
    and.push({ externalCustomerId: options.customerExternalId });
  } else if (options.customerId) {
    // Nunca filtra Fact O2C por UUID; resolve via SalesOrder
    const link = await prisma.salesOrder.findFirst({
      where: { customerId: options.customerId, externalCustomerId: { not: null } },
      orderBy: [{ issueDate: "desc" }],
      select: { externalCustomerId: true },
    });
    if (link?.externalCustomerId != null) {
      and.push({ externalCustomerId: link.externalCustomerId });
    }
  }
  if (options.year != null) {
    const bounds = yearDateBounds(options.year);
    and.push({
      OR: [
        { orderIssueDate: { gte: bounds.gte, lte: bounds.lte } },
        {
          AND: [
            { orderIssueDate: null },
            { createdAt: { gte: bounds.gte, lte: bounds.lte } },
          ],
        },
      ],
    });
  }

  const rows = await prisma.orderToCashAuditFact.findMany({
    where: { AND: and },
    orderBy: [{ orderCode: "asc" }, { salesOrderItemId: "asc" }, { id: "asc" }],
  });
  return rows.map(mapO2cFactForAdapter);
}
