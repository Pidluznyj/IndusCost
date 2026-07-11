/**
 * Loaders Prisma read-only — OrderToCashAuditFact / Run.
 * Não recalcula; só consulta fatos materializados.
 */

import { prisma } from "@/src/lib/prisma.js";
import type { Prisma } from "@prisma/client";
import {
  buildOrderToCashAuditFactDetailPayload,
  buildOrderToCashAuditFactWhere,
  buildOrderToCashAuditListPayload,
  buildOrderToCashAuditPrismaOrderBy,
  parseOrderToCashAuditListFilters,
  yearDateBounds,
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

function serializeRun(run: {
  id: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  status: string;
  year: number | null;
  totalFacts: number;
  mode: string;
}): OrderToCashAuditRunMeta {
  return {
    runId: run.id,
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    status: run.status,
    year: run.year,
    totalFacts: run.totalFacts,
    mode: run.mode,
  };
}

async function resolveLatestSuccessRunId(
  filters: OrderToCashAuditListFilters
): Promise<{ runId: string; run: OrderToCashAuditRunMeta } | null> {
  if (filters.runId) {
    const run = await prisma.orderToCashAuditRun.findUnique({
      where: { id: filters.runId },
    });
    if (!run || run.status !== "SUCCESS") return null;
    return { runId: run.id, run: serializeRun(run) };
  }

  const yearBounds = yearDateBounds(filters.year);
  const customerWhere: Prisma.OrderToCashAuditFactWhereInput =
    filters.customerExternalId != null
      ? { externalCustomerId: filters.customerExternalId }
      : { customerId: filters.customerId! };

  const latest = await prisma.orderToCashAuditFact.findFirst({
    where: {
      ...customerWhere,
      run: { status: "SUCCESS" },
      OR: [
        { run: { year: filters.year } },
        { orderIssueDate: { gte: yearBounds.gte, lte: yearBounds.lte } },
      ],
    },
    orderBy: [{ createdAt: "desc" }],
    select: { runId: true },
  });

  if (!latest) return null;

  const run = await prisma.orderToCashAuditRun.findUnique({
    where: { id: latest.runId },
  });
  if (!run) return null;
  return { runId: run.id, run: serializeRun(run) };
}

export async function loadOrderToCashAuditList(query: Record<string, unknown>) {
  const filters = parseOrderToCashAuditListFilters(query);
  const resolved = await resolveLatestSuccessRunId(filters);

  if (!resolved) {
    return buildOrderToCashAuditListPayload({
      filters,
      run: null,
      pageRows: [],
      summaryFacts: [],
      totalRows: 0,
      message:
        "Nenhum run SUCCESS de auditoria Pedido → Caixa encontrado para o cliente/ano selecionados.",
    });
  }

  const where = buildOrderToCashAuditFactWhere(
    filters,
    resolved.runId
  ) as Prisma.OrderToCashAuditFactWhereInput;
  const orderBy = buildOrderToCashAuditPrismaOrderBy(
    filters.sortBy,
    filters.sortDirection
  ) as Prisma.OrderToCashAuditFactOrderByWithRelationInput[];

  const [totalRows, pageRowsRaw, summaryRowsRaw] = await Promise.all([
    prisma.orderToCashAuditFact.count({ where }),
    prisma.orderToCashAuditFact.findMany({
      where,
      select: FACT_SELECT,
      orderBy,
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    prisma.orderToCashAuditFact.findMany({
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
    runs: runs.map(serializeRun),
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
    run ? serializeRun(run) : null
  );
}
