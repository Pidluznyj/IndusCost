/** Contratos client (sem Prisma) da Auditoria Completa do Pedido. */

export type OrderFullAuditItem = {
  salesOrderItemId: string;
  externalSalesOrderItemId: number | null;
  itemSequence: string | null;
  productCode: string | null;
  sku: string | null;
  productName: string | null;
  productExternalId: number | null;
  unit: string | null;
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
  proposalItemId: string | null;
  activeQuantity: number | null;
  canceledQuantity: number | null;
  cutQuantity: number | null;
  activePendingQuantity: number | null;
  activeValue: number | null;
  canceledValue: number | null;
  cutValue: number | null;
  expectedDeliveryDate: string | null;
  productionQuantity: number | null;
  invoicedQuantity: number | null;
  saldoAFaturar: number | null;
  saldoPronto: number | null;
  movementType: string | null;
  cfop: string | null;
  linkedStockDocumentExternalIds: number[];
  linkedNfeExternalIds: number[];
  linkedReceivableExternalIds: number[];
  alerts: string[];
};

export type OrderFullAuditReceivable = {
  receivableExternalId: number;
  receivableId: string | null;
  companyName: string | null;
  personName: string | null;
  personCnpj: string | null;
  description: string | null;
  sourceInvoiceId: number | null;
  sourceInvoiceNumber: string | null;
  issueDate: string | null;
  dueDate: string | null;
  competenceDate: string | null;
  scheduleDate: string | null;
  settlementDate: string | null;
  amountReceivable: number | null;
  amountScheduled: number | null;
  amountReceived: number | null;
  balanceReceivable: number | null;
  installmentNumber: number | null;
  totalInstallments: number | null;
  paymentTermsText: string | null;
  paymentMethodName: string | null;
  bankAccountName: string | null;
  comments: string | null;
  status:
    | "RECEIVED"
    | "PARTIALLY_RECEIVED"
    | "OVERDUE"
    | "OPEN"
    | "UNKNOWN";
  daysOverdue: number | null;
  linkedNfeExternalIds: number[];
  origin: "NFE" | "SOURCE_INVOICE" | "INFERRED" | "UNKNOWN";
  linkOrigin:
    | "ITEM_EVIDENCE"
    | "HEADER_ONLY"
    | "SOURCE_INVOICE"
    | "INFERRED"
    | "UNKNOWN";
  alerts: string[];
  searchReference: string;
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
  insideOrderItemsValue: number;
  outsideOrderItemsValue: number;
  headerGreaterThanOrder: boolean;
  hasReceivable: boolean;
  hasExtraItems: boolean;
  customerName: string | null;
  companyName: string | null;
  linkedStockDocumentExternalIds: number[];
  linkedReceivableExternalIds: number[];
  linkOrigin:
    | "ITEM_EVIDENCE"
    | "HEADER_ONLY"
    | "SALES_ORDER_NFE_LINK"
    | "UNKNOWN";
  alerts: string[];
};

export type OrderFullAuditNfeItem = {
  nfeExternalId: number;
  nfeNumber: string | null;
  nfeItemIndex: number | null;
  productSku: string | null;
  productName: string | null;
  productExternalId: number | null;
  unit: string | null;
  cfop: string | null;
  quantityNfe: number | null;
  unitValueNfe: number | null;
  totalValueNfe: number | null;
  taxes: number | null;
  linkedSalesOrderItemId: string | null;
  linkedOrderItemSequence: string | null;
  linkedStockDocumentExternalId: number | null;
  linkedStockDocumentItemId: string | null;
  orderUnitPrice: number | null;
  documentUnitPrice: number | null;
  priceDiffNfeVsOrderAbsolute: number | null;
  priceDiffNfeVsOrderPercent: number | null;
  priceDiffNfeVsDocumentAbsolute: number | null;
  priceDiffNfeVsDocumentPercent: number | null;
  alerts: string[];
};

export type OrderFullAuditStockDocument = {
  stockDocumentExternalId: number;
  tipoDocumentoEstoque: string | null;
  dataDocumento: string | null;
  dataMovimentacao: string | null;
  customerName: string | null;
  companyName: string | null;
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
  status: string | null;
  linkOrigin:
    | "ITEM_EVIDENCE"
    | "HEADER_ONLY"
    | "SALES_ORDER_NFE_LINK"
    | "UNKNOWN";
  alerts: string[];
};

export type OrderFullAuditStockDocumentItem = {
  stockDocumentExternalId: number;
  stockDocumentItemId: string;
  externalItemId: number | null;
  productSku: string | null;
  productName: string | null;
  productExternalId: number | null;
  unit: string | null;
  quantityDocument: number | null;
  quantityUsedForOrder: number | null;
  excessQuantity: number | null;
  unitValue: number | null;
  totalValue: number | null;
  linkedSalesOrderId: string | null;
  linkedOrderCode: string | null;
  linkedSalesOrderItemId: string | null;
  linkedOrderItemSequence: string | null;
  orderUnitPrice: number | null;
  priceDiffAbsolute: number | null;
  priceDiffPercent: number | null;
  financialImpact: number | null;
  nfeExternalId: number | null;
  nfeNumber: string | null;
  receivableExternalId: number | null;
  lineType: string | null;
  alerts: string[];
};

export type OrderFullAuditTimelinePoint = {
  key:
    | "PROPOSAL"
    | "ORDER_ISSUED"
    | "STOCK_DOCUMENT"
    | "NFE"
    | "RECEIVABLE"
    | "DUE_DATE"
    | "PAYMENT";
  label: string;
  date: string | null;
  detail: string | null;
  active: boolean;
  amount?: number | null;
  alert?: string | null;
};

export type OrderFullAuditAlertCategory =
  | "COMMERCIAL"
  | "ORDER"
  | "ORDER_ITEM"
  | "STOCK_DOCUMENT"
  | "NFE"
  | "RECEIVABLE"
  | "RECEIPT"
  | "DELIVERY"
  | "FREIGHT"
  | "MARGIN_PRICING"
  | "COMMISSION"
  | "INTEGRATION_NOMUS"
  | "REGISTRATION";

export type OrderFullAuditAlertSeverity =
  | "critical"
  | "high"
  | "medium"
  | "info"
  | "warning";

export type OrderFullAuditAlert = {
  code: string;
  severity: OrderFullAuditAlertSeverity;
  title: string;
  description: string;
  origin: string;
  action: string;
  financialImpact: number | null;
  category: OrderFullAuditAlertCategory;
  entityType: string | null;
  entityId: string | null;
  reference: string | null;
  quantityImpact: number | null;
  alertDate: string | null;
  status: "OPEN" | "ACK" | "RESOLVED";
  linkedTab:
    | "summary"
    | "proposal"
    | "salesOrder"
    | "items"
    | "documents"
    | "nfes"
    | "financial"
    | "delivery"
    | "marginPricing"
    | "commissions"
    | "divergences"
    | "technicalAudit"
    | null;
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
  receivableOverdueValue: number;
  stockDocumentsTotalValue: number;
  stockDocumentsAllocatedValue: number;
  nfeTotalValue: number;
  nfeAllocatedValue: number;
  diffs: {
    orderVsStockDocument: number;
    orderVsNfe: number;
    orderVsReceivable: number;
    activeVsReceivable: number;
    allocatedVsReceivable: number;
  };
  operationalStatus: string | null;
  financialStatus: string | null;
  operationalStage: string | null;
  financialStage: string | null;
  orderToCashStage: string | null;
  temperature: string | null;
  consolidatedStatus: string | null;
  alertCount: number;
};

/**
 * Blocos previstos que ainda vão receber composição rica em prompts seguintes.
 * Aqui a UI conhece apenas a estrutura mínima para renderizar placeholders.
 */
export type OrderFullAuditProposalItem = {
  proposalItemId: string;
  productId: string | null;
  productSku: string | null;
  productName: string | null;
  unit: string | null;
  quantity: number | null;
  unitCost: number | null;
  suggestedPrice: number | null;
  negotiatedPrice: number | null;
  discountPerc: number | null;
  discountValue: number | null;
  totalNetValue: number | null;
  marginValue: number | null;
  marginPerc: number | null;
  taxesPerc: number | null;
  taxesValue: number | null;
  commissionPerc: number | null;
  commissionValue: number | null;
  freightValue: number | null;
  externalItemStatus: string | null;
  priceTableCode: string | null;
  convertedToSalesOrderItem: {
    salesOrderItemId: string;
    quantity: number | null;
    negotiatedPrice: number | null;
    totalNetValue: number | null;
    quantityDiff: number;
    negotiatedPriceDiff: number;
    totalNetValueDiff: number;
  } | null;
  alerts: string[];
};

export type OrderFullAuditProposalBlock = {
  present: boolean;
  emptyReason:
    | "NO_PROPOSAL_LINK"
    | "PROPOSAL_NOT_FOUND"
    | "PROPOSAL_LOAD_ERROR"
    | null;
  proposalId: string | null;
  proposalNumber: string | null;
  title: string | null;
  externalProposalId: number | null;
  externalProposalCode: string | null;
  externalSellerId: number | null;
  status: string | null;
  createdAt: string | null;
  approvedAt: string | null;
  expectedCloseDate: string | null;
  validityDays: number | null;
  validUntil: string | null;
  responsible: string | null;
  companyIssuer: string | null;
  paymentTerms: string | null;
  paymentMethod: string | null;
  freightCondition: string | null;
  priceTableId: string | null;
  priceTableVersionId: string | null;
  priceTableCode: string | null;
  priceSource: string | null;
  totals: {
    totalItems: number | null;
    totalGrossValue: number | null;
    totalDiscount: number | null;
    totalNetValue: number | null;
    totalCost: number | null;
    totalMarginValue: number | null;
    totalMarginPerc: number | null;
    totalTaxes: number | null;
    totalCommission: number | null;
    totalFreight: number | null;
  };
  derivedValues: {
    proposalTotalValue: number | null;
    approvedTotalValue: number | null;
    convertedToOrderValue: number | null;
    proposalVsOrderDiff: number | null;
  };
  items: OrderFullAuditProposalItem[];
  deltasVsSalesOrder: {
    quantityDiff: number;
    negotiatedPriceDiff: number;
    totalNetValueDiff: number;
    marginPercDiff: number | null;
  } | null;
};

export type OrderFullAuditProposalOrderComparison = {
  paymentTerms: {
    proposal: string | null;
    salesOrder: string | null;
    matches: boolean;
  };
  paymentMethod: {
    proposal: string | null;
    salesOrder: string | null;
    matches: boolean;
  };
  freightCondition: {
    proposal: string | null;
    salesOrder: string | null;
    matches: boolean;
  };
  totalNetValue: {
    proposal: number | null;
    salesOrder: number | null;
    diff: number | null;
    matches: boolean;
  };
  itemsMapping: {
    proposalItemCount: number;
    salesOrderItemCount: number;
    convertedCount: number;
    proposalItemsNotConverted: number;
    salesOrderItemsWithoutProposalItem: number;
    priceMismatches: number;
  };
};

export type OrderFullAuditSalesOrderBlock = {
  orderCode: string | null;
  status: string | null;
  sourceSystem: string | null;
  issueDate: string | null;
  expectedDeliveryDate: string | null;
  sentToNomusAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  lastSyncedAt: string | null;
  identifiers: {
    id: string;
    externalSalesOrderId: number | null;
    externalSalesOrderCode: string | null;
    externalCustomerId: number | null;
    externalCompanyId: number | null;
  };
  customer: {
    id: string | null;
    name: string | null;
    document: string | null;
  };
  companyName: string | null;
  orderType: string | null;
  movementType: string | null;
  operationalSector: string | null;
  operationalResponsibleName: string | null;
  commercialResponsibleName: string | null;
  orderSellerName: string | null;
  orderSellerExternalId: number | null;
  paymentTerms: string | null;
  paymentTermsText: string | null;
  paymentMethod: string | null;
  freightCondition: string | null;
  freightMode: string | null;
  deliveryLocation: string | null;
  notes: string | null;
  internalNotes: string | null;
  totals: {
    grossValue: number | null;
    discount: number | null;
    netValue: number | null;
    cost: number | null;
    marginValue: number | null;
    marginPerc: number | null;
    taxes: number | null;
    freight: number | null;
    insurance: number | null;
    otherExpenses: number | null;
    itemsSummedNetValue: number | null;
    headerVsItemsDiff: number | null;
  };
  itemCounts: {
    total: number;
    active: number;
    canceled: number;
    cut: number;
    stale: number;
    fulfilled: number;
    pendingActive: number;
    fulfillmentPercentActive: number;
  };
  nomusRawResponsePresent: boolean;
};

export type OrderFullAuditReceipt = {
  receivableExternalId: number;
  settlementDate: string | null;
  paymentDate: string | null;
  amountReceived: number;
  interest: number | null;
  discount: number | null;
  lateFee: number | null;
  paymentMethodName: string | null;
  bankAccountName: string | null;
  sourceInvoiceId: number | null;
  sourceInvoiceNumber: string | null;
  history: string | null;
  externalReceiptId: number | null;
  userOrSystem: string | null;
};

export type OrderFullAuditFreightBlock = {
  freightCondition: string | null;
  freightAmount: number | null;
  carrierName: string | null;
  carrierExternalId: number | null;
  transportMode: string | null;
  responsibleForFreight: string | null;
  deliveryLocation: string | null;
  deliveryAddress: string | null;
  deliveryNotes: string | null;
  internalNotes: string | null;
};

export type OrderFullAuditDeliveryBlock = {
  expectedDeliveryDate: string | null;
  orderIssueDate: string | null;
  lastStockDocumentDate: string | null;
  lastNfeDate: string | null;
  lastReceivableSettlement: string | null;
  freightCondition: string | null;
  paymentTerms: string | null;
  paymentMethod: string | null;
  leadTimePromisedDays: number | null;
  leadTimeRealDays: number | null;
  delayDays: number | null;
  forecastNextDeliveryDate: string | null;
  operationalStatus: string | null;
  itemCounts: {
    total: number;
    active: number;
    fulfilled: number;
    pendingActive: number;
    canceled: number;
    cut: number;
    overdue: number;
    readyNotInvoiced: number;
  };
  totals: {
    quantityOrdered: number;
    quantityProduced: number;
    quantityInvoiced: number;
    saldoAFaturar: number;
    saldoPronto: number;
  };
};

export type OrderFullAuditMarginPricingItem = {
  salesOrderItemId: string;
  productCode: string | null;
  productName: string | null;
  itemSequence: string | null;
  itemStatus: string;
  isActive: boolean;
  isCanceled: boolean;
  isCut: boolean;
  isStale: boolean;
  activeQuantity: number | null;
  orderUnitPrice: number | null;
  officialTableUnitPrice: number | null;
  documentUnitPrice: number | null;
  nfeUnitPrice: number | null;
  priceDiffOrderVsTableAbs: number | null;
  priceDiffOrderVsTablePercent: number | null;
  priceDiffOrderVsDocumentAbs: number | null;
  priceDiffOrderVsDocumentPercent: number | null;
  priceDiffDocumentVsNfeAbs: number | null;
  priceDiffDocumentVsNfePercent: number | null;
  unitCost: number | null;
  totalCost: number | null;
  netRevenue: number | null;
  marginValue: number | null;
  marginPercent: number | null;
  fiscalRule: string | null;
  priceTableCode: string | null;
  priceTableVersion: string | null;
  priceTableEffectiveDate: string | null;
  costEffectiveDate: string | null;
  commissionEstimated: number | null;
  marginStatus: string;
  marginStatusLabel: string;
  reason: string | null;
  alerts: string[];
};

export type OrderFullAuditMarginPricingBlock = {
  totals: {
    totalNetRevenue: number | null;
    totalCost: number | null;
    marginValue: number | null;
    marginPerc: number | null;
    coverage: number | null;
    canceledValue: number;
    cutValue: number;
    staleValue: number;
    noMarginValue: number;
    priceOrderVsTableDelta: number;
    priceOrderVsDocumentDelta: number;
  };
  counts: {
    activeItems: number;
    canceledItems: number;
    cutItems: number;
    staleItems: number;
    noMarginItems: number;
    priceMismatchItems: number;
    negativeMarginItems: number;
    missingCostItems: number;
    missingTableItems: number;
  };
  items: OrderFullAuditMarginPricingItem[];
  itemMargins: Array<{
    salesOrderItemId: string;
    status: string;
    netRevenue: number | null;
    totalCost: number | null;
    marginValue: number | null;
    marginPerc: number | null;
    costSource: string | null;
    costConfidence: string | null;
  }>;
  officialPriceReferences: Array<{
    salesOrderItemId: string;
    priceTableCode: string | null;
    priceTableVersion: string | null;
    officialSalePrice: number | null;
    negotiatedPrice: number | null;
    deltaPercent: number | null;
  }>;
  source: "SNAPSHOT_SALES_ORDER_ITEM" | "MARGIN_SERVICE_RECOMPUTED" | "NONE";
  todo?: string;
};

export type OrderFullAuditCommissionItem = {
  salesOrderItemId: string;
  productCode: string | null;
  productName: string | null;
  itemSequence: string | null;
  itemStatus: string;
  isActive: boolean;
  isCanceled: boolean;
  isCut: boolean;
  isStale: boolean;
  activeQuantity: number | null;
  commissionBase: number | null;
  marginPercent: number | null;
  commissionRatePercent: number | null;
  finalCommissionAmount: number | null;
  grossCommissionAmount: number | null;
  ruleId: string | null;
  ruleName: string | null;
  ruleBaseType: string | null;
  ruleReleaseRule: string | null;
  status: string | null;
  exclusionReason: string | null;
  alerts: string[];
};

export type OrderFullAuditCommissionScheduleEntry = {
  receivableExternalId: number | null;
  receivableCode: string | null;
  installmentNumber: number | null;
  receivableNominalAmount: number | null;
  receivableSharePercent: number | null;
  scheduledCommissionAmount: number | null;
  scheduleDate: string | null;
  status: string | null;
};

export type OrderFullAuditCommissionReceipt = {
  ledgerLineKey: string;
  receivableExternalId: number | null;
  receivableNumber: string | null;
  installmentNumber: number | null;
  settlementDate: string | null;
  dueDate: string | null;
  receivedAmount: number | null;
  releasedCommissionAmount: number | null;
  paidCommissionAmount: number | null;
  blockedCommissionAmount: number | null;
  status: string | null;
  paymentDate: string | null;
  paymentStatus: string | null;
  canonicalSellerName: string | null;
  rawSellerName: string | null;
};

export type OrderFullAuditCommissionCustomerException = {
  id: string;
  reason: string;
  startDate: string | null;
  endDate: string | null;
  active: boolean;
  productCode: string | null;
  commissionPersonName: string | null;
};

export type OrderFullAuditCommissionBlock = {
  present: boolean;
  readOnly: true;
  snapshotId: string | null;
  snapshotStatus: string | null;
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  rawSellerId: number | null;
  rawSellerName: string | null;
  commercialResponsibleName: string | null;
  totals: {
    totalSoldAmount: number | null;
    totalGrossCommissionAmount: number | null;
    totalFinalCommissionAmount: number | null;
    totalConfirmedAmount: number | null;
    totalReleasedAmount: number | null;
    totalPaidAmount: number | null;
    totalBlockedAmount: number | null;
    commissionableBase: number | null;
    ignoredBase: number | null;
  };
  counts: {
    totalItems: number;
    itemsWithCommission: number;
    itemsExcluded: number;
    canceledItems: number;
    cutItems: number;
    staleItems: number;
  };
  items: OrderFullAuditCommissionItem[];
  receivableSchedule: OrderFullAuditCommissionScheduleEntry[];
  receipts: OrderFullAuditCommissionReceipt[];
  customerExceptions: OrderFullAuditCommissionCustomerException[];
  todo?: string;
};

export type OrderFullAuditDivergenceBlock = {
  hasAny: boolean;
  counts: {
    critical: number;
    high: number;
    medium: number;
    warning: number;
    info: number;
  };
  metrics: {
    financialImpactTotal: number;
    affectedItems: number;
    affectedTitles: number;
    affectedDocuments: number;
    affectedNfes: number;
  };
  byCategory: Record<OrderFullAuditAlertCategory, number>;
  alerts: OrderFullAuditAlert[];
};

export type OrderFullAuditTechnicalSource = {
  name: string;
  label: string;
  category:
    | "SALES_ORDER"
    | "PROPOSAL"
    | "NOMUS_STOCK_DOCUMENT"
    | "NOMUS_NFE"
    | "NOMUS_RECEIVABLE"
    | "AUDIT_FACT"
    | "COMMISSION"
    | "PRICING"
    | "CRM";
  recordCount: number;
  status: "loaded" | "not_found" | "not_applicable" | "error";
  note: string | null;
};

export type OrderFullAuditTechnicalIdentifiers = {
  salesOrderId: string;
  externalSalesOrderId: number | null;
  externalSalesOrderCode: string | null;
  orderCode: string | null;
  proposalId: string | null;
  externalProposalId: number | null;
  customerId: string | null;
  externalCustomerId: number | null;
  externalSellerId: number | null;
  externalCompanyId: number | null;
  stockDocumentExternalIds: number[];
  nfeExternalIds: number[];
  receivableExternalIds: number[];
  commissionSnapshotId: string | null;
  commissionLedgerLineKeys: string[];
  runId: string | null;
  runFinishedAt: string | null;
  runSource: string;
};

export type OrderFullAuditTechnicalRule = {
  code: string;
  label: string;
  description: string;
  category:
    | "ORDER_ITEM"
    | "DOCUMENT_ALLOCATION"
    | "NFE"
    | "RECEIVABLE"
    | "COMMISSION"
    | "MARGIN"
    | "COMMERCIAL";
};

export type OrderFullAuditTechnicalHistory = {
  lastNomusSalesOrderSync: string | null;
  lastNomusNfeSync: string | null;
  lastNomusStockDocumentSync: string | null;
  lastNomusReceivableSync: string | null;
  lastOrderToCashRebuild: string | null;
  lastPortfolioReconciliationRun: string | null;
  lastCommissionRebuild: string | null;
  auditRunUser: string | null;
  auditRunProcess: string | null;
  auditRunCommit: string | null;
  alertsCreated: number;
  alertsResolved: number;
};

export type OrderFullAuditTechnicalRawStatus = {
  included: boolean;
  reason: string;
  requiredPermission: string;
};

export type OrderFullAuditTechnicalRawPayloads = {
  nomusRawResponse: unknown | null;
  nomusRawItems: Record<string, unknown>;
  stockDocumentPayloads: Record<string, unknown>;
  nfePayloads: Record<string, unknown>;
  receivablePayloads: Record<string, unknown>;
  factsSample: unknown[];
};

export type OrderFullAuditTechnicalAuditBlock = {
  orderToCashRunId: string | null;
  orderToCashFinishedAt: string | null;
  syncedAt: {
    salesOrder: string | null;
    lastNfeSyncedAt: string | null;
    lastReceivableSyncedAt: string | null;
    lastStockDocumentSyncedAt: string | null;
  };
  sourceTables: string[];
  sources: OrderFullAuditTechnicalSource[];
  identifiers: OrderFullAuditTechnicalIdentifiers;
  rulesApplied: OrderFullAuditTechnicalRule[];
  history: OrderFullAuditTechnicalHistory;
  matchConfidenceSummary: Record<string, number>;
  factCount: number;
  gaps: string[];
  rawStatus: OrderFullAuditTechnicalRawStatus;
  rawPayloads?: OrderFullAuditTechnicalRawPayloads;
};

export type OrderFullAuditPayload = {
  ok: true;
  salesOrderId: string;
  orderCode: string | null;
  runId: string | null;
  runMeta: {
    runId: string | null;
    orderToCashFinishedAt: string | null;
  };
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
  stockDocumentItems: OrderFullAuditStockDocumentItem[];
  nfeItems: OrderFullAuditNfeItem[];
  nfes: OrderFullAuditNfe[];
  delivery: OrderFullAuditDeliveryBlock;
  alerts: OrderFullAuditAlert[];
  proposal: OrderFullAuditProposalBlock;
  proposalVsOrderComparisons: OrderFullAuditProposalOrderComparison | null;
  salesOrder: OrderFullAuditSalesOrderBlock;
  receipts: OrderFullAuditReceipt[];
  freight: OrderFullAuditFreightBlock;
  marginPricing: OrderFullAuditMarginPricingBlock;
  commissions: OrderFullAuditCommissionBlock;
  divergences: OrderFullAuditDivergenceBlock;
  technicalAudit: OrderFullAuditTechnicalAuditBlock;
};

/**
 * Abas oficiais da janela "Auditoria 360º do Pedido".
 * Ordem = ordem de exibição na barra de tabs.
 */
export const ORDER_FULL_AUDIT_TABS = [
  { id: "summary", label: "Resumo Executivo" },
  { id: "proposal", label: "Proposta / Origem Comercial" },
  { id: "salesOrder", label: "Pedido de Venda" },
  { id: "items", label: "Itens do Pedido" },
  { id: "documents", label: "Documentos de Saída" },
  { id: "nfes", label: "NF-e" },
  { id: "financial", label: "Financeiro" },
  { id: "delivery", label: "Entrega / Produção / Frete" },
  { id: "marginPricing", label: "Margem, Preço e Custo" },
  { id: "commissions", label: "Comissões" },
  { id: "divergences", label: "Divergências" },
  { id: "technicalAudit", label: "Auditoria Técnica" },
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
