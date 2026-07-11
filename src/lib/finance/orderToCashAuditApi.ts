/**
 * API pura read-only — OrderToCashAuditFact (aba Pedido → Caixa).
 * Parse de filtros, whitelist de sort, mapeamento de rows e payloads.
 * Sem Prisma e sem write; consulta apenas fatos materializados.
 */

export const ORDER_TO_CASH_AUDIT_CUSTOMER_YEAR_REQUIRED =
  "Selecione cliente e ano para pesquisar a auditoria Pedido → Caixa.";

export const ORDER_TO_CASH_AUDIT_DEFAULT_PAGE_SIZE = 50;
export const ORDER_TO_CASH_AUDIT_MAX_PAGE_SIZE = 200;
export const ORDER_TO_CASH_AUDIT_DEFAULT_SORT_BY = "orderIssueDate";
export const ORDER_TO_CASH_AUDIT_DEFAULT_SORT_DIRECTION = "desc";

export const ORDER_TO_CASH_AUDIT_SORT_WHITELIST = [
  "orderCode",
  "orderIssueDate",
  "orderExpectedDeliveryDate",
  "customerName",
  "sellerName",
  "productCode",
  "sku",
  "orderedQuantity",
  "orderUnitPrice",
  "orderItemTotalValue",
  "stockDocumentDate",
  "stockDocumentExternalId",
  "nfeNumber",
  "nfeIssueDate",
  "nfeHeaderValue",
  "quantityUsedForOrder",
  "excessQuantity",
  "outsideOrderQuantity",
  "allocatedValueByOrderPrice",
  "receivableTotalValue",
  "receivableOpenValue",
  "receivableReceivedValue",
  "paymentDueDate",
  "paymentSettlementDate",
  "paymentStatus",
  "operationalStage",
  "financialStage",
  "orderToCashStage",
  "temperature",
  "confidenceScore",
  "daysDeliveryDelay",
  "daysPaymentDelay",
] as const;

export type OrderToCashAuditSortBy =
  (typeof ORDER_TO_CASH_AUDIT_SORT_WHITELIST)[number];

export type OrderToCashAuditSortDirection = "asc" | "desc";

export class OrderToCashAuditApiParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderToCashAuditApiParseError";
  }
}

export type OrderToCashAuditListFilters = {
  customerExternalId: number | null;
  customerId: string | null;
  year: number;
  page: number;
  pageSize: number;
  sortBy: OrderToCashAuditSortBy;
  sortDirection: OrderToCashAuditSortDirection;
  orderCode: string | null;
  sellerName: string | null;
  productCode: string | null;
  sku: string | null;
  nfeNumber: string | null;
  stockDocumentExternalId: number | null;
  orderToCashStage: string | null;
  operationalStage: string | null;
  financialStage: string | null;
  paymentStatus: string | null;
  temperature: string | null;
  confidenceLabel: string | null;
  hasAlerts: boolean;
  onlyWithExcess: boolean;
  onlyWithProductOutsideOrder: boolean;
  onlyWithoutDocument: boolean;
  onlyWithoutReceivable: boolean;
  onlyOverdue: boolean;
  runId: string | null;
};

export type OrderToCashAuditRequiredSelection = {
  customerRequired: true;
  yearRequired: true;
  readyToSearch: boolean;
  message: string | null;
};

export type OrderToCashAuditRunMeta = {
  runId: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: string;
  year: number | null;
  totalFacts: number;
  mode: string | null;
};

export type OrderToCashAuditListRow = {
  id: string;
  runId: string;
  orderCode: string | null;
  orderIssueDate: string | null;
  orderExpectedDeliveryDate: string | null;
  customerName: string | null;
  externalCustomerId: number | null;
  sellerName: string | null;
  sellerQualityStatus: string | null;
  productCode: string | null;
  sku: string | null;
  productName: string | null;
  orderedQuantity: number | null;
  orderUnitPrice: number | null;
  orderItemTotalValue: number | null;
  stockDocumentExternalId: number | null;
  stockDocumentDate: string | null;
  stockDocumentItemQuantity: number | null;
  quantityUsedForOrder: number | null;
  excessQuantity: number | null;
  outsideOrderQuantity: number | null;
  allocatedValueByOrderPrice: number | null;
  nfeNumber: string | null;
  nfeIssueDate: string | null;
  nfeHeaderValue: number | null;
  receivableTotalValue: number | null;
  receivableOpenValue: number | null;
  receivableReceivedValue: number | null;
  paymentDueDate: string | null;
  paymentSettlementDate: string | null;
  paymentStatus: string | null;
  operationalStage: string | null;
  financialStage: string | null;
  orderToCashStage: string | null;
  temperature: string | null;
  confidenceScore: number | null;
  confidenceLabel: string | null;
  responsibleArea: string | null;
  recommendedAction: string | null;
  alerts: string[];
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
};

export type OrderToCashAuditListSummary = {
  totalRows: number;
  totalOrders: number;
  totalOrderValue: number;
  totalAllocatedValue: number;
  totalReceivableValue: number;
  totalReceivedValue: number;
  totalOpenValue: number;
  totalBlockedValue: number;
  alertCounts: Record<string, number>;
  stageCounts: Record<string, number>;
  paymentStatusCounts: Record<string, number>;
};

export type OrderToCashAuditAvailableFilters = {
  sellers: Array<{ sellerName: string; count: number }>;
  stages: Array<{ stage: string; count: number }>;
  paymentStatuses: Array<{ paymentStatus: string; count: number }>;
  products: Array<{ productCode: string | null; sku: string | null; productName: string | null; count: number }>;
  alertTypes: Array<{ alert: string; count: number }>;
};

/** Fact materializado (campos usados pela API) — números já convertidos. */
export type OrderToCashAuditFactRecord = {
  id: string;
  runId: string;
  orderCode: string | null;
  orderIssueDate: Date | string | null;
  orderExpectedDeliveryDate: Date | string | null;
  orderNetValue: number | null;
  customerId: string | null;
  customerName: string | null;
  externalCustomerId: number | null;
  sellerName: string | null;
  sellerQualityStatus: string | null;
  productCode: string | null;
  sku: string | null;
  productName: string | null;
  orderedQuantity: number | null;
  orderUnitPrice: number | null;
  orderItemTotalValue: number | null;
  stockDocumentId: string | null;
  stockDocumentExternalId: number | null;
  stockDocumentDate: Date | string | null;
  stockDocumentItemQuantity: number | null;
  quantityUsedForOrder: number | null;
  excessQuantity: number | null;
  outsideOrderQuantity: number | null;
  allocatedValueByOrderPrice: number | null;
  nfeNumber: string | null;
  nfeIssueDate: Date | string | null;
  nfeHeaderValue: number | null;
  receivableTotalValue: number | null;
  receivableOpenValue: number | null;
  receivableReceivedValue: number | null;
  paymentDueDate: Date | string | null;
  paymentSettlementDate: Date | string | null;
  paymentStatus: string | null;
  operationalStage: string | null;
  financialStage: string | null;
  orderToCashStage: string | null;
  temperature: string | null;
  confidenceScore: number | null;
  confidenceLabel: string | null;
  responsibleArea: string | null;
  recommendedAction: string | null;
  alertsJson: unknown;
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
  blockingReasonsJson: unknown;
};

function asString(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

function asPositiveInt(value: unknown, label: string): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value));
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new OrderToCashAuditApiParseError(`${label} inválido.`);
  }
  return n;
}

function asYear(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value));
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 2000 || n > 2100) {
    throw new OrderToCashAuditApiParseError("year inválido.");
  }
  return n;
}

function asBool(value: unknown): boolean {
  if (value === true || value === 1 || value === "1") return true;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    return v === "true" || v === "yes" || v === "on";
  }
  return false;
}

function clampPageSize(value: unknown): number {
  if (value == null || value === "") return ORDER_TO_CASH_AUDIT_DEFAULT_PAGE_SIZE;
  const n = typeof value === "number" ? value : Number(String(value));
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new OrderToCashAuditApiParseError("pageSize inválido.");
  }
  return Math.min(n, ORDER_TO_CASH_AUDIT_MAX_PAGE_SIZE);
}

function clampPage(value: unknown): number {
  if (value == null || value === "") return 1;
  const n = typeof value === "number" ? value : Number(String(value));
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new OrderToCashAuditApiParseError("page inválido.");
  }
  return n;
}

export function resolveOrderToCashAuditSort(
  sortByRaw: unknown,
  sortDirectionRaw: unknown
): { sortBy: OrderToCashAuditSortBy; sortDirection: OrderToCashAuditSortDirection } {
  const requested = asString(sortByRaw);
  const sortBy =
    requested &&
    (ORDER_TO_CASH_AUDIT_SORT_WHITELIST as readonly string[]).includes(requested)
      ? (requested as OrderToCashAuditSortBy)
      : ORDER_TO_CASH_AUDIT_DEFAULT_SORT_BY;

  const dir = asString(sortDirectionRaw)?.toLowerCase();
  const sortDirection: OrderToCashAuditSortDirection =
    dir === "asc" || dir === "desc" ? dir : ORDER_TO_CASH_AUDIT_DEFAULT_SORT_DIRECTION;

  return { sortBy, sortDirection };
}

/**
 * Monta orderBy Prisma a partir da whitelist — nunca string livre.
 */
export function buildOrderToCashAuditPrismaOrderBy(
  sortBy: OrderToCashAuditSortBy,
  sortDirection: OrderToCashAuditSortDirection
): Array<Record<string, "asc" | "desc">> {
  return [{ [sortBy]: sortDirection }, { id: "asc" }];
}

export function parseOrderToCashAuditListFilters(
  query: Record<string, unknown>
): OrderToCashAuditListFilters {
  const customerExternalId = asPositiveInt(
    query.customerExternalId,
    "customerExternalId"
  );
  const customerId = asString(query.customerId);
  const year = asYear(query.year);

  if ((customerExternalId == null && !customerId) || year == null) {
    throw new OrderToCashAuditApiParseError(ORDER_TO_CASH_AUDIT_CUSTOMER_YEAR_REQUIRED);
  }

  const { sortBy, sortDirection } = resolveOrderToCashAuditSort(
    query.sortBy,
    query.sortDirection
  );

  return {
    customerExternalId,
    customerId,
    year,
    page: clampPage(query.page),
    pageSize: clampPageSize(query.pageSize),
    sortBy,
    sortDirection,
    orderCode: asString(query.orderCode),
    sellerName: asString(query.sellerName),
    productCode: asString(query.productCode),
    sku: asString(query.sku),
    nfeNumber: asString(query.nfeNumber),
    stockDocumentExternalId: asPositiveInt(
      query.stockDocumentExternalId,
      "stockDocumentExternalId"
    ),
    orderToCashStage: asString(query.orderToCashStage),
    operationalStage: asString(query.operationalStage),
    financialStage: asString(query.financialStage),
    paymentStatus: asString(query.paymentStatus),
    temperature: asString(query.temperature),
    confidenceLabel: asString(query.confidenceLabel),
    hasAlerts: asBool(query.hasAlerts),
    onlyWithExcess: asBool(query.onlyWithExcess),
    onlyWithProductOutsideOrder: asBool(query.onlyWithProductOutsideOrder),
    onlyWithoutDocument: asBool(query.onlyWithoutDocument),
    onlyWithoutReceivable: asBool(query.onlyWithoutReceivable),
    onlyOverdue: asBool(query.onlyOverdue),
    runId: asString(query.runId),
  };
}

/** Parse parcial para UI saber se ainda falta seleção (sem throw). */
export function inspectOrderToCashAuditRequiredSelection(
  query: Record<string, unknown>
): OrderToCashAuditRequiredSelection {
  try {
    asPositiveInt(query.customerExternalId, "customerExternalId");
    asString(query.customerId);
    asYear(query.year);
  } catch {
    /* ignore parse noise — só checamos presença */
  }
  const hasCustomer =
    (query.customerExternalId != null && String(query.customerExternalId).trim() !== "") ||
    (query.customerId != null && String(query.customerId).trim() !== "");
  const hasYear = query.year != null && String(query.year).trim() !== "";
  const ready = hasCustomer && hasYear;
  return {
    customerRequired: true,
    yearRequired: true,
    readyToSearch: ready,
    message: ready ? null : ORDER_TO_CASH_AUDIT_CUSTOMER_YEAR_REQUIRED,
  };
}

export function yearDateBounds(year: number): { gte: Date; lte: Date } {
  return {
    gte: new Date(year, 0, 1, 0, 0, 0, 0),
    lte: new Date(year, 11, 31, 23, 59, 59, 999),
  };
}

type StringContains = { contains: string; mode: "insensitive" };

/**
 * Where Prisma-compatível a partir dos filtros (sem SQL string livre).
 * Tipado de forma estrutural para o módulo puro não depender de @prisma/client.
 */
export function buildOrderToCashAuditFactWhere(
  filters: OrderToCashAuditListFilters,
  runId: string
): Record<string, unknown> {
  const yearBounds = yearDateBounds(filters.year);
  const and: Array<Record<string, unknown>> = [
    { runId },
    {
      OR: [
        { orderIssueDate: { gte: yearBounds.gte, lte: yearBounds.lte } },
        {
          AND: [
            { orderIssueDate: null },
            { createdAt: { gte: yearBounds.gte, lte: yearBounds.lte } },
          ],
        },
      ],
    },
  ];

  if (filters.customerExternalId != null) {
    and.push({ externalCustomerId: filters.customerExternalId });
  } else if (filters.customerId) {
    and.push({ customerId: filters.customerId });
  }

  const contains = (value: string): StringContains => ({
    contains: value,
    mode: "insensitive",
  });

  if (filters.orderCode) and.push({ orderCode: contains(filters.orderCode) });
  if (filters.sellerName) and.push({ sellerName: contains(filters.sellerName) });
  if (filters.productCode) and.push({ productCode: contains(filters.productCode) });
  if (filters.sku) and.push({ sku: contains(filters.sku) });
  if (filters.nfeNumber) and.push({ nfeNumber: contains(filters.nfeNumber) });
  if (filters.stockDocumentExternalId != null) {
    and.push({ stockDocumentExternalId: filters.stockDocumentExternalId });
  }
  if (filters.orderToCashStage) and.push({ orderToCashStage: filters.orderToCashStage });
  if (filters.operationalStage) and.push({ operationalStage: filters.operationalStage });
  if (filters.financialStage) and.push({ financialStage: filters.financialStage });
  if (filters.paymentStatus) and.push({ paymentStatus: filters.paymentStatus });
  if (filters.temperature) and.push({ temperature: filters.temperature });
  if (filters.confidenceLabel) and.push({ confidenceLabel: filters.confidenceLabel });

  if (filters.hasAlerts) {
    and.push({
      OR: [
        { hasDeliveryDelay: true },
        { hasMissingStockDocument: true },
        { hasPartialFulfillment: true },
        { hasExcessQuantity: true },
        { hasProductOutsideOrder: true },
        { hasNfeHeaderGreaterThanOrder: true },
        { hasPriceMismatch: true },
        { hasDocumentWithoutReceivable: true },
        { hasOverdueReceivable: true },
        { hasReceivableWithoutSafeLink: true },
        { hasPaymentConditionMissing: true },
        { hasPaymentDateDivergence: true },
        { hasRecentPaymentNotReflected: true },
      ],
    });
  }
  if (filters.onlyWithExcess) and.push({ hasExcessQuantity: true });
  if (filters.onlyWithProductOutsideOrder) {
    and.push({ hasProductOutsideOrder: true });
  }
  if (filters.onlyWithoutDocument) {
    and.push({ OR: [{ stockDocumentId: null }, { hasMissingStockDocument: true }] });
  }
  if (filters.onlyWithoutReceivable) {
    and.push({
      OR: [
        { hasDocumentWithoutReceivable: true },
        { receivableTotalValue: null },
        { receivableCount: 0 },
      ],
    });
  }
  if (filters.onlyOverdue) and.push({ hasOverdueReceivable: true });

  return { AND: and };
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseAlerts(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parseAlerts(parsed);
    } catch {
      return value.trim() ? [value.trim()] : [];
    }
  }
  return [];
}

export function mapOrderToCashAuditFactToListRow(
  fact: OrderToCashAuditFactRecord
): OrderToCashAuditListRow {
  return {
    id: fact.id,
    runId: fact.runId,
    orderCode: fact.orderCode,
    orderIssueDate: toIso(fact.orderIssueDate),
    orderExpectedDeliveryDate: toIso(fact.orderExpectedDeliveryDate),
    customerName: fact.customerName,
    externalCustomerId: fact.externalCustomerId,
    sellerName: fact.sellerName,
    sellerQualityStatus: fact.sellerQualityStatus,
    productCode: fact.productCode,
    sku: fact.sku,
    productName: fact.productName,
    orderedQuantity: fact.orderedQuantity,
    orderUnitPrice: fact.orderUnitPrice,
    orderItemTotalValue: fact.orderItemTotalValue,
    stockDocumentExternalId: fact.stockDocumentExternalId,
    stockDocumentDate: toIso(fact.stockDocumentDate),
    stockDocumentItemQuantity: fact.stockDocumentItemQuantity,
    quantityUsedForOrder: fact.quantityUsedForOrder,
    excessQuantity: fact.excessQuantity,
    outsideOrderQuantity: fact.outsideOrderQuantity,
    allocatedValueByOrderPrice: fact.allocatedValueByOrderPrice,
    nfeNumber: fact.nfeNumber,
    nfeIssueDate: toIso(fact.nfeIssueDate),
    nfeHeaderValue: fact.nfeHeaderValue,
    receivableTotalValue: fact.receivableTotalValue,
    receivableOpenValue: fact.receivableOpenValue,
    receivableReceivedValue: fact.receivableReceivedValue,
    paymentDueDate: toIso(fact.paymentDueDate),
    paymentSettlementDate: toIso(fact.paymentSettlementDate),
    paymentStatus: fact.paymentStatus,
    operationalStage: fact.operationalStage,
    financialStage: fact.financialStage,
    orderToCashStage: fact.orderToCashStage,
    temperature: fact.temperature,
    confidenceScore: fact.confidenceScore,
    confidenceLabel: fact.confidenceLabel,
    responsibleArea: fact.responsibleArea,
    recommendedAction: fact.recommendedAction,
    alerts: parseAlerts(fact.alertsJson),
    hasDeliveryDelay: Boolean(fact.hasDeliveryDelay),
    hasMissingStockDocument: Boolean(fact.hasMissingStockDocument),
    hasPartialFulfillment: Boolean(fact.hasPartialFulfillment),
    hasFullFulfillment: Boolean(fact.hasFullFulfillment),
    hasExcessQuantity: Boolean(fact.hasExcessQuantity),
    hasProductOutsideOrder: Boolean(fact.hasProductOutsideOrder),
    hasNfeHeaderGreaterThanOrder: Boolean(fact.hasNfeHeaderGreaterThanOrder),
    hasPriceMismatch: Boolean(fact.hasPriceMismatch),
    hasDocumentWithoutReceivable: Boolean(fact.hasDocumentWithoutReceivable),
    hasOverdueReceivable: Boolean(fact.hasOverdueReceivable),
  };
}

function bump(map: Record<string, number>, key: string | null | undefined): void {
  const k = key?.trim() || "(null)";
  map[k] = (map[k] ?? 0) + 1;
}

export function buildOrderToCashAuditListSummary(
  facts: OrderToCashAuditFactRecord[],
  totalRows: number
): OrderToCashAuditListSummary {
  const orderNets = new Map<string, number>();
  let totalAllocatedValue = 0;
  let totalReceivableValue = 0;
  let totalReceivedValue = 0;
  let totalOpenValue = 0;
  let totalBlockedValue = 0;
  const alertCounts: Record<string, number> = {};
  const stageCounts: Record<string, number> = {};
  const paymentStatusCounts: Record<string, number> = {};
  const blockedOrders = new Set<string>();

  for (const fact of facts) {
    const orderKey = fact.salesOrderId ?? fact.orderCode ?? fact.id;
    if (fact.orderNetValue != null && Number.isFinite(fact.orderNetValue)) {
      if (!orderNets.has(orderKey)) orderNets.set(orderKey, fact.orderNetValue);
    } else if (!orderNets.has(orderKey)) {
      orderNets.set(orderKey, 0);
    }
    totalAllocatedValue += fact.allocatedValueByOrderPrice ?? 0;
    totalReceivableValue += fact.receivableTotalValue ?? 0;
    totalReceivedValue += fact.receivableReceivedValue ?? 0;
    totalOpenValue += fact.receivableOpenValue ?? 0;
    bump(stageCounts, fact.orderToCashStage);
    bump(paymentStatusCounts, fact.paymentStatus);
    for (const alert of parseAlerts(fact.alertsJson)) bump(alertCounts, alert);
    if (
      fact.orderToCashStage === "BLOQUEADO_REVISAO" ||
      parseAlerts(fact.blockingReasonsJson).length > 0
    ) {
      if (!blockedOrders.has(orderKey)) {
        blockedOrders.add(orderKey);
        totalBlockedValue += fact.orderNetValue ?? 0;
      }
    }
  }

  // Receivables are order-level — avoid double-count when multiple item rows share same CR totals
  // Prefer max per order for receivable aggregates
  const recvByOrder = new Map<string, { total: number; received: number; open: number }>();
  for (const fact of facts) {
    const orderKey = fact.salesOrderId ?? fact.orderCode ?? fact.id;
    const cur = recvByOrder.get(orderKey) ?? { total: 0, received: 0, open: 0 };
    cur.total = Math.max(cur.total, fact.receivableTotalValue ?? 0);
    cur.received = Math.max(cur.received, fact.receivableReceivedValue ?? 0);
    cur.open = Math.max(cur.open, fact.receivableOpenValue ?? 0);
    recvByOrder.set(orderKey, cur);
  }
  totalReceivableValue = 0;
  totalReceivedValue = 0;
  totalOpenValue = 0;
  for (const v of recvByOrder.values()) {
    totalReceivableValue += v.total;
    totalReceivedValue += v.received;
    totalOpenValue += v.open;
  }

  let totalOrderValue = 0;
  for (const v of orderNets.values()) totalOrderValue += v;

  return {
    totalRows,
    totalOrders: orderNets.size,
    totalOrderValue: Number(totalOrderValue.toFixed(6)),
    totalAllocatedValue: Number(totalAllocatedValue.toFixed(6)),
    totalReceivableValue: Number(totalReceivableValue.toFixed(6)),
    totalReceivedValue: Number(totalReceivedValue.toFixed(6)),
    totalOpenValue: Number(totalOpenValue.toFixed(6)),
    totalBlockedValue: Number(totalBlockedValue.toFixed(6)),
    alertCounts,
    stageCounts,
    paymentStatusCounts,
  };
}

export function buildOrderToCashAuditAvailableFilters(
  facts: OrderToCashAuditFactRecord[]
): OrderToCashAuditAvailableFilters {
  const sellers = new Map<string, number>();
  const stages = new Map<string, number>();
  const paymentStatuses = new Map<string, number>();
  const products = new Map<string, { productCode: string | null; sku: string | null; productName: string | null; count: number }>();
  const alerts = new Map<string, number>();

  for (const fact of facts) {
    if (fact.sellerName?.trim()) {
      sellers.set(fact.sellerName, (sellers.get(fact.sellerName) ?? 0) + 1);
    }
    if (fact.orderToCashStage?.trim()) {
      stages.set(fact.orderToCashStage, (stages.get(fact.orderToCashStage) ?? 0) + 1);
    }
    if (fact.paymentStatus?.trim()) {
      paymentStatuses.set(
        fact.paymentStatus,
        (paymentStatuses.get(fact.paymentStatus) ?? 0) + 1
      );
    }
    const productKey = `${fact.productCode ?? ""}|${fact.sku ?? ""}|${fact.productName ?? ""}`;
    if (fact.productCode || fact.sku || fact.productName) {
      const prev = products.get(productKey);
      if (prev) prev.count += 1;
      else {
        products.set(productKey, {
          productCode: fact.productCode,
          sku: fact.sku,
          productName: fact.productName,
          count: 1,
        });
      }
    }
    for (const alert of parseAlerts(fact.alertsJson)) {
      alerts.set(alert, (alerts.get(alert) ?? 0) + 1);
    }
  }

  const sortEntries = <T extends { count: number }>(arr: T[]) =>
    arr.sort((a, b) => b.count - a.count || 0);

  return {
    sellers: sortEntries(
      [...sellers.entries()].map(([sellerName, count]) => ({ sellerName, count }))
    ),
    stages: sortEntries(
      [...stages.entries()].map(([stage, count]) => ({ stage, count }))
    ),
    paymentStatuses: sortEntries(
      [...paymentStatuses.entries()].map(([paymentStatus, count]) => ({
        paymentStatus,
        count,
      }))
    ),
    products: sortEntries([...products.values()]),
    alertTypes: sortEntries(
      [...alerts.entries()].map(([alert, count]) => ({ alert, count }))
    ),
  };
}

export function buildOrderToCashAuditListPayload(input: {
  filters: OrderToCashAuditListFilters;
  run: OrderToCashAuditRunMeta | null;
  pageRows: OrderToCashAuditFactRecord[];
  summaryFacts: OrderToCashAuditFactRecord[];
  totalRows: number;
  message?: string | null;
}) {
  const requiredSelection: OrderToCashAuditRequiredSelection = {
    customerRequired: true,
    yearRequired: true,
    readyToSearch: true,
    message: null,
  };

  return {
    ok: true as const,
    message: input.message ?? null,
    filters: {
      ...input.filters,
    },
    requiredSelection,
    run: input.run,
    summary: buildOrderToCashAuditListSummary(input.summaryFacts, input.totalRows),
    rows: input.pageRows.map(mapOrderToCashAuditFactToListRow),
    pagination: {
      page: input.filters.page,
      pageSize: input.filters.pageSize,
      totalRows: input.totalRows,
      totalPages: Math.max(1, Math.ceil(input.totalRows / input.filters.pageSize)),
    },
    sorting: {
      sortBy: input.filters.sortBy,
      sortDirection: input.filters.sortDirection,
      whitelist: [...ORDER_TO_CASH_AUDIT_SORT_WHITELIST],
    },
    availableFilters: buildOrderToCashAuditAvailableFilters(input.summaryFacts),
  };
}

export function buildOrderToCashAuditFactDetailPayload(
  fact: OrderToCashAuditFactRecord,
  run: OrderToCashAuditRunMeta | null
) {
  return {
    ok: true as const,
    run,
    row: mapOrderToCashAuditFactToListRow(fact),
    // Campos extras úteis no detalhe, sem JSON cru de trace
    detail: {
      salesOrderId: fact.salesOrderId,
      stockDocumentId: fact.stockDocumentId,
      recommendedAction: fact.recommendedAction,
      responsibleArea: fact.responsibleArea,
      alerts: parseAlerts(fact.alertsJson),
      blockingReasons: parseAlerts(fact.blockingReasonsJson),
    },
  };
}
