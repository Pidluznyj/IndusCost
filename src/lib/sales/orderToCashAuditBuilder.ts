/**
 * Motor puro — monta linhas OrderToCashAuditFact a partir de fontes oficiais existentes.
 *
 * Camada derivada / auditoria Pedido → Caixa.
 * Não grava no banco; fora de escopo: propostas comerciais, comissoes e OP.
 * Reutiliza alocação de Conciliação de Carteira e extração de parcelas do pedido.
 */

import {
  allocateStockQuantityToOrderBalances,
  PORTFOLIO_PRICE_TOLERANCE,
  pricesMismatch,
} from "../finance/portfolioReconciliationAllocationEngine.js";
import { extractSalesOrderForecastInstallments } from "../salesOrderListPaymentSchedule.js";

// ---------------------------------------------------------------------------
// Constants / line types
// ---------------------------------------------------------------------------

export const ORDER_TO_CASH_PRICE_TOLERANCE = PORTFOLIO_PRICE_TOLERANCE;

export const ORDER_TO_CASH_LINE_TYPES = [
  "ORDER_ITEM_PENDING",
  "ORDER_ITEM_ALLOCATED",
  "DOCUMENT_EXTRA_ITEM",
  "QUANTITY_SURPLUS",
] as const;

export type OrderToCashLineType = (typeof ORDER_TO_CASH_LINE_TYPES)[number];

export const DEFAULT_ORDER_TO_CASH_AUDIT_OPTIONS = {
  diasProximoEntrega: 7,
  diasRecemVencido: 15,
  diasBloqueio: 60,
  diasAntigoCritico: 90,
  priceTolerance: ORDER_TO_CASH_PRICE_TOLERANCE,
} as const;

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export type OrderToCashAuditOrderInput = {
  id: string;
  externalSalesOrderId?: number | null;
  orderCode: string;
  status?: string | null;
  issueDate?: Date | string | null;
  expectedDeliveryDate?: Date | string | null;
  totalNetValue?: number | null;
  totalGrossValue?: number | null;
  paymentTerms?: string | null;
  paymentMethod?: string | null;
  nomusRawResponse?: unknown;
  companyId?: string | null;
  companyName?: string | null;
  customerId?: string | null;
  externalCustomerId?: number | null;
  customerName?: string | null;
  customerDocument?: string | null;
  customerGroup?: string | null;
  customerCity?: string | null;
  customerState?: string | null;
  /** Vendedor oficial do Pedido de Venda (nunca CRM responsible). */
  sellerId?: string | null;
  externalSellerId?: number | string | null;
  sellerName?: string | null;
  sellerSource?: string | null;
  updatedAt?: Date | string | null;
};

export type OrderToCashAuditOrderItemInput = {
  id: string;
  salesOrderId: string;
  externalSalesOrderItemId?: number | null;
  orderItemSequence?: number | null;
  externalProductId?: number | null;
  productId?: string | null;
  productCode?: string | null;
  sku?: string | null;
  productName?: string | null;
  productDescription?: string | null;
  quantity: number;
  unitPrice: number;
  totalNetValue?: number | null;
  expectedDeliveryDate?: Date | string | null;
  itemStatus?: string | null;
};

export type OrderToCashAuditNfeLinkInput = {
  salesOrderId: string;
  nfeExternalId: number;
  nfeNumber?: string | null;
  nfeSerie?: string | null;
  nfeKey?: string | null;
  nfeStatus?: string | number | null;
  tipoOperacao?: string | number | null;
  dataProcessamento?: Date | string | null;
  nomusNfeId?: string | null;
};

export type OrderToCashAuditNfeInput = {
  id?: string | null;
  externalId: number;
  numero?: string | null;
  serie?: string | null;
  chave?: string | null;
  status?: string | number | null;
  tipoOperacao?: string | number | null;
  dataProcessamento?: Date | string | null;
  issueDate?: Date | string | null;
  valorLiquido?: number | null;
};

export type OrderToCashAuditStockItemInput = {
  id: string;
  stockDocumentId: string;
  externalItemId?: number | null;
  externalProductId?: number | null;
  productCode?: string | null;
  productName?: string | null;
  quantity: number;
  unitValue: number;
  estimatedTotalValue?: number | null;
};

export type OrderToCashAuditStockDocumentInput = {
  id: string;
  externalId: number;
  idNfe?: number | null;
  tipoDocumentoEstoque?: string | null;
  dataDocumento?: Date | string | null;
  totalValue?: number | null;
  personId?: string | null;
  personName?: string | null;
  items?: OrderToCashAuditStockItemInput[];
};

export type OrderToCashAuditReceivableInput = {
  id?: string | null;
  externalId: number;
  sourceInvoiceId?: number | null;
  sourceInvoiceNumber?: string | null;
  amountReceivable?: number | null;
  amountReceived?: number | null;
  balanceReceivable?: number | null;
  dueDate?: Date | string | null;
  settlementDate?: Date | string | null;
};

/** Fato materializado de Conciliação (opcional — usado como evidência auxiliar). */
export type OrderToCashAuditReconciliationFactInput = {
  salesOrderId?: string | null;
  salesOrderItemId?: string | null;
  nfeExternalId?: number | null;
  stockDocumentId?: string | null;
  allocatedQuantity?: number | null;
  allocatedValueByOrderPrice?: number | null;
  status?: string | null;
  alertsJson?: unknown;
};

export type OrderToCashAuditBuilderOptions = {
  today?: Date | string | null;
  runId?: string | null;
  diasProximoEntrega?: number;
  diasRecemVencido?: number;
  diasBloqueio?: number;
  diasAntigoCritico?: number;
  priceTolerance?: number;
};

export type BuildOrderToCashAuditRowsInput = {
  orders: OrderToCashAuditOrderInput[];
  orderItems: OrderToCashAuditOrderItemInput[];
  nfeLinks?: OrderToCashAuditNfeLinkInput[] | null;
  nfes?: OrderToCashAuditNfeInput[] | null;
  stockDocuments?: OrderToCashAuditStockDocumentInput[] | null;
  stockDocumentItems?: OrderToCashAuditStockItemInput[] | null;
  receivables?: OrderToCashAuditReceivableInput[] | null;
  reconciliationFacts?: OrderToCashAuditReconciliationFactInput[] | null;
  options?: OrderToCashAuditBuilderOptions | null;
};

// ---------------------------------------------------------------------------
// Output row (contrato OrderToCashAuditFact — números JS em vez de Decimal)
// ---------------------------------------------------------------------------

export type OrderToCashAuditFactRow = {
  runId: string | null;
  auditKey: string;
  lineType: OrderToCashLineType;

  salesOrderId: string | null;
  externalSalesOrderId: number | null;
  orderCode: string | null;
  orderStatus: string | null;
  orderIssueDate: Date | null;
  orderExpectedDeliveryDate: Date | null;
  orderTotalValue: number | null;
  orderNetValue: number | null;
  orderGrossValue: number | null;
  companyId: string | null;
  companyName: string | null;

  customerId: string | null;
  externalCustomerId: number | null;
  customerName: string | null;
  customerDocument: string | null;
  customerGroup: string | null;
  customerCity: string | null;
  customerState: string | null;

  sellerId: string | null;
  externalSellerId: string | null;
  sellerName: string | null;
  sellerSource: string | null;
  sellerQualityStatus: string | null;

  paymentConditionId: string | null;
  paymentConditionName: string | null;
  paymentConditionSource: string | null;
  paymentTermsJson: unknown;
  plannedInstallmentsCount: number | null;
  plannedFirstDueDate: Date | null;
  plannedLastDueDate: Date | null;
  plannedPaymentDatesJson: unknown;
  plannedReceivableValue: number | null;
  plannedPaymentStatus: string | null;

  salesOrderItemId: string | null;
  externalSalesOrderItemId: number | null;
  orderItemSequence: number | null;
  externalProductId: number | null;
  productId: string | null;
  productCode: string | null;
  sku: string | null;
  productName: string | null;
  productDescription: string | null;
  orderedQuantity: number | null;
  orderUnitPrice: number | null;
  orderItemTotalValue: number | null;
  orderItemExpectedDeliveryDate: Date | null;
  orderItemStatus: string | null;

  stockDocumentId: string | null;
  stockDocumentExternalId: number | null;
  stockDocumentType: string | null;
  stockDocumentDate: Date | null;
  stockDocumentTotalValue: number | null;
  stockDocumentPersonId: string | null;
  stockDocumentPersonName: string | null;
  stockDocumentIdNfe: number | null;

  stockDocumentItemId: string | null;
  stockDocumentItemExternalProductId: number | null;
  stockDocumentItemProductCode: string | null;
  stockDocumentItemProductName: string | null;
  stockDocumentItemQuantity: number | null;
  stockDocumentItemUnitValue: number | null;
  stockDocumentItemTotalValue: number | null;
  matchedByProduct: boolean;
  quantityUsedForOrder: number | null;
  quantityRemainingBeforeAllocation: number | null;
  quantityRemainingAfterAllocation: number | null;
  excessQuantity: number | null;
  outsideOrderQuantity: number | null;
  allocatedValueByOrderPrice: number | null;
  allocatedValueByDocumentPrice: number | null;
  priceDifferenceValue: number | null;
  priceDifferencePercent: number | null;

  nfeId: string | null;
  nfeExternalId: number | null;
  nfeNumber: string | null;
  nfeSerie: string | null;
  nfeKey: string | null;
  nfeStatus: string | null;
  nfeOperationType: string | null;
  nfeProcessedAt: Date | null;
  nfeIssueDate: Date | null;
  nfeHeaderValue: number | null;
  nfeLinkedBy: string | null;
  nfeItemsAvailable: boolean;
  nfeItemsSource: string | null;
  nfeItemProductCode: string | null;
  nfeItemProductName: string | null;
  nfeItemQuantity: number | null;
  nfeItemUnitValue: number | null;
  nfeItemTotalValue: number | null;
  nfeItemMatchedOrderItem: boolean;

  receivableIdsJson: number[] | null;
  receivableCount: number | null;
  receivableTotalValue: number | null;
  receivableOpenValue: number | null;
  receivableReceivedValue: number | null;
  receivableDueDatesJson: Array<string | null> | null;
  receivableSettlementDatesJson: Array<string | null> | null;
  receivableStatus: string | null;
  receivableSource: string | null;

  paymentScheduledDate: Date | null;
  paymentDueDate: Date | null;
  paymentSettlementDate: Date | null;
  paymentReceivedAt: Date | null;
  paymentExpectedValue: number | null;
  paymentReceivedValue: number | null;
  paymentOpenValue: number | null;
  paymentDelayDays: number | null;
  paymentStatus: string | null;

  commercialStage: string | null;
  operationalStage: string | null;
  fiscalStage: string | null;
  financialStage: string | null;
  cashStage: string | null;
  orderToCashStage: string | null;
  temperature: string | null;
  confidenceScore: number | null;
  confidenceLabel: string | null;
  responsibleArea: string | null;
  recommendedAction: string | null;

  hasDeliveryDelay: boolean;
  hasMissingStockDocument: boolean;
  hasPartialFulfillment: boolean;
  hasFullFulfillment: boolean;
  hasExcessQuantity: boolean;
  hasProductOutsideOrder: boolean;
  hasNfeHeaderGreaterThanOrder: boolean;
  hasPriceMismatch: boolean;
  hasDocumentWithoutReceivable: boolean;
  hasReceivableWithoutSafeLink: boolean;
  hasPaymentConditionMissing: boolean;
  hasPaymentDateDivergence: boolean;
  hasOverdueReceivable: boolean;
  hasRecentPaymentNotReflected: boolean;
  alertsJson: string[];
  blockingReasonsJson: string[];

  lastOrderUpdateAt: Date | null;
  lastDocumentDate: Date | null;
  lastNfeDate: Date | null;
  lastReceivableDueDate: Date | null;
  lastReceivableSettlementDate: Date | null;
  lastEvidenceDate: Date | null;
  daysFromOrderToDocument: number | null;
  daysFromDocumentToNfe: number | null;
  daysFromNfeToReceivable: number | null;
  daysFromReceivableToSettlement: number | null;
  daysDeliveryDelay: number | null;
  daysPaymentDelay: number | null;
};

export type OrderToCashAuditBuilderSummary = {
  ordersProcessed: number;
  orderItemsProcessed: number;
  rowsGenerated: number;
  pendingLines: number;
  allocatedLines: number;
  extraItemLines: number;
  surplusLines: number;
  totalOrderValue: number;
  totalAllocatedValueByOrderPrice: number;
  totalReceivableValue: number;
  totalReceivedValue: number;
  totalOpenValue: number;
};

export type BuildOrderToCashAuditRowsResult = {
  rows: OrderToCashAuditFactRow[];
  summary: OrderToCashAuditBuilderSummary;
  warnings: string[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round6(n: number): number {
  return Number(n.toFixed(6));
}

function money(qty: number, unit: number): number {
  return round6(qty * unit);
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const [y, m, d] = trimmed.slice(0, 10).split("-").map(Number);
    return new Date(y!, m! - 1, d!);
  }
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysBetween(from: Date, to: Date): number {
  return Math.round(
    (startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000
  );
}

function toFinite(value: number | null | undefined, fallback = 0): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return value;
}

function toIsoDate(value: Date | null | undefined): string | null {
  if (!value || Number.isNaN(value.getTime())) return null;
  return value.toISOString().slice(0, 10);
}

function isCanceledStatus(status: string | null | undefined): boolean {
  const s = String(status ?? "").trim().toUpperCase();
  return s === "CANCELLED" || s === "CANCELED" || s === "CANCELADO";
}

function resolveOptions(
  options?: OrderToCashAuditBuilderOptions | null
): Required<
  Pick<
    OrderToCashAuditBuilderOptions,
    | "diasProximoEntrega"
    | "diasRecemVencido"
    | "diasBloqueio"
    | "diasAntigoCritico"
    | "priceTolerance"
  >
> & { today: Date; runId: string | null } {
  return {
    today: toDate(options?.today) ?? startOfDay(new Date()),
    runId: options?.runId ?? null,
    diasProximoEntrega:
      options?.diasProximoEntrega ?? DEFAULT_ORDER_TO_CASH_AUDIT_OPTIONS.diasProximoEntrega,
    diasRecemVencido:
      options?.diasRecemVencido ?? DEFAULT_ORDER_TO_CASH_AUDIT_OPTIONS.diasRecemVencido,
    diasBloqueio: options?.diasBloqueio ?? DEFAULT_ORDER_TO_CASH_AUDIT_OPTIONS.diasBloqueio,
    diasAntigoCritico:
      options?.diasAntigoCritico ?? DEFAULT_ORDER_TO_CASH_AUDIT_OPTIONS.diasAntigoCritico,
    priceTolerance:
      options?.priceTolerance ?? DEFAULT_ORDER_TO_CASH_AUDIT_OPTIONS.priceTolerance,
  };
}

function emptyAlertFlags() {
  return {
    hasDeliveryDelay: false,
    hasMissingStockDocument: false,
    hasPartialFulfillment: false,
    hasFullFulfillment: false,
    hasExcessQuantity: false,
    hasProductOutsideOrder: false,
    hasNfeHeaderGreaterThanOrder: false,
    hasPriceMismatch: false,
    hasDocumentWithoutReceivable: false,
    hasReceivableWithoutSafeLink: false,
    hasPaymentConditionMissing: false,
    hasPaymentDateDivergence: false,
    hasOverdueReceivable: false,
    hasRecentPaymentNotReflected: false,
  };
}

function baseRow(partial: Partial<OrderToCashAuditFactRow> & {
  auditKey: string;
  lineType: OrderToCashLineType;
}): OrderToCashAuditFactRow {
  return {
    runId: null,
    salesOrderId: null,
    externalSalesOrderId: null,
    orderCode: null,
    orderStatus: null,
    orderIssueDate: null,
    orderExpectedDeliveryDate: null,
    orderTotalValue: null,
    orderNetValue: null,
    orderGrossValue: null,
    companyId: null,
    companyName: null,
    customerId: null,
    externalCustomerId: null,
    customerName: null,
    customerDocument: null,
    customerGroup: null,
    customerCity: null,
    customerState: null,
    sellerId: null,
    externalSellerId: null,
    sellerName: null,
    sellerSource: null,
    sellerQualityStatus: null,
    paymentConditionId: null,
    paymentConditionName: null,
    paymentConditionSource: null,
    paymentTermsJson: null,
    plannedInstallmentsCount: null,
    plannedFirstDueDate: null,
    plannedLastDueDate: null,
    plannedPaymentDatesJson: null,
    plannedReceivableValue: null,
    plannedPaymentStatus: null,
    salesOrderItemId: null,
    externalSalesOrderItemId: null,
    orderItemSequence: null,
    externalProductId: null,
    productId: null,
    productCode: null,
    sku: null,
    productName: null,
    productDescription: null,
    orderedQuantity: null,
    orderUnitPrice: null,
    orderItemTotalValue: null,
    orderItemExpectedDeliveryDate: null,
    orderItemStatus: null,
    stockDocumentId: null,
    stockDocumentExternalId: null,
    stockDocumentType: null,
    stockDocumentDate: null,
    stockDocumentTotalValue: null,
    stockDocumentPersonId: null,
    stockDocumentPersonName: null,
    stockDocumentIdNfe: null,
    stockDocumentItemId: null,
    stockDocumentItemExternalProductId: null,
    stockDocumentItemProductCode: null,
    stockDocumentItemProductName: null,
    stockDocumentItemQuantity: null,
    stockDocumentItemUnitValue: null,
    stockDocumentItemTotalValue: null,
    matchedByProduct: false,
    quantityUsedForOrder: null,
    quantityRemainingBeforeAllocation: null,
    quantityRemainingAfterAllocation: null,
    excessQuantity: null,
    outsideOrderQuantity: null,
    allocatedValueByOrderPrice: null,
    allocatedValueByDocumentPrice: null,
    priceDifferenceValue: null,
    priceDifferencePercent: null,
    nfeId: null,
    nfeExternalId: null,
    nfeNumber: null,
    nfeSerie: null,
    nfeKey: null,
    nfeStatus: null,
    nfeOperationType: null,
    nfeProcessedAt: null,
    nfeIssueDate: null,
    nfeHeaderValue: null,
    nfeLinkedBy: null,
    nfeItemsAvailable: false,
    nfeItemsSource: null,
    nfeItemProductCode: null,
    nfeItemProductName: null,
    nfeItemQuantity: null,
    nfeItemUnitValue: null,
    nfeItemTotalValue: null,
    nfeItemMatchedOrderItem: false,
    receivableIdsJson: null,
    receivableCount: null,
    receivableTotalValue: null,
    receivableOpenValue: null,
    receivableReceivedValue: null,
    receivableDueDatesJson: null,
    receivableSettlementDatesJson: null,
    receivableStatus: null,
    receivableSource: null,
    paymentScheduledDate: null,
    paymentDueDate: null,
    paymentSettlementDate: null,
    paymentReceivedAt: null,
    paymentExpectedValue: null,
    paymentReceivedValue: null,
    paymentOpenValue: null,
    paymentDelayDays: null,
    paymentStatus: null,
    commercialStage: null,
    operationalStage: null,
    fiscalStage: null,
    financialStage: null,
    cashStage: null,
    orderToCashStage: null,
    temperature: null,
    confidenceScore: null,
    confidenceLabel: null,
    responsibleArea: null,
    recommendedAction: null,
    ...emptyAlertFlags(),
    alertsJson: [],
    blockingReasonsJson: [],
    lastOrderUpdateAt: null,
    lastDocumentDate: null,
    lastNfeDate: null,
    lastReceivableDueDate: null,
    lastReceivableSettlementDate: null,
    lastEvidenceDate: null,
    daysFromOrderToDocument: null,
    daysFromDocumentToNfe: null,
    daysFromNfeToReceivable: null,
    daysFromReceivableToSettlement: null,
    daysDeliveryDelay: null,
    daysPaymentDelay: null,
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Seller (pedido only)
// ---------------------------------------------------------------------------

export function resolveOrderSeller(order: OrderToCashAuditOrderInput): {
  sellerId: string | null;
  externalSellerId: string | null;
  sellerName: string;
  sellerSource: string | null;
  sellerQualityStatus: string;
} {
  const ext =
    order.externalSellerId != null && String(order.externalSellerId).trim() !== ""
      ? String(order.externalSellerId)
      : null;
  const name = order.sellerName?.trim() || null;
  if (!ext && !name && !order.sellerId) {
    return {
      sellerId: null,
      externalSellerId: null,
      sellerName: "Sem vendedor informado",
      sellerSource: order.sellerSource ?? "SALES_ORDER",
      sellerQualityStatus: "NO_SELLER",
    };
  }
  return {
    sellerId: order.sellerId ?? null,
    externalSellerId: ext,
    sellerName: name ?? "Sem vendedor informado",
    sellerSource: order.sellerSource ?? "SALES_ORDER",
    sellerQualityStatus: name || ext ? "RESOLVED" : "NO_SELLER",
  };
}

// ---------------------------------------------------------------------------
// Payment plan
// ---------------------------------------------------------------------------

export type OrderPaymentPlan = {
  paymentConditionId: string | null;
  paymentConditionName: string | null;
  paymentConditionSource: string | null;
  paymentTermsJson: { paymentTerms: string | null; paymentMethod: string | null } | null;
  plannedInstallmentsCount: number | null;
  plannedFirstDueDate: Date | null;
  plannedLastDueDate: Date | null;
  plannedPaymentDatesJson: Array<{
    installmentNumber: number;
    dueDate: string | null;
    expectedAmount: number;
  }> | null;
  plannedReceivableValue: number | null;
  plannedPaymentStatus: string;
  hasPaymentConditionMissing: boolean;
};

export function buildOrderPaymentPlan(
  order: OrderToCashAuditOrderInput
): OrderPaymentPlan {
  const terms = order.paymentTerms?.trim() || null;
  const method = order.paymentMethod?.trim() || null;
  const issueDate = toDate(order.issueDate) ?? startOfDay(new Date());
  const total = toFinite(order.totalNetValue);
  const installments = extractSalesOrderForecastInstallments(
    order.nomusRawResponse,
    total,
    issueDate
  );

  if (installments.length === 0 && !terms && !method) {
    return {
      paymentConditionId: null,
      paymentConditionName: null,
      paymentConditionSource: null,
      paymentTermsJson: null,
      plannedInstallmentsCount: null,
      plannedFirstDueDate: null,
      plannedLastDueDate: null,
      plannedPaymentDatesJson: null,
      plannedReceivableValue: null,
      plannedPaymentStatus: "MISSING_PAYMENT_CONDITION",
      hasPaymentConditionMissing: true,
    };
  }

  const dates = installments
    .map((i) => i.dueDate)
    .filter((d): d is Date => d != null)
    .sort((a, b) => a.getTime() - b.getTime());
  const plannedValue =
    installments.length > 0
      ? round6(installments.reduce((s, i) => s + i.expectedAmount, 0))
      : total > 0
        ? total
        : null;

  return {
    paymentConditionId: null,
    paymentConditionName: terms || method,
    paymentConditionSource: installments.length > 0 ? "NOMUS_RAW" : "ORDER_FIELDS",
    paymentTermsJson: { paymentTerms: terms, paymentMethod: method },
    plannedInstallmentsCount:
      installments.length > 0 ? installments.length : terms || method ? 1 : null,
    plannedFirstDueDate: dates[0] ?? null,
    plannedLastDueDate: dates.length ? dates[dates.length - 1]! : null,
    plannedPaymentDatesJson:
      installments.length > 0
        ? installments.map((i) => ({
            installmentNumber: i.installmentNumber,
            dueDate: toIsoDate(i.dueDate),
            expectedAmount: i.expectedAmount,
          }))
        : null,
    plannedReceivableValue: plannedValue,
    plannedPaymentStatus: "PLANNED",
    hasPaymentConditionMissing: false,
  };
}

// ---------------------------------------------------------------------------
// Linking helpers
// ---------------------------------------------------------------------------

export function linkNfesToOrders(
  orders: OrderToCashAuditOrderInput[],
  nfeLinks: OrderToCashAuditNfeLinkInput[],
  nfes: OrderToCashAuditNfeInput[]
): Map<string, Array<{ link: OrderToCashAuditNfeLinkInput; nfe: OrderToCashAuditNfeInput | null }>> {
  const nfeByExt = new Map(nfes.map((n) => [n.externalId, n] as const));
  const map = new Map<
    string,
    Array<{ link: OrderToCashAuditNfeLinkInput; nfe: OrderToCashAuditNfeInput | null }>
  >();
  for (const order of orders) {
    const links = nfeLinks.filter((l) => l.salesOrderId === order.id);
    map.set(
      order.id,
      links.map((link) => ({
        link,
        nfe: nfeByExt.get(link.nfeExternalId) ?? null,
      }))
    );
  }
  return map;
}

export function linkReceivablesToNfes(
  receivables: OrderToCashAuditReceivableInput[],
  nfeExternalIds: number[]
): Map<number, OrderToCashAuditReceivableInput[]> {
  const set = new Set(nfeExternalIds);
  const map = new Map<number, OrderToCashAuditReceivableInput[]>();
  for (const nfeId of set) map.set(nfeId, []);
  for (const row of receivables) {
    if (row.sourceInvoiceId != null && set.has(row.sourceInvoiceId)) {
      const list = map.get(row.sourceInvoiceId) ?? [];
      list.push(row);
      map.set(row.sourceInvoiceId, list);
    }
  }
  return map;
}

type OrderItemBalance = {
  item: OrderToCashAuditOrderItemInput;
  remainingQty: number;
};

export type StockAllocationResult = {
  allocations: Array<{
    item: OrderToCashAuditOrderItemInput;
    stockItem: OrderToCashAuditStockItemInput;
    document: OrderToCashAuditStockDocumentInput;
    quantityUsed: number;
    remainingBefore: number;
    remainingAfter: number;
    excessQuantity: number;
  }>;
  extraItems: Array<{
    stockItem: OrderToCashAuditStockItemInput;
    document: OrderToCashAuditStockDocumentInput;
    outsideOrderQuantity: number;
  }>;
  balances: OrderItemBalance[];
};

/**
 * Casa itens do pedido com itens de documento por externalProductId.
 * Nunca atende acima de 100% do saldo do item; excedente fica separado.
 */
export function linkOrderItemsToStockDocumentItems(
  orderItems: OrderToCashAuditOrderItemInput[],
  documents: OrderToCashAuditStockDocumentInput[],
  flatItems: OrderToCashAuditStockItemInput[]
): StockAllocationResult {
  const itemsByDoc = new Map<string, OrderToCashAuditStockItemInput[]>();
  for (const item of flatItems) {
    const list = itemsByDoc.get(item.stockDocumentId) ?? [];
    list.push(item);
    itemsByDoc.set(item.stockDocumentId, list);
  }

  const balances: OrderItemBalance[] = orderItems
    .filter((i) => Number.isFinite(i.quantity) && i.quantity > 0)
    .map((item) => ({ item, remainingQty: item.quantity }));

  const allocations: StockAllocationResult["allocations"] = [];
  const extraItems: StockAllocationResult["extraItems"] = [];

  const sortedDocs = [...documents].sort((a, b) => {
    const da = toDate(a.dataDocumento)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const db = toDate(b.dataDocumento)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return da - db;
  });

  for (const doc of sortedDocs) {
    const docItems =
      doc.items && doc.items.length > 0
        ? doc.items
        : itemsByDoc.get(doc.id) ?? [];

    for (const stockItem of docItems) {
      const qty = toFinite(stockItem.quantity);
      if (qty <= 0) continue;
      const productId = stockItem.externalProductId;
      if (productId == null) {
        extraItems.push({
          stockItem,
          document: doc,
          outsideOrderQuantity: qty,
        });
        continue;
      }

      const engineBalances = balances.map((b) => ({
        item: {
          id: b.item.id,
          externalProductId: b.item.externalProductId ?? null,
          quantity: b.item.quantity,
          unitPrice: b.item.unitPrice,
        },
        remainingQty: b.remainingQty,
      }));

      const result = allocateStockQuantityToOrderBalances(
        engineBalances,
        productId,
        qty
      );

      if (!result.ok) {
        if (result.reason === "NO_MATCH") {
          // Sem saldo restante no pedido para este produto → excedente ou fora
          const everInOrder = orderItems.some((i) => i.externalProductId === productId);
          if (everInOrder) {
            allocations.push({
              item: orderItems.find((i) => i.externalProductId === productId)!,
              stockItem,
              document: doc,
              quantityUsed: 0,
              remainingBefore: 0,
              remainingAfter: 0,
              excessQuantity: qty,
            });
          } else {
            extraItems.push({
              stockItem,
              document: doc,
              outsideOrderQuantity: qty,
            });
          }
        } else {
          // Ambíguo: não inventa rateio — marca como extra com warning path
          extraItems.push({
            stockItem,
            document: doc,
            outsideOrderQuantity: qty,
          });
        }
        continue;
      }

      for (const alloc of result.allocations) {
        const balance = balances.find((b) => b.item.id === alloc.balance.item.id);
        if (!balance) continue;
        const remainingBefore = balance.remainingQty;
        const used = Math.min(alloc.qty, remainingBefore);
        const excess = Math.max(0, qty - used);
        balance.remainingQty = round6(remainingBefore - used);
        allocations.push({
          item: balance.item,
          stockItem,
          document: doc,
          quantityUsed: used,
          remainingBefore,
          remainingAfter: balance.remainingQty,
          excessQuantity: excess,
        });
      }
    }
  }

  return { allocations, extraItems, balances };
}

// ---------------------------------------------------------------------------
// Classifiers
// ---------------------------------------------------------------------------

export function classifyCommercialStage(input: {
  status?: string | null;
  canceled?: boolean;
  hasAnyEvidence?: boolean;
  daysSinceIssue?: number | null;
  diasAntigoCritico?: number;
}): string {
  if (input.canceled || isCanceledStatus(input.status)) return "ORDER_CANCELLED";
  if (
    !input.hasAnyEvidence &&
    input.daysSinceIssue != null &&
    input.daysSinceIssue >= (input.diasAntigoCritico ?? 90)
  ) {
    return "ORDER_OLD_WITHOUT_EVOLUTION";
  }
  if (input.status && String(input.status).toUpperCase() === "DRAFT") return "ORDER_CREATED";
  return "ORDER_ACTIVE";
}

export function classifyOperationalStage(input: {
  hasDocument: boolean;
  fulfilledQty: number;
  orderedQty: number;
  hasExcess: boolean;
  hasOutsideProduct: boolean;
}): string {
  if (input.hasOutsideProduct && input.fulfilledQty <= 0) {
    return "DOCUMENT_WITH_OUTSIDE_PRODUCT";
  }
  if (!input.hasDocument) return "DOCUMENT_NOT_FOUND";
  if (input.orderedQty <= 0) return "NOT_FULFILLED";
  const pct = input.fulfilledQty / input.orderedQty;
  if (pct + 1e-9 >= 1) {
    return input.hasExcess ? "FULLY_FULFILLED_WITH_EXCESS" : "FULLY_FULFILLED";
  }
  if (input.fulfilledQty > 0) return "PARTIALLY_FULFILLED";
  if (input.hasOutsideProduct) return "DOCUMENT_WITH_OUTSIDE_PRODUCT";
  return "NOT_FULFILLED";
}

export function classifyFiscalStage(input: {
  hasNfe: boolean;
  nfeCancelled?: boolean;
  nfeAuthorized?: boolean;
  headerOnly?: boolean;
}): string {
  if (!input.hasNfe) return "NO_NFE";
  if (input.nfeCancelled) return "NFE_CANCELLED";
  if (input.headerOnly) return "NFE_HEADER_ONLY";
  if (input.nfeAuthorized) return "NFE_AUTHORIZED";
  return "NFE_LINKED";
}

export function classifyFinancialStage(input: {
  hasNfeOrDoc: boolean;
  receivableTotal: number;
  receivableOpen: number;
  receivableReceived: number;
  hasOverdue: boolean;
}): string {
  if (input.receivableTotal <= 0) {
    return input.hasNfeOrDoc ? "INVOICED_WITHOUT_CR" : "NO_CR";
  }
  if (input.receivableOpen <= ORDER_TO_CASH_PRICE_TOLERANCE && input.receivableReceived > 0) {
    return "CR_RECEIVED";
  }
  if (input.receivableReceived > ORDER_TO_CASH_PRICE_TOLERANCE && input.receivableOpen > 0) {
    return "CR_PARTIALLY_RECEIVED";
  }
  if (input.hasOverdue) return "CR_OVERDUE";
  return "CR_OPEN";
}

export function classifyCashStage(input: {
  paymentStatus: string;
  receivableTotal: number;
}): string {
  switch (input.paymentStatus) {
    case "PAID":
      return "CASH_RECEIVED";
    case "PAID_LATE":
      return "CASH_RECEIVED_LATE";
    case "PARTIALLY_PAID":
    case "OPEN":
    case "OVERDUE":
      return "CASH_OPEN";
    case "PLANNED_ONLY":
      return "CASH_EXPECTED";
    case "AWAITING_CR":
      return "CASH_EXPECTED";
    default:
      return input.receivableTotal > 0 ? "CASH_OPEN" : "NO_CASH";
  }
}

export function classifyPaymentStatus(input: {
  hasPaymentCondition: boolean;
  hasDocOrNfe: boolean;
  receivableTotal: number;
  receivableOpen: number;
  receivableReceived: number;
  hasOverdue: boolean;
  paidLate?: boolean;
  divergent?: boolean;
}): string {
  if (input.divergent) return "DIVERGENT";
  if (input.receivableTotal <= 0) {
    if (input.hasDocOrNfe) return "AWAITING_CR";
    return input.hasPaymentCondition ? "PLANNED_ONLY" : "PLANNED_ONLY";
  }
  if (input.receivableOpen <= ORDER_TO_CASH_PRICE_TOLERANCE && input.receivableReceived > 0) {
    return input.paidLate ? "PAID_LATE" : "PAID";
  }
  if (input.receivableReceived > ORDER_TO_CASH_PRICE_TOLERANCE && input.receivableOpen > 0) {
    return "PARTIALLY_PAID";
  }
  if (input.hasOverdue) return "OVERDUE";
  return "OPEN";
}

export function classifyOrderToCashStage(input: {
  canceled: boolean;
  commercialStage: string;
  operationalStage: string;
  fiscalStage: string;
  financialStage: string;
  cashStage: string;
  expectedDelivery: Date | null;
  today: Date;
  diasProximoEntrega: number;
  diasRecemVencido: number;
  diasBloqueio: number;
  hasEvidence: boolean;
}): string {
  if (input.canceled) return "CANCELADO";
  if (input.cashStage === "CASH_RECEIVED" || input.cashStage === "CASH_RECEIVED_LATE") {
    return "RECEBIDO";
  }
  if (input.financialStage === "CR_OPEN" || input.financialStage === "CR_OVERDUE" || input.financialStage === "CR_PARTIALLY_RECEIVED") {
    return "CR_ABERTO";
  }
  if (input.financialStage === "INVOICED_WITHOUT_CR") return "NF_SEM_CR";
  if (input.fiscalStage === "NO_NFE" && input.operationalStage !== "DOCUMENT_NOT_FOUND" && input.operationalStage !== "NOT_FULFILLED") {
    return "DOCUMENTO_SEM_NF";
  }
  if (input.operationalStage === "FULLY_FULFILLED_WITH_EXCESS") {
    return "PEDIDO_ATENDIDO_COM_EXCEDENTE";
  }
  if (input.operationalStage === "FULLY_FULFILLED") return "PEDIDO_TOTALMENTE_ATENDIDO";
  if (input.operationalStage === "PARTIALLY_FULFILLED") return "PEDIDO_PARCIALMENTE_ATENDIDO";

  const delivery = input.expectedDelivery;
  if (!input.hasEvidence && delivery) {
    const delta = daysBetween(delivery, input.today);
    if (delta >= input.diasBloqueio) return "BLOQUEADO_REVISAO";
    if (delta > 0) return "PEDIDO_ATRASADO_SEM_DOCUMENTO";
    if (delta >= -input.diasProximoEntrega) return "PEDIDO_PROXIMO_ATENCAO";
    return "PEDIDO_FUTURO_SAUDAVEL";
  }

  if (input.commercialStage === "ORDER_OLD_WITHOUT_EVOLUTION") return "BLOQUEADO_REVISAO";
  if (!input.hasEvidence) return "SEM_EVIDENCIA";
  return "PEDIDO_EMITIDO";
}

export function classifyTemperature(stage: string): string {
  switch (stage) {
    case "BLOQUEADO_REVISAO":
    case "SEM_EVIDENCIA":
      return "CONGELADO";
    case "PEDIDO_FUTURO_SAUDAVEL":
    case "RECEBIDO":
    case "PEDIDO_EMITIDO":
      return "QUENTE";
    case "PEDIDO_PROXIMO_ATENCAO":
    case "PEDIDO_PARCIALMENTE_ATENDIDO":
    case "CR_ABERTO":
    case "NF_SEM_CR":
    case "DOCUMENTO_SEM_NF":
    case "PEDIDO_TOTALMENTE_ATENDIDO":
      return "MORNO";
    case "PEDIDO_ATRASADO_SEM_DOCUMENTO":
    case "PEDIDO_ATENDIDO_COM_EXCEDENTE":
      return "FRIO";
    default:
      return "MORNO";
  }
}

export function calculateConfidenceScore(input: {
  hasDocument: boolean;
  hasNfe: boolean;
  hasSafeReceivable: boolean;
  hasPriceMismatch: boolean;
  hasAmbiguity: boolean;
  operationalStage: string;
}): { score: number; label: string } {
  let score = 40;
  if (input.hasDocument) score += 15;
  if (input.hasNfe) score += 15;
  if (input.hasSafeReceivable) score += 20;
  if (input.operationalStage === "FULLY_FULFILLED") score += 10;
  if (input.hasPriceMismatch) score -= 10;
  if (input.hasAmbiguity) score -= 20;
  score = Math.max(0, Math.min(100, score));
  const label =
    score >= 85 ? "ALTA" : score >= 60 ? "MEDIA" : score >= 30 ? "BAIXA" : "MUITO_BAIXA";
  return { score, label };
}

export function buildRecommendedAction(input: {
  orderToCashStage: string;
  alerts: string[];
}): { action: string; responsibleArea: string } {
  const stage = input.orderToCashStage;
  if (stage === "CANCELADO") {
    return { action: "Nenhuma ação — pedido cancelado.", responsibleArea: "COMERCIAL" };
  }
  if (stage === "BLOQUEADO_REVISAO" || input.alerts.includes("PEDIDO_ANTIGO_SEM_EVOLUCAO")) {
    return {
      action: "Revisar pedido antigo sem evolução operacional/fiscal.",
      responsibleArea: "DIRETORIA",
    };
  }
  if (stage === "PEDIDO_ATRASADO_SEM_DOCUMENTO" || input.alerts.includes("ENTREGA_PREVISTA_VENCIDA_SEM_DOCUMENTO")) {
    return {
      action: "Acionar PCP/Produção — entrega prevista vencida sem documento de saída.",
      responsibleArea: "PCP_PRODUCAO",
    };
  }
  if (stage === "NF_SEM_CR" || input.alerts.includes("DOCUMENTO_SEM_CR")) {
    return {
      action: "Verificar Contas a Receber para NF/documento vinculado.",
      responsibleArea: "FINANCEIRO",
    };
  }
  if (input.alerts.includes("DIVERGENCIA_PRECO") || input.alerts.includes("NF_CABECALHO_MAIOR_PEDIDO")) {
    return {
      action: "Validar divergência de preço/cabeçalho NF vs pedido.",
      responsibleArea: "FATURAMENTO",
    };
  }
  if (stage === "CR_ABERTO") {
    return { action: "Acompanhar títulos em aberto.", responsibleArea: "FINANCEIRO" };
  }
  if (stage === "RECEBIDO") {
    return { action: "Sem ação — ciclo concluído.", responsibleArea: "FINANCEIRO" };
  }
  return { action: "Acompanhar evolução Pedido → Caixa.", responsibleArea: "COMERCIAL" };
}

export function detectOrderToCashAlerts(input: {
  expectedDelivery: Date | null;
  today: Date;
  hasDocument: boolean;
  operationalStage: string;
  hasExcess: boolean;
  hasOutside: boolean;
  hasNfeHeaderGreater: boolean;
  hasPriceMismatch: boolean;
  hasDocWithoutCr: boolean;
  hasUnsafeCr: boolean;
  hasPaymentConditionMissing: boolean;
  hasPaymentDateDivergence: boolean;
  hasOverdue: boolean;
  hasRecentPaymentNotReflected: boolean;
  commercialStage: string;
  diasBloqueio: number;
}): { alerts: string[]; flags: ReturnType<typeof emptyAlertFlags>; blocking: string[] } {
  const alerts: string[] = [];
  const flags = emptyAlertFlags();
  const blocking: string[] = [];

  if (
    input.expectedDelivery &&
    !input.hasDocument &&
    daysBetween(input.expectedDelivery, input.today) > 0
  ) {
    alerts.push("ENTREGA_PREVISTA_VENCIDA_SEM_DOCUMENTO");
    flags.hasDeliveryDelay = true;
    flags.hasMissingStockDocument = true;
  }
  if (input.operationalStage === "PARTIALLY_FULFILLED") {
    alerts.push("DOCUMENTO_PARCIAL");
    flags.hasPartialFulfillment = true;
  }
  if (input.operationalStage === "FULLY_FULFILLED" || input.operationalStage === "FULLY_FULFILLED_WITH_EXCESS") {
    flags.hasFullFulfillment = true;
  }
  if (input.hasExcess) {
    alerts.push("DOCUMENTO_COM_EXCEDENTE");
    flags.hasExcessQuantity = true;
  }
  if (input.hasOutside) {
    alerts.push("PRODUTO_FORA_DO_PEDIDO");
    flags.hasProductOutsideOrder = true;
  }
  if (input.hasNfeHeaderGreater) {
    alerts.push("NF_CABECALHO_MAIOR_PEDIDO");
    flags.hasNfeHeaderGreaterThanOrder = true;
  }
  if (input.hasPriceMismatch) {
    alerts.push("DIVERGENCIA_PRECO");
    flags.hasPriceMismatch = true;
  }
  if (input.hasDocWithoutCr) {
    alerts.push("DOCUMENTO_SEM_CR");
    flags.hasDocumentWithoutReceivable = true;
  }
  if (input.hasUnsafeCr) {
    alerts.push("CR_SEM_RATEIO_SEGURO");
    flags.hasReceivableWithoutSafeLink = true;
  }
  if (input.hasPaymentConditionMissing) {
    alerts.push("CONDICAO_PAGAMENTO_AUSENTE");
    flags.hasPaymentConditionMissing = true;
  }
  if (input.hasPaymentDateDivergence) {
    alerts.push("CR_DIFERE_DA_CONDICAO_PEDIDO");
    flags.hasPaymentDateDivergence = true;
  }
  if (input.hasOverdue) {
    alerts.push("CR_VENCIDO");
    flags.hasOverdueReceivable = true;
  }
  if (input.hasRecentPaymentNotReflected) {
    alerts.push("BAIXA_NAO_REFLETIDA");
    flags.hasRecentPaymentNotReflected = true;
  }
  if (input.commercialStage === "ORDER_OLD_WITHOUT_EVOLUTION") {
    alerts.push("PEDIDO_ANTIGO_SEM_EVOLUCAO");
    blocking.push("PEDIDO_ANTIGO_SEM_EVOLUCAO");
  }
  if (
    input.expectedDelivery &&
    !input.hasDocument &&
    daysBetween(input.expectedDelivery, input.today) >= input.diasBloqueio
  ) {
    blocking.push("ENTREGA_MUITO_ATRASADA_SEM_DOCUMENTO");
  }

  return { alerts: [...new Set(alerts)], flags, blocking: [...new Set(blocking)] };
}

// ---------------------------------------------------------------------------
// Receivable aggregation
// ---------------------------------------------------------------------------

function aggregateReceivables(
  rows: OrderToCashAuditReceivableInput[],
  today: Date
): {
  ids: number[];
  total: number;
  open: number;
  received: number;
  dueDates: Array<string | null>;
  settlements: Array<string | null>;
  status: string | null;
  hasOverdue: boolean;
  paidLate: boolean;
  lastDue: Date | null;
  lastSettlement: Date | null;
} {
  if (rows.length === 0) {
    return {
      ids: [],
      total: 0,
      open: 0,
      received: 0,
      dueDates: [],
      settlements: [],
      status: null,
      hasOverdue: false,
      paidLate: false,
      lastDue: null,
      lastSettlement: null,
    };
  }
  let total = 0;
  let open = 0;
  let received = 0;
  let hasOverdue = false;
  let paidLate = false;
  const dueDates: Array<string | null> = [];
  const settlements: Array<string | null> = [];
  let lastDue: Date | null = null;
  let lastSettlement: Date | null = null;

  for (const row of rows) {
    total += toFinite(row.amountReceivable);
    const bal =
      row.balanceReceivable != null
        ? toFinite(row.balanceReceivable)
        : Math.max(0, toFinite(row.amountReceivable) - toFinite(row.amountReceived));
    open += bal;
    received += toFinite(row.amountReceived);
    const due = toDate(row.dueDate);
    const sett = toDate(row.settlementDate);
    dueDates.push(toIsoDate(due));
    settlements.push(toIsoDate(sett));
    if (due && (!lastDue || due > lastDue)) lastDue = due;
    if (sett && (!lastSettlement || sett > lastSettlement)) lastSettlement = sett;
    if (bal > ORDER_TO_CASH_PRICE_TOLERANCE && due && due < startOfDay(today)) {
      hasOverdue = true;
    }
    if (sett && due && sett > due) paidLate = true;
  }

  let status = "OPEN";
  if (open <= ORDER_TO_CASH_PRICE_TOLERANCE && received > 0) status = "RECEIVED";
  else if (received > ORDER_TO_CASH_PRICE_TOLERANCE && open > 0) status = "PARTIAL";
  else if (hasOverdue) status = "OVERDUE";

  return {
    ids: rows.map((r) => r.externalId),
    total: round6(total),
    open: round6(open),
    received: round6(received),
    dueDates,
    settlements,
    status,
    hasOverdue,
    paidLate,
    lastDue,
    lastSettlement,
  };
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

function itemTotalValue(item: OrderToCashAuditOrderItemInput): number {
  if (item.totalNetValue != null && Number.isFinite(item.totalNetValue)) {
    return round6(item.totalNetValue);
  }
  return money(item.quantity, item.unitPrice);
}

function applyOrderIdentity(
  row: OrderToCashAuditFactRow,
  order: OrderToCashAuditOrderInput,
  seller: ReturnType<typeof resolveOrderSeller>,
  plan: OrderPaymentPlan
): void {
  row.salesOrderId = order.id;
  row.externalSalesOrderId = order.externalSalesOrderId ?? null;
  row.orderCode = order.orderCode;
  row.orderStatus = order.status ?? null;
  row.orderIssueDate = toDate(order.issueDate);
  row.orderExpectedDeliveryDate = toDate(order.expectedDeliveryDate);
  row.orderNetValue = order.totalNetValue ?? null;
  row.orderGrossValue = order.totalGrossValue ?? null;
  row.orderTotalValue = order.totalNetValue ?? order.totalGrossValue ?? null;
  row.companyId = order.companyId ?? null;
  row.companyName = order.companyName ?? null;
  row.customerId = order.customerId ?? null;
  row.externalCustomerId = order.externalCustomerId ?? null;
  row.customerName = order.customerName ?? null;
  row.customerDocument = order.customerDocument ?? null;
  row.customerGroup = order.customerGroup ?? null;
  row.customerCity = order.customerCity ?? null;
  row.customerState = order.customerState ?? null;
  row.sellerId = seller.sellerId;
  row.externalSellerId = seller.externalSellerId;
  row.sellerName = seller.sellerName;
  row.sellerSource = seller.sellerSource;
  row.sellerQualityStatus = seller.sellerQualityStatus;
  row.paymentConditionId = plan.paymentConditionId;
  row.paymentConditionName = plan.paymentConditionName;
  row.paymentConditionSource = plan.paymentConditionSource;
  row.paymentTermsJson = plan.paymentTermsJson;
  row.plannedInstallmentsCount = plan.plannedInstallmentsCount;
  row.plannedFirstDueDate = plan.plannedFirstDueDate;
  row.plannedLastDueDate = plan.plannedLastDueDate;
  row.plannedPaymentDatesJson = plan.plannedPaymentDatesJson;
  row.plannedReceivableValue = plan.plannedReceivableValue;
  row.plannedPaymentStatus = plan.plannedPaymentStatus;
  row.lastOrderUpdateAt = toDate(order.updatedAt);
}

function applyItemIdentity(
  row: OrderToCashAuditFactRow,
  item: OrderToCashAuditOrderItemInput,
  orderExpected: Date | null
): void {
  row.salesOrderItemId = item.id;
  row.externalSalesOrderItemId = item.externalSalesOrderItemId ?? null;
  row.orderItemSequence = item.orderItemSequence ?? null;
  row.externalProductId = item.externalProductId ?? null;
  row.productId = item.productId ?? null;
  row.productCode = item.productCode ?? null;
  row.sku = item.sku ?? null;
  row.productName = item.productName ?? null;
  row.productDescription = item.productDescription ?? null;
  row.orderedQuantity = item.quantity;
  row.orderUnitPrice = item.unitPrice;
  row.orderItemTotalValue = itemTotalValue(item);
  row.orderItemExpectedDeliveryDate =
    toDate(item.expectedDeliveryDate) ?? orderExpected;
  row.orderItemStatus = item.itemStatus ?? null;
}

/**
 * Monta linhas OrderToCashAuditFact (puro — sem I/O).
 */
export function buildOrderToCashAuditRows(
  input: BuildOrderToCashAuditRowsInput
): BuildOrderToCashAuditRowsResult {
  const opts = resolveOptions(input.options);
  const warnings: string[] = [];
  const rows: OrderToCashAuditFactRow[] = [];

  const nfeLinks = input.nfeLinks ?? [];
  const nfes = input.nfes ?? [];
  const stockDocuments = input.stockDocuments ?? [];
  const stockDocumentItems = input.stockDocumentItems ?? [];
  const receivables = input.receivables ?? [];
  // reconciliationFacts são evidência auxiliar — não alteram valores oficiais do pedido
  if ((input.reconciliationFacts?.length ?? 0) > 0) {
    warnings.push(
      "reconciliationFacts fornecidos como evidência auxiliar; alocação principal usa documentos oficiais."
    );
  }

  const itemsByOrder = new Map<string, OrderToCashAuditOrderItemInput[]>();
  for (const item of input.orderItems) {
    const list = itemsByOrder.get(item.salesOrderId) ?? [];
    list.push(item);
    itemsByOrder.set(item.salesOrderId, list);
  }

  const nfeMap = linkNfesToOrders(input.orders, nfeLinks, nfes);
  const stockByNfe = new Map<number, OrderToCashAuditStockDocumentInput[]>();
  for (const doc of stockDocuments) {
    if (doc.idNfe == null) continue;
    const list = stockByNfe.get(doc.idNfe) ?? [];
    list.push(doc);
    stockByNfe.set(doc.idNfe, list);
  }

  let pendingLines = 0;
  let allocatedLines = 0;
  let extraItemLines = 0;
  let surplusLines = 0;
  let totalOrderValue = 0;
  let totalAllocatedValueByOrderPrice = 0;
  let totalReceivableValue = 0;
  let totalReceivedValue = 0;
  let totalOpenValue = 0;
  let orderItemsProcessed = 0;

  for (const order of input.orders) {
    const orderItems = itemsByOrder.get(order.id) ?? [];
    orderItemsProcessed += orderItems.length;
    totalOrderValue += toFinite(order.totalNetValue);
    if (orderItems.length === 0) {
      warnings.push(`Pedido ${order.orderCode} sem itens — ignorado no grão item.`);
      continue;
    }

    const seller = resolveOrderSeller(order);
    const plan = buildOrderPaymentPlan(order);
    const orderExpected = toDate(order.expectedDeliveryDate);
    const issueDate = toDate(order.issueDate);
    const daysSinceIssue =
      issueDate != null ? daysBetween(issueDate, opts.today) : null;

    const linkedNfes = nfeMap.get(order.id) ?? [];
    const orderDocs: OrderToCashAuditStockDocumentInput[] = [];
    for (const { link } of linkedNfes) {
      for (const doc of stockByNfe.get(link.nfeExternalId) ?? []) {
        orderDocs.push(doc);
      }
    }
    // Documentos sem NF link mas presentes no input com items do pedido — não força vínculo inventado

    const allocation = linkOrderItemsToStockDocumentItems(
      orderItems,
      orderDocs,
      stockDocumentItems
    );

    const nfeExternalIds = linkedNfes.map((x) => x.link.nfeExternalId);
    const receivablesByNfe = linkReceivablesToNfes(receivables, nfeExternalIds);
    const allOrderReceivables: OrderToCashAuditReceivableInput[] = [];
    let hasUnsafeCrHint = false;
    for (const nfeId of nfeExternalIds) {
      const matched = receivablesByNfe.get(nfeId) ?? [];
      allOrderReceivables.push(...matched);
    }
    // Indício sem vínculo seguro: CR com número de NF batendo fraco não é inventado aqui
    for (const r of receivables) {
      if (
        r.sourceInvoiceId == null &&
        r.sourceInvoiceNumber &&
        linkedNfes.some(
          (x) =>
            x.link.nfeNumber &&
            String(x.link.nfeNumber).replace(/\D/g, "") ===
              String(r.sourceInvoiceNumber).replace(/\D/g, "")
        )
      ) {
        hasUnsafeCrHint = true;
      }
    }

    const recvAgg = aggregateReceivables(allOrderReceivables, opts.today);
    totalReceivableValue += recvAgg.total;
    totalReceivedValue += recvAgg.received;
    totalOpenValue += recvAgg.open;

    const headerSum = linkedNfes.reduce((s, x) => s + toFinite(x.nfe?.valorLiquido), 0);
    const orderValue = toFinite(order.totalNetValue);
    const attributedAllocated = allocation.allocations.reduce(
      (s, a) => s + money(a.quantityUsed, a.item.unitPrice),
      0
    );
    // Cap: valor atribuído nunca passa do pedido
    const cappedAttributed = Math.min(attributedAllocated, orderValue || attributedAllocated);
    const hasNfeHeaderGreater =
      headerSum > 0 &&
      orderValue > 0 &&
      headerSum > orderValue + ORDER_TO_CASH_PRICE_TOLERANCE;

    const orderedQty = orderItems.reduce((s, i) => s + toFinite(i.quantity), 0);
    const fulfilledQty = allocation.allocations.reduce((s, a) => s + a.quantityUsed, 0);
    const hasExcess =
      allocation.allocations.some((a) => a.excessQuantity > 0) ||
      allocation.extraItems.length > 0 &&
        allocation.allocations.some((a) => a.excessQuantity > 0);
    const hasExcessQty = allocation.allocations.some((a) => a.excessQuantity > 0);
    const hasOutside = allocation.extraItems.length > 0;
    const hasDocument = orderDocs.length > 0;
    const hasNfe = linkedNfes.length > 0;
    const hasEvidence = hasDocument || hasNfe || recvAgg.total > 0;

    const commercialStage = classifyCommercialStage({
      status: order.status,
      canceled: isCanceledStatus(order.status),
      hasAnyEvidence: hasEvidence,
      daysSinceIssue,
      diasAntigoCritico: opts.diasAntigoCritico,
    });
    const operationalStage = classifyOperationalStage({
      hasDocument,
      fulfilledQty,
      orderedQty,
      hasExcess: hasExcessQty,
      hasOutsideProduct: hasOutside,
    });
    const anyNfeCancelled = linkedNfes.some((x) => {
      const st = String(x.nfe?.status ?? x.link.nfeStatus ?? "");
      return st === "3" || st.toUpperCase().includes("CANCEL");
    });
    const headerOnly = hasNfe && !hasDocument;
    const fiscalStage = classifyFiscalStage({
      hasNfe,
      nfeCancelled: anyNfeCancelled,
      nfeAuthorized: hasNfe && !anyNfeCancelled,
      headerOnly,
    });
    const hasDocOrNfe = hasDocument || hasNfe;
    const paymentStatus = classifyPaymentStatus({
      hasPaymentCondition: !plan.hasPaymentConditionMissing,
      hasDocOrNfe,
      receivableTotal: recvAgg.total,
      receivableOpen: recvAgg.open,
      receivableReceived: recvAgg.received,
      hasOverdue: recvAgg.hasOverdue,
      paidLate: recvAgg.paidLate,
      divergent: false,
    });
    const financialStage = classifyFinancialStage({
      hasNfeOrDoc: hasDocOrNfe,
      receivableTotal: recvAgg.total,
      receivableOpen: recvAgg.open,
      receivableReceived: recvAgg.received,
      hasOverdue: recvAgg.hasOverdue,
    });
    const cashStage = classifyCashStage({
      paymentStatus,
      receivableTotal: recvAgg.total,
    });
    const expectedForStage =
      orderItems.map((i) => toDate(i.expectedDeliveryDate)).find(Boolean) ??
      orderExpected;
    const orderToCashStage = classifyOrderToCashStage({
      canceled: isCanceledStatus(order.status),
      commercialStage,
      operationalStage,
      fiscalStage,
      financialStage,
      cashStage,
      expectedDelivery: expectedForStage,
      today: opts.today,
      diasProximoEntrega: opts.diasProximoEntrega,
      diasRecemVencido: opts.diasRecemVencido,
      diasBloqueio: opts.diasBloqueio,
      hasEvidence,
    });
    const temperature = classifyTemperature(orderToCashStage);
    const confidence = calculateConfidenceScore({
      hasDocument,
      hasNfe,
      hasSafeReceivable: recvAgg.total > 0,
      hasPriceMismatch: allocation.allocations.some((a) =>
        pricesMismatch(a.item.unitPrice, a.stockItem.unitValue)
      ),
      hasAmbiguity: false,
      operationalStage,
    });
    const alertBundle = detectOrderToCashAlerts({
      expectedDelivery: expectedForStage,
      today: opts.today,
      hasDocument,
      operationalStage,
      hasExcess: hasExcessQty,
      hasOutside,
      hasNfeHeaderGreater,
      hasPriceMismatch: allocation.allocations.some((a) =>
        pricesMismatch(a.item.unitPrice, a.stockItem.unitValue)
      ),
      hasDocWithoutCr: hasDocOrNfe && recvAgg.total <= 0,
      hasUnsafeCr: hasUnsafeCrHint && recvAgg.total <= 0,
      hasPaymentConditionMissing: plan.hasPaymentConditionMissing,
      hasPaymentDateDivergence: false,
      hasOverdue: recvAgg.hasOverdue,
      hasRecentPaymentNotReflected: false,
      commercialStage,
      diasBloqueio: opts.diasBloqueio,
    });
    const action = buildRecommendedAction({
      orderToCashStage,
      alerts: alertBundle.alerts,
    });

    const lastDocDate = orderDocs
      .map((d) => toDate(d.dataDocumento))
      .filter((d): d is Date => d != null)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const lastNfeDate =
      linkedNfes
        .map((x) => toDate(x.nfe?.issueDate ?? x.nfe?.dataProcessamento ?? x.link.dataProcessamento))
        .filter((d): d is Date => d != null)
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

    const applyStages = (row: OrderToCashAuditFactRow) => {
      row.runId = opts.runId;
      row.commercialStage = commercialStage;
      row.operationalStage = operationalStage;
      row.fiscalStage = fiscalStage;
      row.financialStage = financialStage;
      row.cashStage = cashStage;
      row.orderToCashStage = orderToCashStage;
      row.temperature = temperature;
      row.confidenceScore = confidence.score;
      row.confidenceLabel = confidence.label;
      row.responsibleArea = action.responsibleArea;
      row.recommendedAction = action.action;
      Object.assign(row, alertBundle.flags);
      row.alertsJson = [...alertBundle.alerts];
      row.blockingReasonsJson = [...alertBundle.blocking];
      row.paymentStatus = paymentStatus;
      row.lastDocumentDate = lastDocDate;
      row.lastNfeDate = lastNfeDate;
      row.lastReceivableDueDate = recvAgg.lastDue;
      row.lastReceivableSettlementDate = recvAgg.lastSettlement;
      row.lastEvidenceDate =
        recvAgg.lastSettlement ?? lastDocDate ?? lastNfeDate ?? issueDate;
      if (issueDate && lastDocDate) {
        row.daysFromOrderToDocument = daysBetween(issueDate, lastDocDate);
      }
      if (lastDocDate && lastNfeDate) {
        row.daysFromDocumentToNfe = daysBetween(lastDocDate, lastNfeDate);
      }
      if (lastNfeDate && recvAgg.lastDue) {
        row.daysFromNfeToReceivable = daysBetween(lastNfeDate, recvAgg.lastDue);
      }
      if (recvAgg.lastDue && recvAgg.lastSettlement) {
        row.daysFromReceivableToSettlement = daysBetween(
          recvAgg.lastDue,
          recvAgg.lastSettlement
        );
      }
      if (expectedForStage && !hasDocument && expectedForStage < opts.today) {
        row.daysDeliveryDelay = daysBetween(expectedForStage, opts.today);
      }
      if (recvAgg.hasOverdue && recvAgg.lastDue) {
        row.daysPaymentDelay = daysBetween(recvAgg.lastDue, opts.today);
      }
      row.paymentDueDate = recvAgg.lastDue ?? plan.plannedFirstDueDate;
      row.paymentScheduledDate = plan.plannedFirstDueDate;
      row.paymentSettlementDate = recvAgg.lastSettlement;
      row.paymentReceivedAt = recvAgg.lastSettlement;
      row.paymentExpectedValue = plan.plannedReceivableValue ?? orderValue;
      row.paymentReceivedValue = recvAgg.received > 0 ? recvAgg.received : null;
      row.paymentOpenValue = recvAgg.open > 0 ? recvAgg.open : null;
      row.paymentDelayDays = row.daysPaymentDelay;
      if (recvAgg.ids.length > 0) {
        row.receivableIdsJson = recvAgg.ids;
        row.receivableCount = recvAgg.ids.length;
        row.receivableTotalValue = recvAgg.total;
        row.receivableOpenValue = recvAgg.open;
        row.receivableReceivedValue = recvAgg.received;
        row.receivableDueDatesJson = recvAgg.dueDates;
        row.receivableSettlementDatesJson = recvAgg.settlements;
        row.receivableStatus = recvAgg.status;
        row.receivableSource = "ID_NFE";
      }
    };

    const applyNfeToRow = (
      row: OrderToCashAuditFactRow,
      nfeExtId: number | null | undefined
    ) => {
      if (nfeExtId == null) return;
      const linked = linkedNfes.find((x) => x.link.nfeExternalId === nfeExtId);
      if (!linked) return;
      const nfe = linked.nfe;
      row.nfeId = nfe?.id ?? linked.link.nomusNfeId ?? null;
      row.nfeExternalId = nfeExtId;
      row.nfeNumber = linked.link.nfeNumber ?? nfe?.numero ?? null;
      row.nfeSerie = linked.link.nfeSerie ?? nfe?.serie ?? null;
      row.nfeKey = linked.link.nfeKey ?? nfe?.chave ?? null;
      row.nfeStatus =
        linked.link.nfeStatus != null
          ? String(linked.link.nfeStatus)
          : nfe?.status != null
            ? String(nfe.status)
            : null;
      row.nfeOperationType =
        linked.link.tipoOperacao != null
          ? String(linked.link.tipoOperacao)
          : nfe?.tipoOperacao != null
            ? String(nfe.tipoOperacao)
            : null;
      row.nfeProcessedAt = toDate(
        linked.link.dataProcessamento ?? nfe?.dataProcessamento
      );
      row.nfeIssueDate = toDate(nfe?.issueDate ?? nfe?.dataProcessamento);
      row.nfeHeaderValue = nfe?.valorLiquido ?? null;
      row.nfeLinkedBy = "SalesOrderNfeLink";
      row.nfeItemsAvailable = false;
      row.nfeItemsSource = "HEADER";
    };

    // Linhas alocadas / excedente por documento
    for (const alloc of allocation.allocations) {
      if (alloc.quantityUsed > 0) {
        const usedValueOrder = money(alloc.quantityUsed, alloc.item.unitPrice);
        // Guardrail: não acumular acima do pedido (alerta não duplica valor)
        const allocValue = usedValueOrder;
        totalAllocatedValueByOrderPrice += allocValue;

        const priceDiffUnit = round6(alloc.stockItem.unitValue - alloc.item.unitPrice);
        const mismatch = pricesMismatch(alloc.item.unitPrice, alloc.stockItem.unitValue);

        const row = baseRow({
          auditKey: `${order.id}:${alloc.item.id}:${alloc.stockItem.id}:alloc`,
          lineType: "ORDER_ITEM_ALLOCATED",
        });
        applyOrderIdentity(row, order, seller, plan);
        applyItemIdentity(row, alloc.item, orderExpected);
        applyStages(row);
        applyNfeToRow(row, alloc.document.idNfe);

        row.stockDocumentId = alloc.document.id;
        row.stockDocumentExternalId = alloc.document.externalId;
        row.stockDocumentType = alloc.document.tipoDocumentoEstoque ?? null;
        row.stockDocumentDate = toDate(alloc.document.dataDocumento);
        row.stockDocumentTotalValue = alloc.document.totalValue ?? null;
        row.stockDocumentPersonId = alloc.document.personId ?? null;
        row.stockDocumentPersonName = alloc.document.personName ?? null;
        row.stockDocumentIdNfe = alloc.document.idNfe ?? null;

        row.stockDocumentItemId = alloc.stockItem.id;
        row.stockDocumentItemExternalProductId = alloc.stockItem.externalProductId ?? null;
        row.stockDocumentItemProductCode = alloc.stockItem.productCode ?? null;
        row.stockDocumentItemProductName = alloc.stockItem.productName ?? null;
        row.stockDocumentItemQuantity = alloc.stockItem.quantity;
        row.stockDocumentItemUnitValue = alloc.stockItem.unitValue;
        row.stockDocumentItemTotalValue =
          alloc.stockItem.estimatedTotalValue ??
          money(alloc.stockItem.quantity, alloc.stockItem.unitValue);
        row.matchedByProduct = true;
        row.quantityUsedForOrder = alloc.quantityUsed;
        row.quantityRemainingBeforeAllocation = alloc.remainingBefore;
        row.quantityRemainingAfterAllocation = alloc.remainingAfter;
        row.excessQuantity = alloc.excessQuantity > 0 ? alloc.excessQuantity : null;
        row.allocatedValueByOrderPrice = allocValue;
        row.allocatedValueByDocumentPrice = money(
          alloc.quantityUsed,
          alloc.stockItem.unitValue
        );
        row.priceDifferenceValue = mismatch
          ? money(alloc.quantityUsed, priceDiffUnit)
          : null;
        row.priceDifferencePercent =
          mismatch && alloc.item.unitPrice > 0
            ? round6((priceDiffUnit / alloc.item.unitPrice) * 100)
            : null;
        row.nfeItemMatchedOrderItem = true;
        if (alloc.excessQuantity > 0) {
          row.hasExcessQuantity = true;
          if (!row.alertsJson.includes("DOCUMENTO_COM_EXCEDENTE")) {
            row.alertsJson = [...row.alertsJson, "DOCUMENTO_COM_EXCEDENTE"];
          }
        }
        if (mismatch) {
          row.hasPriceMismatch = true;
          if (!row.alertsJson.includes("DIVERGENCIA_PRECO")) {
            row.alertsJson = [...row.alertsJson, "DIVERGENCIA_PRECO"];
          }
        }

        rows.push(row);
        allocatedLines += 1;
      }

      if (alloc.excessQuantity > 0 && alloc.quantityUsed === 0) {
        const row = baseRow({
          auditKey: `${order.id}:${alloc.item.id}:${alloc.stockItem.id}:surplus`,
          lineType: "QUANTITY_SURPLUS",
        });
        applyOrderIdentity(row, order, seller, plan);
        applyItemIdentity(row, alloc.item, orderExpected);
        applyStages(row);
        applyNfeToRow(row, alloc.document.idNfe);
        row.stockDocumentId = alloc.document.id;
        row.stockDocumentExternalId = alloc.document.externalId;
        row.stockDocumentDate = toDate(alloc.document.dataDocumento);
        row.stockDocumentIdNfe = alloc.document.idNfe ?? null;
        row.stockDocumentItemId = alloc.stockItem.id;
        row.stockDocumentItemExternalProductId = alloc.stockItem.externalProductId ?? null;
        row.stockDocumentItemQuantity = alloc.stockItem.quantity;
        row.stockDocumentItemUnitValue = alloc.stockItem.unitValue;
        row.quantityUsedForOrder = 0;
        row.excessQuantity = alloc.excessQuantity;
        row.allocatedValueByOrderPrice = 0;
        row.allocatedValueByDocumentPrice = 0;
        row.hasExcessQuantity = true;
        if (!row.alertsJson.includes("DOCUMENTO_COM_EXCEDENTE")) {
          row.alertsJson = [...row.alertsJson, "DOCUMENTO_COM_EXCEDENTE"];
        }
        rows.push(row);
        surplusLines += 1;
      } else if (alloc.excessQuantity > 0 && alloc.quantityUsed > 0) {
        // Excedente residual após alocação parcial do mesmo item de documento
        const row = baseRow({
          auditKey: `${order.id}:${alloc.item.id}:${alloc.stockItem.id}:surplus-tail`,
          lineType: "QUANTITY_SURPLUS",
        });
        applyOrderIdentity(row, order, seller, plan);
        applyItemIdentity(row, alloc.item, orderExpected);
        applyStages(row);
        applyNfeToRow(row, alloc.document.idNfe);
        row.stockDocumentId = alloc.document.id;
        row.stockDocumentExternalId = alloc.document.externalId;
        row.stockDocumentItemId = alloc.stockItem.id;
        row.quantityUsedForOrder = 0;
        row.excessQuantity = alloc.excessQuantity;
        row.allocatedValueByOrderPrice = 0;
        row.allocatedValueByDocumentPrice = 0;
        row.hasExcessQuantity = true;
        rows.push(row);
        surplusLines += 1;
      }
    }

    // Produtos fora do pedido
    for (const extra of allocation.extraItems) {
      const row = baseRow({
        auditKey: `${order.id}:extra:${extra.stockItem.id}`,
        lineType: "DOCUMENT_EXTRA_ITEM",
      });
      applyOrderIdentity(row, order, seller, plan);
      applyStages(row);
      applyNfeToRow(row, extra.document.idNfe);
      row.stockDocumentId = extra.document.id;
      row.stockDocumentExternalId = extra.document.externalId;
      row.stockDocumentDate = toDate(extra.document.dataDocumento);
      row.stockDocumentIdNfe = extra.document.idNfe ?? null;
      row.stockDocumentItemId = extra.stockItem.id;
      row.stockDocumentItemExternalProductId = extra.stockItem.externalProductId ?? null;
      row.stockDocumentItemProductCode = extra.stockItem.productCode ?? null;
      row.stockDocumentItemProductName = extra.stockItem.productName ?? null;
      row.stockDocumentItemQuantity = extra.stockItem.quantity;
      row.stockDocumentItemUnitValue = extra.stockItem.unitValue;
      row.outsideOrderQuantity = extra.outsideOrderQuantity;
      row.quantityUsedForOrder = 0;
      row.allocatedValueByOrderPrice = 0;
      row.allocatedValueByDocumentPrice = 0;
      row.hasProductOutsideOrder = true;
      if (!row.alertsJson.includes("PRODUTO_FORA_DO_PEDIDO")) {
        row.alertsJson = [...row.alertsJson, "PRODUTO_FORA_DO_PEDIDO"];
      }
      rows.push(row);
      extraItemLines += 1;
    }

    // Itens do pedido sem (ou com saldo residual) atendimento → ORDER_ITEM_PENDING
    for (const balance of allocation.balances) {
      if (balance.remainingQty <= ORDER_TO_CASH_PRICE_TOLERANCE) continue;
      const wasPartiallyAllocated = allocation.allocations.some(
        (a) => a.item.id === balance.item.id && a.quantityUsed > 0
      );
      // Se parcialmente alocado, ainda gera pending pelo residual (grão item)
      const row = baseRow({
        auditKey: `${order.id}:${balance.item.id}:pending`,
        lineType: "ORDER_ITEM_PENDING",
      });
      applyOrderIdentity(row, order, seller, plan);
      applyItemIdentity(row, balance.item, orderExpected);
      applyStages(row);
      if (linkedNfes[0]) applyNfeToRow(row, linkedNfes[0].link.nfeExternalId);
      row.quantityUsedForOrder = 0;
      row.quantityRemainingBeforeAllocation = balance.remainingQty;
      row.quantityRemainingAfterAllocation = balance.remainingQty;
      row.allocatedValueByOrderPrice = 0;
      if (wasPartiallyAllocated) {
        row.hasPartialFulfillment = true;
      }
      rows.push(row);
      pendingLines += 1;
    }

    // Guardrail de valor: se soma atribuída > pedido, warning (não inventa corte por linha já capped)
    if (
      orderValue > 0 &&
      cappedAttributed > orderValue + ORDER_TO_CASH_PRICE_TOLERANCE
    ) {
      warnings.push(
        `Pedido ${order.orderCode}: valor atribuído por preço do pedido excede totalNetValue — revisar alocação.`
      );
    }
    void hasExcess;
  }

  // Clamp totalAllocated no sumário ao total de pedidos (alertas não duplicam valor)
  const summaryAllocated = Math.min(
    round6(totalAllocatedValueByOrderPrice),
    round6(totalOrderValue) || round6(totalAllocatedValueByOrderPrice)
  );

  return {
    rows,
    summary: {
      ordersProcessed: input.orders.length,
      orderItemsProcessed,
      rowsGenerated: rows.length,
      pendingLines,
      allocatedLines,
      extraItemLines,
      surplusLines,
      totalOrderValue: round6(totalOrderValue),
      totalAllocatedValueByOrderPrice: summaryAllocated,
      totalReceivableValue: round6(totalReceivableValue),
      totalReceivedValue: round6(totalReceivedValue),
      totalOpenValue: round6(totalOpenValue),
    },
    warnings,
  };
}
