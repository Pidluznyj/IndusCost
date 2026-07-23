/**
 * Loader Prisma read-only — GET …/order-status (Status Pedidos).
 * Fonte: OrderToCashAuditRun / Fact. Consolida via portfolioOrderStatusService.
 */

import { prisma } from "@/src/lib/prisma.js";
import type { Prisma } from "@prisma/client";
import {
  buildOrderToCashAuditFactWhere,
  buildOrderToCashAuditSpecificCustomerYearRunWhere,
  decideOrderToCashAuditRunPolicy,
  isOrderToCashAuditGeneralRunScope,
  ORDER_TO_CASH_AUDIT_GENERAL_SUCCESS_RUN_WHERE,
  yearDateBounds,
  type OrderToCashAuditFactRecord,
} from "./finance/orderToCashAuditApi.js";
import {
  PortfolioOrderStatusApiParseError,
  buildPortfolioOrderStatusListFromFacts,
  buildPortfolioOrderStatusNoRunPayload,
  parsePortfolioOrderStatusFilters,
  type PortfolioOrderStatusApiFilters,
  type PortfolioOrderStatusListPayload,
  type PortfolioOrderStatusRunMeta,
} from "./finance/portfolioOrderStatusApi.js";
import type { PortfolioOrderStatusFact } from "./finance/portfolioOrderStatusService.js";
import { enrichFactsWithOrderItemStatus } from "./finance/orderToCashFactItemStatusEnrichment.server.js";
import { loadManualCommercialOwnersForCustomers } from "./crmCustomerCommercialOwner.js";
import { filterFactsByOperationalPortfolioOrders } from "./finance/financePortfolioOperationalOrderGate.server.js";
import { normalizeOrderStatusSearch } from "./finance/portfolioOrderStatusSearch.js";

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
  hasPaymentConditionMissing: true,
  salesOrderId: true,
  salesOrderItemId: true,
  orderItemStatus: true,
  fiscalStage: true,
  commercialStage: true,
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
  hasPaymentConditionMissing: boolean;
  salesOrderId: string | null;
  fiscalStage: string | null;
  commercialStage: string | null;
};

type RunRow = {
  id: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  status: string;
  mode: string;
  year: number | null;
  customerFilter: string | null;
  sellerFilter?: string | null;
  orderFilter?: string | null;
  periodFrom: Date | null;
  periodTo: Date | null;
  totalOrders: number;
  totalFacts: number;
  createdAt: Date;
};

function mapFact(row: FactRow): PortfolioOrderStatusFact {
  const base: OrderToCashAuditFactRecord = {
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
    salesOrderItemId:
      typeof row.salesOrderItemId === "string" ? row.salesOrderItemId : null,
    orderItemStatus:
      typeof row.orderItemStatus === "string" ? row.orderItemStatus : null,
  };
  return {
    ...base,
    fiscalStage: row.fiscalStage,
    commercialStage: row.commercialStage,
    hasPaymentConditionMissing: row.hasPaymentConditionMissing,
  };
}

function toRunMeta(run: RunRow): PortfolioOrderStatusRunMeta {
  const isGeneralRun = isOrderToCashAuditGeneralRunScope(run);
  return {
    runId: run.id,
    createdAt: run.createdAt?.toISOString() ?? null,
    periodFrom: run.periodFrom?.toISOString() ?? null,
    periodTo: run.periodTo?.toISOString() ?? null,
    dataSource: "order_to_cash_audit",
    status: run.status,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    isGeneralRun,
    year: run.year,
    customerFilter: run.customerFilter,
    totalOrders: run.totalOrders,
    totalFacts: run.totalFacts,
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
    where: buildOrderToCashAuditSpecificCustomerYearRunWhere(
      customerExternalId,
      year
    ),
    orderBy: [{ createdAt: "desc" }],
    select: { id: true },
  });
  return run?.id ?? null;
}

async function findLatestGeneralSuccessRunId(): Promise<string | null> {
  const run = await prisma.orderToCashAuditRun.findFirst({
    where: ORDER_TO_CASH_AUDIT_GENERAL_SUCCESS_RUN_WHERE,
    orderBy: [{ createdAt: "desc" }],
    select: { id: true },
  });
  return run?.id ?? null;
}

async function resolveRun(filters: PortfolioOrderStatusApiFilters): Promise<{
  runId: string;
  runMeta: PortfolioOrderStatusRunMeta;
} | null> {
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
  return { runId: run.id, runMeta: toRunMeta(run as RunRow) };
}

/**
 * Busca pontual por código de pedido (orderCode / busca "02757" / "PD 02757").
 * Nesse caso não cortamos por ano de emissão — o pedido de 2024 continua
 * encontrável com Ano=2026 na UI.
 */
function isPointSalesOrderLookup(
  filters: PortfolioOrderStatusApiFilters
): boolean {
  if (filters.orderCode?.trim()) return true;
  const search = normalizeOrderStatusSearch(filters.search);
  if (!search?.usable) return false;
  if (search.kindHint === "SALES_ORDER") return true;
  // Dígitos puros (ex.: 02757) — match prioritário de pedido na busca inteligente.
  return (
    search.digitVariants.length > 0 && !/[a-zà-ü]/i.test(search.text)
  );
}

/**
 * Where de facts: run + filtros de escopo (cliente/ano/pedido/vendedor).
 * Filtros de status consolidado são aplicados após agregação.
 */
function buildFactWhere(
  filters: PortfolioOrderStatusApiFilters,
  runId: string,
  isGeneralRun: boolean
): Prisma.OrderToCashAuditFactWhereInput {
  const pointOrderLookup = isPointSalesOrderLookup(filters);
  const searchNorm = pointOrderLookup
    ? normalizeOrderStatusSearch(filters.search)
    : null;

  const base = buildOrderToCashAuditFactWhere(
    {
      customerExternalId: filters.customerExternalId,
      customerId: filters.customerId,
      customerName: filters.customerName,
      // Ano no base só quando não é lookup pontual de pedido.
      year: pointOrderLookup ? null : filters.year,
      page: 1,
      pageSize: 50,
      sortBy: "orderIssueDate",
      sortDirection: "desc",
      orderCode: filters.orderCode,
      sellerName: filters.sellerName,
      productCode: null,
      sku: null,
      nfeNumber: null,
      stockDocumentExternalId: null,
      orderToCashStage: null,
      operationalStage: filters.operationalStatus,
      financialStage: filters.financialStatus,
      paymentStatus: null,
      temperature: filters.temperature,
      confidenceLabel: null,
      hasAlerts: false,
      onlyWithExcess: false,
      onlyWithProductOutsideOrder: false,
      onlyWithoutDocument: false,
      onlyWithoutReceivable: false,
      onlyOverdue: false,
      runId: null,
    },
    runId,
    {
      isGeneralRun,
      applyYearOnIssueDate: isGeneralRun && !pointOrderLookup,
    }
  ) as Prisma.OrderToCashAuditFactWhereInput;

  const and: Prisma.OrderToCashAuditFactWhereInput[] = [base];

  // Narrow Prisma: busca "02757" → orderCode contains variantes (sem carregar o ano inteiro).
  if (
    pointOrderLookup &&
    !filters.orderCode?.trim() &&
    searchNorm &&
    searchNorm.digitVariants.length > 0
  ) {
    and.push({
      OR: searchNorm.digitVariants.map((digits) => ({
        orderCode: { contains: digits, mode: "insensitive" as const },
      })),
    });
  }

  if (filters.from || filters.to) {
    const issue: Prisma.DateTimeNullableFilter = {};
    if (filters.from) {
      const d = new Date(filters.from);
      if (!Number.isNaN(d.getTime())) issue.gte = d;
    }
    if (filters.to) {
      const d = new Date(filters.to);
      if (!Number.isNaN(d.getTime())) issue.lte = d;
    }
    if (issue.gte || issue.lte) {
      and.push({ orderIssueDate: issue });
    }
  }

  // year + from/to: se year informado e from/to ausentes, yearDateBounds já no base (run geral)
  if (
    filters.year != null &&
    !filters.from &&
    !filters.to &&
    !isGeneralRun &&
    !pointOrderLookup
  ) {
    const bounds = yearDateBounds(filters.year);
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

  return { AND: and };
}

export async function loadPortfolioOrderStatusList(
  query: Record<string, unknown>
): Promise<PortfolioOrderStatusListPayload> {
  let filters = parsePortfolioOrderStatusFilters(query);

  if (filters.customerExternalId == null && filters.customerId) {
    const resolved = await resolveExternalCustomerIdFromInternal(filters.customerId);
    if (resolved != null) {
      filters = { ...filters, customerExternalId: resolved };
    }
  }

  // responsibleName: aceito, sem campo de pessoa no Fact — não falha
  void filters.responsibleName;

  const resolved = await resolveRun(filters);
  if (!resolved) {
    return buildPortfolioOrderStatusNoRunPayload(filters);
  }

  const isGeneralRun = resolved.runMeta.isGeneralRun === true;
  const where = buildFactWhere(filters, resolved.runId, isGeneralRun);

  const rawFacts = await prisma.orderToCashAuditFact.findMany({
    where,
    select: FACT_SELECT,
  });

  const mapped = await filterFactsByOperationalPortfolioOrders(
    prisma,
    rawFacts.map((r) => mapFact(r as FactRow))
  );
  const enriched = (await enrichFactsWithOrderItemStatus(
    mapped
  )) as PortfolioOrderStatusFact[];

  // Responsável Comercial = pessoa da carteira no CRM (nunca setor / responsibleArea).
  const customerIds = [
    ...new Set(
      enriched
        .map((f) => f.customerId?.trim())
        .filter((v): v is string => Boolean(v))
    ),
  ];
  const commercialOwners = await loadManualCommercialOwnersForCustomers(customerIds);
  const facts: PortfolioOrderStatusFact[] = enriched.map((fact) => {
    const owner = fact.customerId ? commercialOwners.get(fact.customerId) : null;
    if (!owner) return fact;
    return {
      ...fact,
      commercialResponsibleName: owner.sellerCanonicalName ?? owner.sellerResponsibleName,
      commercialResponsibleId: owner.sellerIdentityKey,
    };
  });

  return buildPortfolioOrderStatusListFromFacts({
    facts,
    filters,
    runMeta: resolved.runMeta,
  });
}

export { PortfolioOrderStatusApiParseError };
