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
 *   - salesOrderEffectiveFinancialSchedule (FIN-05) via
 *     salesOrderDetailEffectiveFinancial (FIN-06)
 *   - NomusAccountsReceivable (CR real no audit)
 *   - nomusSalesOrderItemStatus.parseNomusSalesOrderItemStatusFromRawItem
 */

import type { SalesOrderBillingStatus } from "@/src/lib/sales/salesOrderListBillingStatus";
import type { SalesOrderDetailIndustrialResultBlock } from "./salesOrderDetailIndustrialResult.js";
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
// Financeiro (agenda efetiva FIN-05/FIN-06)
// ---------------------------------------------------------------------------

export type SalesOrderDetailDocumentScheduleEntry =
  | {
      kind: "DOCUMENT_SCHEDULE";
      documentKey: string;
      sourceInvoiceId: number | null;
      allocatedByOrderPrice: number;
      installments: Array<{
        installmentNumber: number;
        dueDate: string | null;
        amount: number;
      }>;
    }
  | {
      kind: "DOCUMENT_AWAITING_FINANCIAL_SCHEDULE";
      documentKey: string;
      sourceInvoiceId: number | null;
      allocatedByOrderPrice: number;
      dueDate: null;
      installments: [];
    };

export type SalesOrderDetailCoverageSummary = {
  plannedNetTotal: number;
  itemActiveResidualTotal: number;
  coveredByRealReceivables: number;
  coveredByDocumentsWithoutCr: number;
  documentAwaitingAmount: number;
  activeOrderResidualTotal: number;
  supersededOrderTotal: number;
  cutAmount: number;
  canceledAmount: number;
  unresolvedAmount: number;
  /** Agenda real/documental (CR + Doc sem CR), sem somar residual/corte. */
  realOrDocumentAgendaTotal: number;
  /**
   * NO_MATERIALIZATION = previsão integral do Pedido (não é residual pós-NF).
   * Demais modos: residual/substituição após Documento/CR.
   */
  materializationMode?: string;
  precedenceSource:
    | "REAL_RECEIVABLE"
    | "OUTPUT_DOCUMENT"
    | "ORDER_PLAN"
    | "MIXED"
    | "NONE";
};

export type SalesOrderDetailEffectiveAlert = {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  documentKey?: string;
  salesOrderItemId?: string;
  installmentNumber?: number;
};

/** Status permitidos no histórico da previsão original (FIN-07). */
export type SalesOrderDetailOriginalForecastHistoryStatus =
  | "Substituída"
  | "Parcialmente substituída"
  | "Encerrada por corte"
  | "Cancelada";

export type SalesOrderDetailOriginalForecastHistoryRow = {
  key: string;
  kind: "installment" | "cut_summary" | "canceled_summary";
  installmentNumber: number | null;
  totalInstallments: number | null;
  dueDate: string | null;
  originalAmount: number;
  /** Parte ainda residual (ativa na tabela principal). */
  residualAmount: number;
  /** Parte substituída por CR/Documento. */
  substitutedAmount: number;
  status: SalesOrderDetailOriginalForecastHistoryStatus;
  note: string;
};

export type SalesOrderDetailFinancial = {
  /** Motor canônico da agenda efetiva. */
  engine: "salesOrderEffectiveFinancialSchedule";
  /** CR real (NomusAccountsReceivable). */
  realReceivables: OrderFullAuditReceivable[];
  /** Condição vigente do Documento (ou awaiting sem datas do Pedido). */
  documentSchedule: SalesOrderDetailDocumentScheduleEntry[];
  /** Previsão residual ativa (itens ainda ativos; datas originais do Pedido). */
  plannedReceivables: OrderFullAuditPlannedReceivable[];
  /** Previsão original substituída (histórico — nunca status "Vencido"). */
  supersededPlannedReceivables: OrderFullAuditPlannedReceivable[];
  /**
   * Histórico da previsão original para a seção recolhida (FIN-07).
   * Status apenas: Substituída | Parcialmente substituída | Encerrada por corte | Cancelada.
   */
  originalForecastHistory: SalesOrderDetailOriginalForecastHistoryRow[];
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
  /** Valor cortado (não é saldo financeiro). */
  cutAmount: number;
  /** Valor cancelado. */
  canceledAmount: number;
  /** Valor não resolvido (status UNKNOWN). */
  unresolvedAmount: number;
  coverageSummary: SalesOrderDetailCoverageSummary;
  /** Totais legados alinhados ao residual efetivo (compat UI). */
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
    precedenceSource?:
      | "REAL_RECEIVABLE"
      | "OUTPUT_DOCUMENT"
      | "ORDER_PLAN"
      | "MIXED"
      | "NONE";
  };
  /**
   * Próximo vencimento somente de entradas efetivas
   * (CR aberto + Doc comprovado + residual ativo).
   */
  effectiveNextDueDate: string | null;
  effectiveAlerts: SalesOrderDetailEffectiveAlert[];
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
   * null somente quando `fiscalTaxesAccess === "denied"`.
   * Autorizado: sempre objeto com `status` available|unavailable|partial|error.
   */
  fiscalTaxes: SalesOrderFiscalTaxesPayload | null;
  /** Gate oficial da aba Tributos (backend). */
  fiscalTaxesAccess: "allowed" | "denied";
  /**
   * Abas Custos / Resultado — mesmo motor do relatório industrial + explosão MP.
   * Sempre presente quando ok; `available: false` se não apurou.
   */
  industrialResult: SalesOrderDetailIndustrialResultBlock;
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
