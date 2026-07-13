/** Contratos client (sem Prisma) da Auditoria Completa do Pedido. */

export type OrderFullAuditItem = {
  salesOrderItemId: string;
  externalSalesOrderItemId: number | null;
  itemSequence: string | null;
  productCode: string | null;
  sku: string | null;
  productName: string | null;
  quantity: number | null;
  unitPrice: number | null;
  totalNetValue: number | null;
  nomusItemStatusRaw: string | null;
  nomusItemStatusNormalized: string | null;
  itemStatus: string | null;
  nomusIsCanceled: boolean;
  nomusIsCut: boolean;
  nomusIsStale: boolean;
  nomusQuantityFulfilled: number | null;
  nomusQuantityPending: number | null;
  matchConfidence: string | null;
};

export type OrderFullAuditReceivable = {
  receivableExternalId: number;
  companyName: string | null;
  personName: string | null;
  personCnpj: string | null;
  description: string | null;
  sourceInvoiceId: number | null;
  sourceInvoiceNumber: string | null;
  dueDate: string | null;
  competenceDate: string | null;
  scheduleDate: string | null;
  settlementDate: string | null;
  amountReceivable: number | null;
  amountReceived: number | null;
  balanceReceivable: number | null;
  paymentMethodName: string | null;
  bankAccountName: string | null;
  status:
    | "RECEIVED"
    | "PARTIALLY_RECEIVED"
    | "OVERDUE"
    | "OPEN"
    | "UNKNOWN";
  linkedNfeExternalIds: number[];
  origin: "NFE" | "SOURCE_INVOICE" | "INFERRED" | "UNKNOWN";
};

export type OrderFullAuditNfe = {
  nfeExternalId: number;
  numero: string | null;
  serie: string | null;
  chave: string | null;
  dataProcessamento: string | null;
  dataEmissao: string | null;
  status: number | null;
  tipoOperacao: number | null;
  valorLiquido: number | null;
  valorTotal: number | null;
  allocatedValueToOrder: number;
  headerGreaterThanOrder: boolean;
  hasReceivable: boolean;
  linkedStockDocumentExternalIds: number[];
};

export type OrderFullAuditStockDocument = {
  stockDocumentExternalId: number;
  tipoDocumentoEstoque: string | null;
  dataDocumento: string | null;
  idNfe: number | null;
  totalValue: number;
  allocatedValue: number;
  outsideOrderValue: number;
  quantityDocument: number;
  quantityUsedForOrder: number;
  excessQuantity: number;
  outsideOrderQuantity: number;
  hasExcess: boolean;
  hasOutside: boolean;
  productLines: number;
};

export type OrderFullAuditTimelinePoint = {
  key:
    | "ORDER_ISSUED"
    | "STOCK_DOCUMENT"
    | "NFE"
    | "RECEIVABLE"
    | "PAYMENT";
  label: string;
  date: string | null;
  detail: string | null;
  active: boolean;
};

export type OrderFullAuditAlert = {
  code: string;
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  origin: string;
  action: string;
  financialImpact: number | null;
};

export type OrderFullAuditSummary = {
  orderCode: string | null;
  customerName: string | null;
  externalCustomerId: number | null;
  customerDocument: string | null;
  companyName: string | null;
  orderIssueDate: string | null;
  orderExpectedDeliveryDate: string | null;
  paymentTerms: string | null;
  paymentMethod: string | null;
  freightCondition: string | null;
  commercialResponsibleName: string | null;
  orderSellerName: string | null;
  operationalResponsibleArea: string | null;
  originalOrderValue: number;
  canceledOrderValue: number;
  cutOrderValue: number;
  activeOrderValue: number;
  allocatedOrderValue: number;
  pendingActiveOrderValue: number;
  fulfillmentPercentActive: number;
  receivableTotalValue: number;
  receivableOpenValue: number;
  receivableReceivedValue: number;
  operationalStage: string | null;
  financialStage: string | null;
  orderToCashStage: string | null;
  temperature: string | null;
  consolidatedStatus: string | null;
};

export type OrderFullAuditPayload = {
  ok: true;
  salesOrderId: string;
  orderCode: string | null;
  runId: string | null;
  summary: OrderFullAuditSummary;
  timeline: OrderFullAuditTimelinePoint[];
  items: OrderFullAuditItem[];
  itemFacts: unknown[];
  receivables: OrderFullAuditReceivable[];
  receivablesTotal: {
    totalAmount: number;
    openAmount: number;
    receivedAmount: number;
    overdueCount: number;
    nextDueDate: string | null;
    maxAmount: number;
    totalCount: number;
  };
  stockDocuments: OrderFullAuditStockDocument[];
  nfes: OrderFullAuditNfe[];
  delivery: {
    expectedDeliveryDate: string | null;
    freightCondition: string | null;
    paymentTerms: string | null;
    paymentMethod: string | null;
    lastStockDocumentDate: string | null;
    lastNfeDate: string | null;
    lastReceivableSettlement: string | null;
  };
  alerts: OrderFullAuditAlert[];
};

export const ORDER_FULL_AUDIT_TABS = [
  { id: "summary", label: "Resumo" },
  { id: "items", label: "Itens" },
  { id: "financial", label: "Financeiro" },
  { id: "documents", label: "Documentos" },
  { id: "nfes", label: "NF-e" },
  { id: "delivery", label: "Entrega / Frete" },
  { id: "alerts", label: "Alertas" },
] as const;

export type OrderFullAuditTabId = (typeof ORDER_FULL_AUDIT_TABS)[number]["id"];

export function buildOrderFullAuditUrl(
  salesOrderId: string,
  runId?: string | null
): string {
  const qs = new URLSearchParams();
  if (runId) qs.set("runId", runId);
  const query = qs.toString();
  return `/api/finance/portfolio-reconciliation/orders/${encodeURIComponent(salesOrderId)}/audit-full${query ? `?${query}` : ""}`;
}
