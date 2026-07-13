/**
 * Loaders Prisma read-only — Status Pedidos (agregação por Pedido de Venda).
 * Fonte: OrderToCashAuditRun / OrderToCashAuditFact. Não recalcula regras.
 */

import { prisma } from "@/src/lib/prisma.js";
import type { Prisma } from "@prisma/client";
import {
  ORDER_TO_CASH_AUDIT_CUSTOMER_EXTERNAL_REQUIRED,
  ORDER_TO_CASH_AUDIT_NO_RUN_MESSAGE,
  buildOrderToCashAuditFactWhere,
  decideOrderToCashAuditRunPolicy,
  parseOrderToCashAuditListFilters,
  type OrderToCashAuditFactRecord,
  type OrderToCashAuditListFilters,
  type OrderToCashAuditRunMeta,
} from "./finance/orderToCashAuditApi.js";
import {
  OrderStatusPedidosApiParseError,
  aggregateFactsToOrderStatusRows,
  buildOrderStatusPedidosDetailPayload,
  buildOrderStatusPedidosListPayload,
  filterOrderStatusPedidosRows,
  paginateOrderStatusPedidosRows,
  resolveOrderStatusPedidosSort,
  sortOrderStatusPedidosRows,
  type OrderStatusPedidosStatus,
} from "./finance/orderStatusPedidosApi.js";

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
  lineType: true,
  orderedQuantity: true,
  orderUnitPrice: true,
  orderItemTotalValue: true,
  stockDocumentId: true,
  stockDocumentExternalId: true,
  stockDocumentDate: true,
  stockDocumentItemQuantity: true,
  stockDocumentItemUnitValue: true,
  stockDocumentItemTotalValue: true,
  quantityUsedForOrder: true,
  excessQuantity: true,
  outsideOrderQuantity: true,
  allocatedValueByOrderPrice: true,
  allocatedValueByDocumentPrice: true,
  nfeNumber: true,
  nfeIssueDate: true,
  nfeHeaderValue: true,
  nfeItemQuantity: true,
  nfeItemUnitValue: true,
  nfeItemTotalValue: true,
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

type FactRow = Record<string, unknown> & {
  id: string;
  runId: string;
  orderCode: string | null;
  orderIssueDate: Date | null;
  orderExpectedDeliveryDate: Date | null;
  customerId: string | null;
  customerName: string | null;
  externalCustomerId: number | null;
  sellerName: string | null;
  sellerQualityStatus: string | null;
  productCode: string | null;
  sku: string | null;
  productName: string | null;
  lineType: string | null;
  stockDocumentId: string | null;
  stockDocumentExternalId: number | null;
  stockDocumentDate: Date | null;
  nfeNumber: string | null;
  nfeIssueDate: Date | null;
  paymentDueDate: Date | null;
  paymentSettlementDate: Date | null;
  paymentStatus: string | null;
  operationalStage: string | null;
  financialStage: string | null;
  orderToCashStage: string | null;
  temperature: string | null;
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
    lineType: row.lineType,
    orderedQuantity: decimalToNumber(row.orderedQuantity),
    orderUnitPrice: decimalToNumber(row.orderUnitPrice),
    orderItemTotalValue: decimalToNumber(row.orderItemTotalValue),
    stockDocumentId: row.stockDocumentId,
    stockDocumentExternalId: row.stockDocumentExternalId,
    stockDocumentDate: row.stockDocumentDate,
    stockDocumentItemQuantity: decimalToNumber(row.stockDocumentItemQuantity),
    stockDocumentItemUnitValue: decimalToNumber(row.stockDocumentItemUnitValue),
    stockDocumentItemTotalValue: decimalToNumber(row.stockDocumentItemTotalValue),
    quantityUsedForOrder: decimalToNumber(row.quantityUsedForOrder),
    excessQuantity: decimalToNumber(row.excessQuantity),
    outsideOrderQuantity: decimalToNumber(row.outsideOrderQuantity),
    allocatedValueByOrderPrice: decimalToNumber(row.allocatedValueByOrderPrice),
    allocatedValueByDocumentPrice: decimalToNumber(row.allocatedValueByDocumentPrice),
    nfeNumber: row.nfeNumber,
    nfeIssueDate: row.nfeIssueDate,
    nfeHeaderValue: decimalToNumber(row.nfeHeaderValue),
    nfeItemQuantity: decimalToNumber(row.nfeItemQuantity),
    nfeItemUnitValue: decimalToNumber(row.nfeItemUnitValue),
    nfeItemTotalValue: decimalToNumber(row.nfeItemTotalValue),
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
  const isGeneralRun =
    run.customerFilter == null || String(run.customerFilter).trim() === "";
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

async function resolveExternalCustomerIdFromInternal(
  customerId: string
): Promise<number | null> {
  const order = await prisma.salesOrder.findFirst({
    where: { customerId, externalCustomerId: { not: null } },
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
    where: { status: "SUCCESS", customerFilter: null },
    orderBy: [{ createdAt: "desc" }],
    select: { id: true },
  });
  return run?.id ?? null;
}

async function resolveRun(
  filters: OrderToCashAuditListFilters
): Promise<{ runId: string; run: OrderToCashAuditRunMeta } | null> {
  let specificRunId: string | null = null;
  if (filters.customerExternalId != null && filters.year != null && !filters.runId) {
    specificRunId = await findSpecificSuccessRunId(
      filters.customerExternalId,
      filters.year
    );
  }
  const generalRunId = filters.runId ? null : await findLatestGeneralSuccessRunId();
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
  return { runId: run.id, run: serializeRun(run as RunRow) };
}

function parseOrderStatusExtraFilters(query: Record<string, unknown>): {
  orderStatus: OrderStatusPedidosStatus | null;
  onlyWithPendingItems: boolean;
  onlyWithOpenCr: boolean;
  onlyWithDivergences: boolean;
  onlyWithAlerts: boolean;
} {
  const raw = String(query.orderStatus ?? "").trim().toUpperCase();
  const allowed: OrderStatusPedidosStatus[] = [
    "RECEBIDO",
    "CR_ABERTO",
    "PARCIAL",
    "SEM_ATENDIMENTO",
    "DIVERGENCIA",
    "BLOQUEADO",
  ];
  const orderStatus =
    raw && (allowed as string[]).includes(raw)
      ? (raw as OrderStatusPedidosStatus)
      : raw
        ? (() => {
            throw new OrderStatusPedidosApiParseError(`orderStatus inválido: ${raw}`);
          })()
        : null;

  const asBool = (v: unknown) =>
    v === true ||
    v === 1 ||
    v === "1" ||
    (typeof v === "string" && ["true", "yes", "on"].includes(v.trim().toLowerCase()));

  return {
    orderStatus,
    onlyWithPendingItems: asBool(query.onlyWithPendingItems),
    onlyWithOpenCr: asBool(query.onlyWithOpenCr),
    onlyWithDivergences: asBool(query.onlyWithDivergences),
    onlyWithAlerts: asBool(query.onlyWithAlerts),
  };
}

function emptyList(
  filters: OrderToCashAuditListFilters,
  message: string
) {
  return buildOrderStatusPedidosListPayload({
    filters,
    run: null,
    allOrderRows: [],
    pageRows: [],
    totalOrders: 0,
    totalPages: 1,
    message,
  });
}

export async function loadOrderStatusPedidosList(query: Record<string, unknown>) {
  const extra = parseOrderStatusExtraFilters(query);
  const sort = resolveOrderStatusPedidosSort(query.sortBy, query.sortDirection);

  // parse O2C filters com sort default (whitelist de fato ≠ sort por pedido)
  const { sortBy: _sb, sortDirection: _sd, ...restQuery } = query;
  void _sb;
  void _sd;
  let filters = parseOrderToCashAuditListFilters(restQuery);
  filters = {
    ...filters,
    // campos preservados só para eco no payload; sort real é order-level
    sortBy: "orderIssueDate",
    sortDirection: sort.sortDirection,
  };

  if (filters.customerExternalId == null && filters.customerId) {
    const resolved = await resolveExternalCustomerIdFromInternal(filters.customerId);
    if (resolved == null && !filters.customerName) {
      return emptyList(filters, ORDER_TO_CASH_AUDIT_CUSTOMER_EXTERNAL_REQUIRED);
    }
    if (resolved != null) {
      filters = { ...filters, customerExternalId: resolved };
    }
  }

  const resolved = await resolveRun(filters);
  if (!resolved) {
    return emptyList(filters, ORDER_TO_CASH_AUDIT_NO_RUN_MESSAGE);
  }

  const isGeneralRun = resolved.run.isGeneralRun;
  const where = buildOrderToCashAuditFactWhere(filters, resolved.runId, {
    isGeneralRun,
    applyYearOnIssueDate: isGeneralRun,
  }) as Prisma.OrderToCashAuditFactWhereInput;

  // Carrega facts do escopo filtrado e agrega por pedido no backend
  const rawFacts = await prisma.orderToCashAuditFact.findMany({
    where,
    select: FACT_SELECT,
  });
  const facts = rawFacts.map((r) => mapFact(r as FactRow));

  let orderRows = aggregateFactsToOrderStatusRows(facts);
  orderRows = filterOrderStatusPedidosRows(orderRows, {
    orderStatus: extra.orderStatus,
    onlyWithPendingItems: extra.onlyWithPendingItems,
    onlyWithOpenCr: extra.onlyWithOpenCr,
    onlyWithDivergences: extra.onlyWithDivergences,
    onlyWithAlerts: extra.onlyWithAlerts,
  });
  orderRows = sortOrderStatusPedidosRows(
    orderRows,
    sort.sortBy,
    sort.sortDirection
  );

  const { pageRows, totalPages } = paginateOrderStatusPedidosRows(
    orderRows,
    filters.page,
    filters.pageSize
  );

  return buildOrderStatusPedidosListPayload({
    filters,
    run: resolved.run,
    allOrderRows: orderRows,
    pageRows,
    totalOrders: orderRows.length,
    totalPages,
    message: null,
  });
}

export async function loadOrderStatusPedidosOrderDetail(
  orderKey: string,
  query: Record<string, unknown>
) {
  const key = String(orderKey ?? "").trim();
  if (!key) {
    throw new OrderStatusPedidosApiParseError("orderKey obrigatório.");
  }

  let filters = parseOrderToCashAuditListFilters(query);
  if (filters.customerExternalId == null && filters.customerId) {
    const resolved = await resolveExternalCustomerIdFromInternal(filters.customerId);
    if (resolved != null) filters = { ...filters, customerExternalId: resolved };
  }

  const resolved = await resolveRun(filters);
  if (!resolved) {
    return buildOrderStatusPedidosDetailPayload({
      run: null,
      orderFacts: [],
      message: ORDER_TO_CASH_AUDIT_NO_RUN_MESSAGE,
    });
  }

  const isGeneralRun = resolved.run.isGeneralRun;
  const baseWhere = buildOrderToCashAuditFactWhere(filters, resolved.runId, {
    isGeneralRun,
    applyYearOnIssueDate: isGeneralRun,
  }) as Prisma.OrderToCashAuditFactWhereInput;

  const orderWhere: Prisma.OrderToCashAuditFactWhereInput = key.startsWith("code:")
    ? { orderCode: key.slice("code:".length) }
    : key.startsWith("fact:")
      ? { id: key.slice("fact:".length) }
      : {
          OR: [{ salesOrderId: key }, { orderCode: key }],
        };

  const rawFacts = await prisma.orderToCashAuditFact.findMany({
    where: { AND: [baseWhere, orderWhere] },
    select: FACT_SELECT,
    orderBy: [{ productCode: "asc" }, { lineType: "asc" }],
  });

  return buildOrderStatusPedidosDetailPayload({
    run: resolved.run,
    orderFacts: rawFacts.map((r) => mapFact(r as FactRow)),
    message: rawFacts.length === 0 ? "Pedido não encontrado neste escopo." : null,
  });
}
