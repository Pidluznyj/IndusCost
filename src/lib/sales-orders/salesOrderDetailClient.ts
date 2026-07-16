/**
 * Contrato client-safe do Detalhe do Pedido de Venda.
 *
 * DTO único consumido por:
 *   - Modal `SalesOrderDetailDialog` (grande, quase fullscreen)
 *   - Componente compartilhado `SalesOrderDetailView` (mesmo layout do PDF)
 *   - Rota `/sales-orders/:id` (fallback página cheia)
 *
 * Sem Prisma. Serializável (todos os campos são `string`/`number`/`boolean`/`null`).
 * Motores oficiais que alimentam este DTO:
 *   - SalesOrder + SalesOrderItem (Prisma)
 *   - salesOrderNomusSellerDisplay.buildSalesOrderNomusSellerDto
 *   - crmCustomerCommercialOwner.loadManualCommercialOwnersForCustomers
 *   - salesOrderLinkedNfe.loadSalesOrderLinkedNfeContextMap
 *   - salesOrderListBillingStatus.resolveSalesOrderBillingStatus
 *   - salesOrderMarginService.calculateSalesOrderMarginsForOrders
 *   - orderReceivablesResolver.resolveReceivablesForSalesOrder
 *     (via getOrderFullAudit → CR real + planned + receipts)
 *   - nomusSalesOrderItemStatus.parseNomusSalesOrderItemStatusFromRawItem
 */

import type { SalesOrderBillingStatus } from "@/src/lib/sales/salesOrderListBillingStatus";
import type {
  OrderFullAuditPlannedReceivable,
  OrderFullAuditReceipt,
  OrderFullAuditReceivable,
  OrderFullAuditAlert,
} from "@/src/lib/finance/orderFullAuditClient";
import type { SalesOrderFiscalTaxesPayload } from "./salesOrderFiscalTaxesClient";

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

export type SalesOrderDetailHeader = {
  orderCode: string;
  externalSalesOrderCode: string | null;
  status: string;
  statusLabel: string;
  billingStatus: SalesOrderBillingStatus;
  billingStatusLabel: string;
  customerId: string | null;
  customerName: string;
  customerCnpj: string | null;
  companyName: string | null;
  issueDate: string | null;
  expectedDeliveryDate: string | null;
  sellerName: string;
  sellerExternalId: number | null;
  commercialResponsibleName: string | null;
  operationalResponsibleName: string | null;
  paymentConditionLabel: string;
  paymentMethodLabel: string;
  freightCondition: string | null;
  deliveryLocation: string | null;
  notes: string | null;
  internalNotes: string | null;
  sentToNomusAt: string | null;
};

// ---------------------------------------------------------------------------
// Summary cards
// ---------------------------------------------------------------------------

export type SalesOrderDetailSummary = {
  originalValue: number;
  activeValue: number;
  canceledValue: number;
  cutValue: number;
  invoicedValue: number;
  pendingBalance: number;
  itemsCount: number;
  activeItemsCount: number;
  canceledItemsCount: number;
  cutItemsCount: number;
  ticket: number;
  hasInvoice: boolean;
  nfeCount: number;
  lastNfeDate: string | null;
  marginValue: number | null;
  marginPercent: number | null;
  invoiceCoveragePercent: number | null;
};

// ---------------------------------------------------------------------------
// Item
// ---------------------------------------------------------------------------

export type SalesOrderDetailItemNfeLink = {
  nfeNumber: string | null;
  nfeExternalId: number | null;
  documentNumber: string | null;
};

export type SalesOrderDetailItem = {
  salesOrderItemId: string;
  itemSequence: number | null;
  sku: string;
  productName: string;
  unit: string | null;
  quantityOrdered: number;
  quantityFulfilled: number;
  quantityPending: number;
  quantityCanceled: number;
  quantityCut: number;
  statusRaw: string | null;
  statusNormalized: string;
  statusLabel: string;
  isCanceled: boolean;
  isCut: boolean;
  isStale: boolean;
  unitPrice: number;
  totalValue: number;
  activeValue: number;
  canceledValue: number;
  unitCost: number | null;
  marginValue: number | null;
  marginPercent: number | null;
  marginStatus: string | null;
  expectedDeliveryDate: string | null;
  linkedNfes: SalesOrderDetailItemNfeLink[];
};

// ---------------------------------------------------------------------------
// Invoices + stock documents
// ---------------------------------------------------------------------------

export type SalesOrderDetailInvoice = {
  nfeExternalId: number;
  numero: string | null;
  serie: string | null;
  chave: string | null;
  dataProcessamento: string | null;
  dataEmissao: string | null;
  valorTotal: number | null;
  valorLiquido: number | null;
  allocatedValueToOrder: number;
  headerGreaterThanOrder: boolean;
  hasExtraItems: boolean;
  linkedStockDocumentExternalIds: number[];
};

export type SalesOrderDetailStockDocument = {
  stockDocumentExternalId: number;
  numero: string | null;
  dataDocumento: string | null;
  valorTotal: number | null;
  allocatedValueToOrder: number;
  hasExcess: boolean;
  hasOutside: boolean;
  idNfe: number | null;
};

// ---------------------------------------------------------------------------
// Financeiro (real + planejado)
// ---------------------------------------------------------------------------

export type SalesOrderDetailFinancial = {
  realReceivables: OrderFullAuditReceivable[];
  /** Parcelas vigentes (previsão residual ativa). */
  plannedReceivables: OrderFullAuditPlannedReceivable[];
  /** Previsão original substituída (histórico/auditoria). */
  supersededPlannedReceivables: OrderFullAuditPlannedReceivable[];
  receipts: OrderFullAuditReceipt[];
  totals: {
    totalAmount: number;
    openAmount: number;
    receivedAmount: number;
    overdueCount: number;
    nextDueDate: string | null;
    maxAmount: number;
    totalCount: number;
  };
  plannedTotals: {
    totalCount: number;
    totalExpected: number;
    applicableExpected: number;
    openExpected: number;
    overdueExpected: number;
    overdueCount: number;
    nextDueDate: string | null;
    replacedCount: number;
    replacedAmount: number;
    coveredByRealReceivables?: number;
    coveredByDocumentsWithoutRealReceivable?: number;
    remainingPlannedValue?: number;
    fullySuperseded?: boolean;
    partiallySuperseded?: boolean;
    precedenceSource?: "REAL_RECEIVABLE" | "OUTPUT_DOCUMENT" | "ORDER_PLAN" | "MIXED";
  };
  /** Próximo vencimento da agenda efetiva (CR aberto + previsão residual). */
  effectiveNextDueDate: string | null;
};

// ---------------------------------------------------------------------------
// Margem / Formação de preço
// ---------------------------------------------------------------------------

export type SalesOrderDetailPricingMargin = {
  valueSold: number;
  valueActive: number;
  totalCost: number | null;
  marginValue: number | null;
  marginPercent: number | null;
  itemsWithoutMargin: number;
  itemsIgnored: number;
  priceTableDiff: number | null;
  orderVsDocumentDiff: number | null;
  source: string;
};

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

export type SalesOrderDetailAlert = OrderFullAuditAlert;

export type SalesOrderDetailPayload = {
  ok: true;
  salesOrderId: string;
  orderCode: string;
  generatedAt: string;
  header: SalesOrderDetailHeader;
  summary: SalesOrderDetailSummary;
  items: SalesOrderDetailItem[];
  invoices: SalesOrderDetailInvoice[];
  stockDocuments: SalesOrderDetailStockDocument[];
  financial: SalesOrderDetailFinancial;
  pricingMargin: SalesOrderDetailPricingMargin;
  alerts: SalesOrderDetailAlert[];
  /**
   * Aba Tributos (camada A — destacados na NF).
   * null quando o usuário não tem permissão de faturamento/NF ou quando omitido.
   */
  fiscalTaxes: SalesOrderFiscalTaxesPayload | null;
  technicalInfo: {
    sources: string[];
    sourceTables: string[];
    salesOrderId: string;
    orderCode: string;
    generatedAt: string;
    runId: string | null;
  };
};

export type SalesOrderDetailError = {
  ok: false;
  status: number;
  error: string;
};

export type SalesOrderDetailResponse =
  | SalesOrderDetailPayload
  | SalesOrderDetailError;

// ---------------------------------------------------------------------------
// URL helpers (frontend-safe)
// ---------------------------------------------------------------------------

export function getSalesOrderDetailUrl(salesOrderId: string): string {
  return `/api/sales-orders/${salesOrderId}/detail`;
}
