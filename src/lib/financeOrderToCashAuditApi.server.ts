/**
 * Loaders Prisma read-only — OrderToCashAuditFact / Run.
 * Não recalcula; só consulta fatos materializados.
 */

import { prisma } from "@/src/lib/prisma.js";
import type { Prisma } from "@prisma/client";
import {
  ORDER_TO_CASH_AUDIT_CUSTOMER_EXTERNAL_REQUIRED,
  ORDER_TO_CASH_AUDIT_NO_RUN_MESSAGE,
  buildOrderToCashAuditFactDetailPayload,
  buildOrderToCashAuditFactWhere,
  buildOrderToCashAuditListPayload,
  buildOrderToCashAuditPrismaOrderBy,
  decideOrderToCashAuditRunPolicy,
  orderToCashAuditHasFactScopeFilters,
  parseOrderToCashAuditListFilters,
  type OrderToCashAuditFactRecord,
  type OrderToCashAuditListFilters,
  type OrderToCashAuditRunMeta,
} from "./finance/orderToCashAuditApi.js";

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

type FactRow = {
  id: string;
  runId: string;
  orderCode: string | null;
  orderIssueDate: Date | null;
  orderExpectedDeliveryDate: Date | null;
  orderNetValue: unknown;
  customerId: string | null;
  customerName: string | null;
  externalCustomerId: number | null;
  sellerName: string | null;
  sellerQualityStatus: string | null;
  productCode: string | null;
  sku: string | null;
  productName: string | null;
  orderedQuantity: unknown;
  orderUnitPrice: unknown;
  orderItemTotalValue: unknown;
  stockDocumentId: string | null;
  stockDocumentExternalId: number | null;
  stockDocumentDate: Date | null;
  stockDocumentItemQuantity: unknown;
  quantityUsedForOrder: unknown;
  excessQuantity: unknown;
  outsideOrderQuantity: unknown;
  allocatedValueByOrderPrice: unknown;
  nfeNumber: string | null;
  nfeIssueDate: Date | null;
  nfeHeaderValue: unknown;
  receivableTotalValue: unknown;
  receivableOpenValue: unknown;
  receivableReceivedValue: unknown;
  paymentDueDate: Date | null;
  paymentSettlementDate: Date | null;
  paymentStatus: string | null;
  operationalStage: string | null;
  financialStage: string | null;
  orderToCashStage: string | null;
  temperature: string | null;
  confidenceScore: unknown;
  confidenceLabel: string | null;
  responsibleArea: string | null;
  recommendedAction: string | null;
  alertsJson: unknown;
  blockingReasonsJson: unknown;
  hasDeliveryDelay: boolean;
  hasMissingStockDocument: boolean;
  hasPartialFulfillment: boolean;
  hasFullFulfillment: boolean;
  hasExcessQuantity: boolean;
  hasProductOutsideOrder: boolean;
  hasNfeHeaderGreaterThanOrder: boolean;
  hasPriceMismatch: boolean;
  hasDocumentWithoutReceivable: boolean;
  hasOverdueReceivable: boolean;
  salesOrderId: string | null;
};

const FACT_SELECT = {
  id: true,
  runId: true,
  orderCode: true,
  orderIssueDate: true,
  orderExpectedDeliveryDate: true,
  orderNetValue: true,
  customerId: true,
  customerName: true,
  externalCustomerId: true,
  sellerName: true,
  sellerQualityStatus: true,
  productCode: true,
  sku: true,
  productName: true,
  orderedQuantity: true,
  orderUnitPrice: true,
  orderItemTotalValue: true,
  stockDocumentId: true,
  stockDocumentExternalId: true,
  stockDocumentDate: true,
  stockDocumentItemQuantity: true,
  quantityUsedForOrder: true,
  excessQuantity: true,
  outsideOrderQuantity: true,
  allocatedValueByOrderPrice: true,
  nfeNumber: true,
  nfeIssueDate: true,
  nfeHeaderValue: true,
  receivableTotalValue: true,
  receivableOpenValue: true,
  receivableReceivedValue: true,
  paymentDueDate: true,
  paymentSettlementDate: true,
  paymentStatus: true,
  operationalStage: true,
  financialStage: true,
  orderToCashStage: true,
  temperature: true,
  confidenceScore: true,
  confidenceLabel: true,
  responsibleArea: true,
  recommendedAction: true,
  alertsJson: true,
  blockingReasonsJson: true,
  hasDeliveryDelay: true,
  hasMissingStockDocument: true,
  hasPartialFulfillment: true,
  hasFullFulfillment: true,
  hasExcessQuantity: true,
  hasProductOutsideOrder: true,
  hasNfeHeaderGreaterThanOrder: true,
  hasPriceMismatch: true,
  hasDocumentWithoutReceivable: true,
  hasOverdueReceivable: true,
  salesOrderId: true,
} as const;

type RunRow = {
  id: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  status: string;
  mode: string;
  year: number | null;
  customerFilter: string | null;
  periodFrom: Date | null;
  periodTo: Date | null;
  totalOrders: number;
  totalFacts: number;
  totalOrderValue: unknown;
  totalAllocatedValue: unknown;
  totalReceivableValue: unknown;
  totalReceivedValue: unknown;
  totalOpenValue: unknown;
  totalBlockedValue: unknown;
  createdAt: Date;
};

function mapFact(row: FactRow): OrderToCashAuditFactRecord {
  return {
    id: row.id,
    runId: row.runId,
    orderCode: row.orderCode,
    orderIssueDate: row.orderIssueDate,
    orderExpectedDeliveryDate: row.orderExpectedDeliveryDate,
    orderNetValue: decimalToNumber(row.orderNetValue),
    customerId: row.customerId,
    customerName: row.customerName,
    externalCustomerId: row.externalCustomerId,
    sellerName: row.sellerName,
    sellerQualityStatus: row.sellerQualityStatus,
    productCode: row.productCode,
    sku: row.sku,
    productName: row.productName,
    orderedQuantity: decimalToNumber(row.orderedQuantity),
    orderUnitPrice: decimalToNumber(row.orderUnitPrice),
    orderItemTotalValue: decimalToNumber(row.orderItemTotalValue),
    stockDocumentId: row.stockDocumentId,
    stockDocumentExternalId: row.stockDocumentExternalId,
    stockDocumentDate: row.stockDocumentDate,
    stockDocumentItemQuantity: decimalToNumber(row.stockDocumentItemQuantity),
    quantityUsedForOrder: decimalToNumber(row.quantityUsedForOrder),
    excessQuantity: decimalToNumber(row.excessQuantity),
    outsideOrderQuantity: decimalToNumber(row.outsideOrderQuantity),
    allocatedValueByOrderPrice: decimalToNumber(row.allocatedValueByOrderPrice),
    nfeNumber: row.nfeNumber,
    nfeIssueDate: row.nfeIssueDate,
    nfeHeaderValue: decimalToNumber(row.nfeHeaderValue),
    receivableTotalValue: decimalToNumber(row.receivableTotalValue),
    receivableOpenValue: decimalToNumber(row.receivableOpenValue),
    receivableReceivedValue: decimalToNumber(row.receivableReceivedValue),
    paymentDueDate: row.paymentDueDate,
    paymentSettlementDate: row.paymentSettlementDate,
    paymentStatus: row.paymentStatus,
    operationalStage: row.operationalStage,
    financialStage: row.financialStage,
    orderToCashStage: row.orderToCashStage,
    temperature: row.temperature,
    confidenceScore: decimalToNumber(row.confidenceScore),
    confidenceLabel: row.confidenceLabel,
    responsibleArea: row.responsibleArea,
    recommendedAction: row.recommendedAction,
    alertsJson: row.alertsJson,
    blockingReasonsJson: row.blockingReasonsJson,
    hasDeliveryDelay: row.hasDeliveryDelay,
    hasMissingStockDocument: row.hasMissingStockDocument,
    hasPartialFulfillment: row.hasPartialFulfillment,
    hasFullFulfillment: row.hasFullFulfillment,
    hasExcessQuantity: row.hasExcessQuantity,
    hasProductOutsideOrder: row.hasProductOutsideOrder,
    hasNfeHeaderGreaterThanOrder: row.hasNfeHeaderGreaterThanOrder,
    hasPriceMismatch: row.hasPriceMismatch,
    hasDocumentWithoutReceivable: row.hasDocumentWithoutReceivable,
    hasOverdueReceivable: row.hasOverdueReceivable,
    salesOrderId: row.salesOrderId,
  };
}

function serializeRun(run: RunRow): OrderToCashAuditRunMeta {
  const isGeneralRun = run.customerFilter == null || String(run.customerFilter).trim() === "";
  return {
    runId: run.id,
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    status: run.status,
    mode: run.mode,
    year: run.year,
    customerFilter: run.customerFilter,
    periodFrom: run.periodFrom?.toISOString() ?? null,
    periodTo: run.periodTo?.toISOString() ?? null,
    totalOrders: run.totalOrders,
    totalFacts: run.totalFacts,
    totalOrderValue: decimalToNumber(run.totalOrderValue),
    totalAllocatedValue: decimalToNumber(run.totalAllocatedValue),
    totalReceivableValue: decimalToNumber(run.totalReceivableValue),
    totalReceivedValue: decimalToNumber(run.totalReceivedValue),
    totalOpenValue: decimalToNumber(run.totalOpenValue),
    totalBlockedValue: decimalToNumber(run.totalBlockedValue),
    createdAt: run.createdAt?.toISOString() ?? null,
    isGeneralRun,
  };
}

/**
 * Resolve customerId interno → externalCustomerId via SalesOrder.
 * Nunca usa customerId como filtro de Fact.
 */
async function resolveExternalCustomerIdFromInternal(
  customerId: string
): Promise<number | null> {
  const order = await prisma.salesOrder.findFirst({
    where: {
      customerId,
      externalCustomerId: { not: null },
    },
    orderBy: [{ issueDate: "desc" }],
    select: { externalCustomerId: true },
  });
  return order?.externalCustomerId ?? null;
}

async function findSpecificSuccessRunId(
  customerExternalId: number,
  year: number
): Promise<string | null> {
  const run = await prisma.orderToCashAuditRun.findFirst({
    where: {
      status: "SUCCESS",
      year,
      customerFilter: String(customerExternalId),
    },
    orderBy: [{ createdAt: "desc" }],
    select: { id: true },
  });
  return run?.id ?? null;
}

async function findLatestGeneralSuccessRunId(): Promise<string | null> {
  const run = await prisma.orderToCashAuditRun.findFirst({
    where: {
      status: "SUCCESS",
      customerFilter: null,
    },
    orderBy: [{ createdAt: "desc" }],
    select: { id: true },
  });
  return run?.id ?? null;
}

async function resolveOrderToCashAuditRun(
  filters: OrderToCashAuditListFilters
): Promise<{ runId: string; run: OrderToCashAuditRunMeta; kind: string } | null> {
  let specificRunId: string | null = null;
  if (filters.customerExternalId != null && filters.year != null && !filters.runId) {
    specificRunId = await findSpecificSuccessRunId(
      filters.customerExternalId,
      filters.year
    );
  }

  const generalRunId = filters.runId
    ? null
    : await findLatestGeneralSuccessRunId();

  const decision = decideOrderToCashAuditRunPolicy({
    runId: filters.runId,
    customerExternalId: filters.customerExternalId,
    year: filters.year,
    specificRunId,
    generalRunId,
  });

  if (!decision.runId) return null;

  const run = await prisma.orderToCashAuditRun.findUnique({
    where: { id: decision.runId },
  });
  if (!run || run.status !== "SUCCESS") return null;

  return {
    runId: run.id,
    run: serializeRun(run as RunRow),
    kind: decision.kind,
  };
}

export async function loadOrderToCashAuditList(query: Record<string, unknown>) {
  let filters = parseOrderToCashAuditListFilters(query);

  // UUID interno → código Nomus (nunca filtra Fact por customerId)
  if (filters.customerExternalId == null && filters.customerId) {
    const resolved = await resolveExternalCustomerIdFromInternal(filters.customerId);
    if (resolved == null && !filters.customerName) {
      return buildOrderToCashAuditListPayload({
        filters,
        run: null,
        pageRows: [],
        summaryFacts: [],
        totalRows: 0,
        message: ORDER_TO_CASH_AUDIT_CUSTOMER_EXTERNAL_REQUIRED,
      });
    }
    if (resolved != null) {
      filters = { ...filters, customerExternalId: resolved };
    }
  }

  const resolved = await resolveOrderToCashAuditRun(filters);

  if (!resolved) {
    return buildOrderToCashAuditListPayload({
      filters,
      run: null,
      pageRows: [],
      summaryFacts: [],
      totalRows: 0,
      message: ORDER_TO_CASH_AUDIT_NO_RUN_MESSAGE,
    });
  }

  const isGeneralRun = resolved.run.isGeneralRun;
  const where = buildOrderToCashAuditFactWhere(filters, resolved.runId, {
    isGeneralRun,
    applyYearOnIssueDate: isGeneralRun,
  }) as Prisma.OrderToCashAuditFactWhereInput;

  const orderBy = buildOrderToCashAuditPrismaOrderBy(
    filters.sortBy,
    filters.sortDirection
  ) as Prisma.OrderToCashAuditFactOrderByWithRelationInput[];

  const hasScope = orderToCashAuditHasFactScopeFilters(filters);
  const preferRunTotals = !hasScope;

  const [totalRows, pageRowsRaw, summaryRowsRaw] = await Promise.all([
    prisma.orderToCashAuditFact.count({ where }),
    prisma.orderToCashAuditFact.findMany({
      where,
      select: FACT_SELECT,
      orderBy,
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    preferRunTotals
      ? Promise.resolve([] as FactRow[])
      : prisma.orderToCashAuditFact.findMany({
          where,
          select: FACT_SELECT,
          orderBy: [{ id: "asc" }],
        }),
  ]);

  return buildOrderToCashAuditListPayload({
    filters,
    run: resolved.run,
    pageRows: pageRowsRaw.map((row) => mapFact(row as FactRow)),
    summaryFacts: summaryRowsRaw.map((row) => mapFact(row as FactRow)),
    totalRows,
    preferRunTotals,
  });
}

export async function listOrderToCashAuditRuns(limit = 50) {
  const safeLimit = Math.min(Math.max(1, limit), 100);
  const runs = await prisma.orderToCashAuditRun.findMany({
    orderBy: [{ createdAt: "desc" }],
    take: safeLimit,
  });
  return {
    ok: true as const,
    runs: runs.map((run) => serializeRun(run as RunRow)),
  };
}

export async function loadOrderToCashAuditFactById(factId: string) {
  const row = await prisma.orderToCashAuditFact.findUnique({
    where: { id: factId },
    select: FACT_SELECT,
  });
  if (!row) {
    return {
      ok: false as const,
      message: "Fato de auditoria Pedido → Caixa não encontrado.",
      row: null,
      run: null,
      detail: null,
    };
  }
  const run = await prisma.orderToCashAuditRun.findUnique({
    where: { id: row.runId },
  });
  return buildOrderToCashAuditFactDetailPayload(
    mapFact(row as FactRow),
    run ? serializeRun(run as RunRow) : null
  );
}
