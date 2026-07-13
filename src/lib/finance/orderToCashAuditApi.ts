/**
 * API pura read-only — OrderToCashAuditFact (aba Pedido → Caixa).
 * Parse de filtros, whitelist de sort, mapeamento de rows e payloads.
 * Sem Prisma e sem write; consulta apenas fatos materializados.
 */

export const ORDER_TO_CASH_AUDIT_CUSTOMER_YEAR_REQUIRED =
  "Selecione cliente e ano para pesquisar a auditoria Pedido → Caixa.";

export const ORDER_TO_CASH_AUDIT_CUSTOMER_EXTERNAL_REQUIRED =
  "Informe customerExternalId (código Nomus do cliente). O customerId interno não é usado para filtrar a auditoria.";

export const ORDER_TO_CASH_AUDIT_NO_RUN_MESSAGE =
  "Nenhuma run materializada de auditoria Pedido → Caixa encontrada. Execute o rebuild (apply) e tente novamente.";

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
  /** Código Nomus — único identificador de cliente usado no filtro de Fact. */
  customerExternalId: number | null;
  /**
   * UUID interno opcional: NÃO filtra Fact.
   * O server pode resolvê-lo para externalCustomerId via SalesOrder.
   */
  customerId: string | null;
  /** Busca por nome do cliente no Fact (contains), se não houver externalId. */
  customerName: string | null;
  year: number | null;
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
  mode: string | null;
  year: number | null;
  customerFilter: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  totalOrders: number;
  totalFacts: number;
  totalOrderValue: number | null;
  totalAllocatedValue: number | null;
  totalReceivableValue: number | null;
  totalReceivedValue: number | null;
  totalOpenValue: number | null;
  totalBlockedValue: number | null;
  createdAt: string | null;
  isGeneralRun: boolean;
};

export type OrderToCashAuditLineBilledValueSource =
  | "STOCK_DOCUMENT_ITEM"
  | "NFE_ITEM"
  | "ALLOCATED_DOCUMENT_PRICE"
  | "NOT_IDENTIFIED"
  | "NOT_BILLED";

export const ORDER_TO_CASH_AUDIT_LINE_BILLED_VALUE_LABEL: Record<
  OrderToCashAuditLineBilledValueSource,
  string
> = {
  STOCK_DOCUMENT_ITEM: "Item documento",
  NFE_ITEM: "Item NF",
  ALLOCATED_DOCUMENT_PRICE: "Alocação doc.",
  NOT_IDENTIFIED: "Não identificado",
  NOT_BILLED: "Não faturado nesta NF",
};

export type OrderToCashAuditLineBilledValue = {
  lineBilledValue: number | null;
  lineBilledValueSource: OrderToCashAuditLineBilledValueSource;
  lineBilledValueLabel: string;
};

function finiteMoney(value: number | null | undefined): number | null {
  if (value == null) return null;
  if (!Number.isFinite(value)) return null;
  return value;
}

function productMoney(
  quantity: number | null | undefined,
  unit: number | null | undefined
): number | null {
  const q = finiteMoney(quantity);
  const u = finiteMoney(unit);
  if (q == null || u == null) return null;
  return q * u;
}

/**
 * Valor cobrado da linha (item), sem ratear CR total.
 * - ALLOCATED: quantityUsedForOrder × unitValue do documento
 * - SURPLUS: excessQuantity × unitValue
 * - EXTRA: outsideOrderQuantity × unitValue
 * - PENDING: null / Não faturado nesta NF
 */
export function resolveOrderToCashAuditLineBilledValue(input: {
  lineType?: string | null;
  quantityUsedForOrder?: number | null;
  excessQuantity?: number | null;
  outsideOrderQuantity?: number | null;
  stockDocumentItemTotalValue?: number | null;
  stockDocumentItemQuantity?: number | null;
  stockDocumentItemUnitValue?: number | null;
  nfeItemTotalValue?: number | null;
  nfeItemQuantity?: number | null;
  nfeItemUnitValue?: number | null;
  allocatedValueByDocumentPrice?: number | null;
}): OrderToCashAuditLineBilledValue {
  const lineType = (input.lineType ?? "").trim().toUpperCase();
  const unit = finiteMoney(input.stockDocumentItemUnitValue);

  if (lineType === "ORDER_ITEM_PENDING") {
    return {
      lineBilledValue: null,
      lineBilledValueSource: "NOT_BILLED",
      lineBilledValueLabel: ORDER_TO_CASH_AUDIT_LINE_BILLED_VALUE_LABEL.NOT_BILLED,
    };
  }

  if (lineType === "ORDER_ITEM_ALLOCATED") {
    const used = finiteMoney(input.quantityUsedForOrder);
    if (used != null && unit != null) {
      return {
        lineBilledValue: used * unit,
        lineBilledValueSource: "STOCK_DOCUMENT_ITEM",
        lineBilledValueLabel: ORDER_TO_CASH_AUDIT_LINE_BILLED_VALUE_LABEL.STOCK_DOCUMENT_ITEM,
      };
    }
    const allocatedDoc = finiteMoney(input.allocatedValueByDocumentPrice);
    if (allocatedDoc != null) {
      return {
        lineBilledValue: allocatedDoc,
        lineBilledValueSource: "ALLOCATED_DOCUMENT_PRICE",
        lineBilledValueLabel: ORDER_TO_CASH_AUDIT_LINE_BILLED_VALUE_LABEL.ALLOCATED_DOCUMENT_PRICE,
      };
    }
  }

  if (lineType === "QUANTITY_SURPLUS") {
    const excess = finiteMoney(input.excessQuantity);
    if (excess != null && unit != null) {
      return {
        lineBilledValue: excess * unit,
        lineBilledValueSource: "STOCK_DOCUMENT_ITEM",
        lineBilledValueLabel: ORDER_TO_CASH_AUDIT_LINE_BILLED_VALUE_LABEL.STOCK_DOCUMENT_ITEM,
      };
    }
  }

  if (lineType === "DOCUMENT_EXTRA_ITEM") {
    const outside = finiteMoney(input.outsideOrderQuantity);
    if (outside != null && unit != null) {
      return {
        lineBilledValue: outside * unit,
        lineBilledValueSource: "STOCK_DOCUMENT_ITEM",
        lineBilledValueLabel: ORDER_TO_CASH_AUDIT_LINE_BILLED_VALUE_LABEL.STOCK_DOCUMENT_ITEM,
      };
    }
  }

  const stockTotal = finiteMoney(input.stockDocumentItemTotalValue);
  if (stockTotal != null) {
    return {
      lineBilledValue: stockTotal,
      lineBilledValueSource: "STOCK_DOCUMENT_ITEM",
      lineBilledValueLabel: ORDER_TO_CASH_AUDIT_LINE_BILLED_VALUE_LABEL.STOCK_DOCUMENT_ITEM,
    };
  }
  const stockProduct = productMoney(
    input.stockDocumentItemQuantity,
    input.stockDocumentItemUnitValue
  );
  if (stockProduct != null) {
    return {
      lineBilledValue: stockProduct,
      lineBilledValueSource: "STOCK_DOCUMENT_ITEM",
      lineBilledValueLabel: ORDER_TO_CASH_AUDIT_LINE_BILLED_VALUE_LABEL.STOCK_DOCUMENT_ITEM,
    };
  }

  const nfeTotal = finiteMoney(input.nfeItemTotalValue);
  if (nfeTotal != null) {
    return {
      lineBilledValue: nfeTotal,
      lineBilledValueSource: "NFE_ITEM",
      lineBilledValueLabel: ORDER_TO_CASH_AUDIT_LINE_BILLED_VALUE_LABEL.NFE_ITEM,
    };
  }
  const nfeProduct = productMoney(input.nfeItemQuantity, input.nfeItemUnitValue);
  if (nfeProduct != null) {
    return {
      lineBilledValue: nfeProduct,
      lineBilledValueSource: "NFE_ITEM",
      lineBilledValueLabel: ORDER_TO_CASH_AUDIT_LINE_BILLED_VALUE_LABEL.NFE_ITEM,
    };
  }

  const allocatedDoc = finiteMoney(input.allocatedValueByDocumentPrice);
  if (allocatedDoc != null) {
    return {
      lineBilledValue: allocatedDoc,
      lineBilledValueSource: "ALLOCATED_DOCUMENT_PRICE",
      lineBilledValueLabel: ORDER_TO_CASH_AUDIT_LINE_BILLED_VALUE_LABEL.ALLOCATED_DOCUMENT_PRICE,
    };
  }

  return {
    lineBilledValue: null,
    lineBilledValueSource: "NOT_IDENTIFIED",
    lineBilledValueLabel: ORDER_TO_CASH_AUDIT_LINE_BILLED_VALUE_LABEL.NOT_IDENTIFIED,
  };
}

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
  lineType: string | null;
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
  allocatedValueByDocumentPrice: number | null;
  stockDocumentItemUnitValue: number | null;
  stockDocumentItemTotalValue: number | null;
  nfeItemQuantity: number | null;
  nfeItemUnitValue: number | null;
  nfeItemTotalValue: number | null;
  lineBilledValue: number | null;
  lineBilledValueSource: OrderToCashAuditLineBilledValueSource;
  lineBilledValueLabel: string;
  /** CR/NF do título (rastreabilidade) — não confundir com valor do item. */
  titleReceivableTotalValue: number | null;
  titleReceivableOpenValue: number | null;
  titleNfeNumber: string | null;
  titleNfeExternalId: number | null;
  evidenceLevel: "ITEM" | "ORDER_TITLE";
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
  /** run = totais da OrderToCashAuditRun; filtered_facts = agregado seguro por pedido nas linhas filtradas */
  summarySource: "run" | "filtered_facts";
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
  lineType: string | null;
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
  allocatedValueByDocumentPrice: number | null;
  stockDocumentItemUnitValue: number | null;
  stockDocumentItemTotalValue: number | null;
  nfeItemQuantity: number | null;
  nfeItemUnitValue: number | null;
  nfeItemTotalValue: number | null;
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
  const customerName = asString(query.customerName);
  const year = asYear(query.year);

  // customerId sozinho não é filtro de Fact — exige externalId ou nome (ou nenhum = run geral).
  if (customerId && customerExternalId == null && !customerName) {
    // Permitido: server resolve UUID → externalCustomerId. Não rejeita no parse.
  }

  const { sortBy, sortDirection } = resolveOrderToCashAuditSort(
    query.sortBy,
    query.sortDirection
  );

  return {
    customerExternalId,
    customerId,
    customerName,
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
  const hasCustomer =
    (query.customerExternalId != null && String(query.customerExternalId).trim() !== "") ||
    (query.customerId != null && String(query.customerId).trim() !== "") ||
    (query.customerName != null && String(query.customerName).trim() !== "");
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

export type OrderToCashAuditRunResolutionKind =
  | "explicit"
  | "specific_customer_year"
  | "general"
  | "none";

/**
 * Política pura de escolha de run (testável sem Prisma).
 * a) específica cliente+ano → b) geral customerFilter null → c) none
 */
export function decideOrderToCashAuditRunPolicy(input: {
  runId: string | null;
  customerExternalId: number | null;
  year: number | null;
  specificRunId: string | null;
  generalRunId: string | null;
}): { kind: OrderToCashAuditRunResolutionKind; runId: string | null } {
  if (input.runId) return { kind: "explicit", runId: input.runId };
  if (
    input.customerExternalId != null &&
    input.year != null &&
    input.specificRunId
  ) {
    return { kind: "specific_customer_year", runId: input.specificRunId };
  }
  if (input.generalRunId) return { kind: "general", runId: input.generalRunId };
  return { kind: "none", runId: null };
}

/**
 * Where Prisma-compatível — nunca filtra por customerId interno.
 */
export function buildOrderToCashAuditFactWhere(
  filters: OrderToCashAuditListFilters,
  runId: string,
  options?: { applyYearOnIssueDate?: boolean; isGeneralRun?: boolean }
): Record<string, unknown> {
  const and: Array<Record<string, unknown>> = [{ runId }];

  // Ano em orderIssueDate só na run geral (run específica já é escopo cliente/ano).
  const applyYear =
    filters.year != null &&
    (options?.applyYearOnIssueDate === true ||
      (options?.applyYearOnIssueDate !== false && options?.isGeneralRun === true));

  if (applyYear && filters.year != null) {
    const yearBounds = yearDateBounds(filters.year);
    and.push({
      OR: [
        { orderIssueDate: { gte: yearBounds.gte, lte: yearBounds.lte } },
        {
          AND: [
            { orderIssueDate: null },
            { createdAt: { gte: yearBounds.gte, lte: yearBounds.lte } },
          ],
        },
      ],
    });
  }

  if (filters.customerExternalId != null) {
    and.push({ externalCustomerId: filters.customerExternalId });
  } else if (filters.customerName) {
    and.push({
      customerName: { contains: filters.customerName, mode: "insensitive" },
    });
  }
  // Nunca: customerId no where de Fact.

  const contains = (value: string): StringContains => ({
    contains: value,
    mode: "insensitive",
  });

  if (filters.orderCode) and.push({ orderCode: contains(filters.orderCode) });
  // sellerName null/"Sem vendedor informado" — contains é seguro; não exige campo não-nulo
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

/** Há filtro que estreita a run geral (cliente/ano/avançados). */
export function orderToCashAuditHasFactScopeFilters(
  filters: OrderToCashAuditListFilters
): boolean {
  return (
    filters.customerExternalId != null ||
    Boolean(filters.customerName) ||
    filters.year != null ||
    Boolean(filters.orderCode) ||
    Boolean(filters.sellerName) ||
    Boolean(filters.productCode) ||
    Boolean(filters.sku) ||
    Boolean(filters.nfeNumber) ||
    filters.stockDocumentExternalId != null ||
    Boolean(filters.orderToCashStage) ||
    Boolean(filters.operationalStage) ||
    Boolean(filters.financialStage) ||
    Boolean(filters.paymentStatus) ||
    Boolean(filters.temperature) ||
    Boolean(filters.confidenceLabel) ||
    filters.hasAlerts ||
    filters.onlyWithExcess ||
    filters.onlyWithProductOutsideOrder ||
    filters.onlyWithoutDocument ||
    filters.onlyWithoutReceivable ||
    filters.onlyOverdue
  );
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
  const billed = resolveOrderToCashAuditLineBilledValue({
    lineType: fact.lineType,
    quantityUsedForOrder: fact.quantityUsedForOrder,
    excessQuantity: fact.excessQuantity,
    outsideOrderQuantity: fact.outsideOrderQuantity,
    stockDocumentItemTotalValue: fact.stockDocumentItemTotalValue,
    stockDocumentItemQuantity: fact.stockDocumentItemQuantity,
    stockDocumentItemUnitValue: fact.stockDocumentItemUnitValue,
    nfeItemTotalValue: fact.nfeItemTotalValue,
    nfeItemQuantity: fact.nfeItemQuantity,
    nfeItemUnitValue: fact.nfeItemUnitValue,
    allocatedValueByDocumentPrice: fact.allocatedValueByDocumentPrice,
  });
  const isPending = (fact.lineType ?? "").toUpperCase() === "ORDER_ITEM_PENDING";
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
    lineType: fact.lineType ?? null,
    orderedQuantity: fact.orderedQuantity,
    orderUnitPrice: fact.orderUnitPrice,
    orderItemTotalValue: fact.orderItemTotalValue,
    stockDocumentExternalId: isPending ? null : fact.stockDocumentExternalId,
    stockDocumentDate: isPending ? null : toIso(fact.stockDocumentDate),
    stockDocumentItemQuantity: isPending ? null : fact.stockDocumentItemQuantity,
    quantityUsedForOrder: fact.quantityUsedForOrder,
    excessQuantity: fact.excessQuantity,
    outsideOrderQuantity: fact.outsideOrderQuantity,
    allocatedValueByOrderPrice: fact.allocatedValueByOrderPrice,
    allocatedValueByDocumentPrice: fact.allocatedValueByDocumentPrice,
    stockDocumentItemUnitValue: fact.stockDocumentItemUnitValue,
    stockDocumentItemTotalValue: fact.stockDocumentItemTotalValue,
    nfeItemQuantity: fact.nfeItemQuantity,
    nfeItemUnitValue: fact.nfeItemUnitValue,
    nfeItemTotalValue: fact.nfeItemTotalValue,
    lineBilledValue: billed.lineBilledValue,
    lineBilledValueSource: billed.lineBilledValueSource,
    lineBilledValueLabel: billed.lineBilledValueLabel,
    titleReceivableTotalValue: null,
    titleReceivableOpenValue: null,
    titleNfeNumber: null,
    titleNfeExternalId: null,
    evidenceLevel: isPending ? "ORDER_TITLE" : "ITEM",
    nfeNumber: isPending ? null : fact.nfeNumber,
    nfeIssueDate: isPending ? null : toIso(fact.nfeIssueDate),
    nfeHeaderValue: isPending ? null : fact.nfeHeaderValue,
    receivableTotalValue: isPending ? null : fact.receivableTotalValue,
    receivableOpenValue: isPending ? null : fact.receivableOpenValue,
    receivableReceivedValue: isPending ? null : fact.receivableReceivedValue,
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

/**
 * Propaga CR/NF do título (máximo entre linhas do mesmo pedido com evidência de item)
 * para todas as linhas, inclusive PENDING.
 */
export function enrichOrderToCashAuditListRowsWithTitleEvidence(
  rows: OrderToCashAuditListRow[]
): OrderToCashAuditListRow[] {
  const titleByOrder = new Map<
    string,
    {
      receivableTotalValue: number | null;
      receivableOpenValue: number | null;
      nfeNumber: string | null;
      nfeExternalId: number | null;
    }
  >();

  for (const row of rows) {
    const key = row.orderCode ?? row.id;
    if (row.lineType === "ORDER_ITEM_PENDING") continue;
    const cur = titleByOrder.get(key) ?? {
      receivableTotalValue: null,
      receivableOpenValue: null,
      nfeNumber: null,
      nfeExternalId: null,
    };
    if (row.receivableTotalValue != null) {
      cur.receivableTotalValue = Math.max(
        cur.receivableTotalValue ?? 0,
        row.receivableTotalValue
      );
    }
    if (row.receivableOpenValue != null) {
      cur.receivableOpenValue = Math.max(
        cur.receivableOpenValue ?? 0,
        row.receivableOpenValue
      );
    }
    if (!cur.nfeNumber && row.nfeNumber) cur.nfeNumber = row.nfeNumber;
    titleByOrder.set(key, cur);
  }

  return rows.map((row) => {
    const key = row.orderCode ?? row.id;
    const title = titleByOrder.get(key);
    const titleReceivableTotalValue =
      title?.receivableTotalValue ??
      (row.lineType === "ORDER_ITEM_PENDING" ? null : row.receivableTotalValue);
    const titleReceivableOpenValue =
      title?.receivableOpenValue ??
      (row.lineType === "ORDER_ITEM_PENDING" ? null : row.receivableOpenValue);
    const titleNfeNumber =
      title?.nfeNumber ?? (row.lineType === "ORDER_ITEM_PENDING" ? null : row.nfeNumber);
    return {
      ...row,
      titleReceivableTotalValue,
      titleReceivableOpenValue,
      titleNfeNumber,
      titleNfeExternalId: title?.nfeExternalId ?? null,
      evidenceLevel:
        row.lineType === "ORDER_ITEM_PENDING" ? "ORDER_TITLE" : row.evidenceLevel,
    };
  });
}

function bump(map: Record<string, number>, key: string | null | undefined): void {
  const k = key?.trim() || "(null)";
  map[k] = (map[k] ?? 0) + 1;
}

export function buildOrderToCashAuditListSummaryFromRun(
  run: OrderToCashAuditRunMeta,
  totalRows: number
): OrderToCashAuditListSummary {
  return {
    totalRows,
    totalOrders: run.totalOrders,
    totalOrderValue: run.totalOrderValue ?? 0,
    totalAllocatedValue: run.totalAllocatedValue ?? 0,
    totalReceivableValue: run.totalReceivableValue ?? 0,
    totalReceivedValue: run.totalReceivedValue ?? 0,
    totalOpenValue: run.totalOpenValue ?? 0,
    totalBlockedValue: run.totalBlockedValue ?? 0,
    alertCounts: {},
    stageCounts: {},
    paymentStatusCounts: {},
    summarySource: "run",
  };
}

/**
 * Resumo seguro a partir de facts filtrados: orderNet / CR agregados por pedido
 * (não soma CR repetido linha a linha).
 */
export function buildOrderToCashAuditListSummary(
  facts: OrderToCashAuditFactRecord[],
  totalRows: number
): OrderToCashAuditListSummary {
  const orderNets = new Map<string, number>();
  let totalAllocatedValue = 0;
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
  const recvByOrder = new Map<string, { total: number; received: number; open: number }>();
  for (const fact of facts) {
    const orderKey = fact.salesOrderId ?? fact.orderCode ?? fact.id;
    const cur = recvByOrder.get(orderKey) ?? { total: 0, received: 0, open: 0 };
    cur.total = Math.max(cur.total, fact.receivableTotalValue ?? 0);
    cur.received = Math.max(cur.received, fact.receivableReceivedValue ?? 0);
    cur.open = Math.max(cur.open, fact.receivableOpenValue ?? 0);
    recvByOrder.set(orderKey, cur);
  }
  let totalReceivableValue = 0;
  let totalReceivedValue = 0;
  let totalOpenValue = 0;
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
    summarySource: "filtered_facts",
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
  /** Quando true e há run, usa totais da run (sem somar CR linha a linha). */
  preferRunTotals?: boolean;
}) {
  const requiredSelection: OrderToCashAuditRequiredSelection = {
    customerRequired: true,
    yearRequired: true,
    readyToSearch: true,
    message: null,
  };

  const useRunTotals = Boolean(input.preferRunTotals && input.run);
  const summary = useRunTotals
    ? buildOrderToCashAuditListSummaryFromRun(input.run!, input.totalRows)
    : buildOrderToCashAuditListSummary(input.summaryFacts, input.totalRows);

  return {
    ok: true as const,
    message: input.message ?? null,
    filters: {
      ...input.filters,
    },
    requiredSelection,
    run: input.run,
    summary,
    rows: enrichOrderToCashAuditListRowsWithTitleEvidence(
      input.pageRows.map(mapOrderToCashAuditFactToListRow)
    ),
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
