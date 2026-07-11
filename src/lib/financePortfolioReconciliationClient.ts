/**
 * Tipos e query builder do cliente da Conciliação de Carteira (read-only).
 * Não recalcula fatos — só monta query string para a API materializada.
 */

export type PortfolioReconciliationUiFilters = {
  runId: string;
  customerExternalId: string;
  year: string;
  month: string;
  orderCode: string;
  status: string;
  confidenceLevel: string;
  forecastSource: string;
  onlyIssues: boolean;
  page: number;
  pageSize: number;
};

export type PortfolioReconciliationSummaryCards = {
  totalPedidos: number;
  totalValorPedidos: number;
  totalAlocadoPorPrecoPedido: number;
  totalAlocadoPorPrecoDocumento: number;
  totalContasReceber: number;
  totalRecebido: number;
  saldoCarteira: number;
  valorComDivergencia: number;
  valorSemConfianca: number;
  pedidosComAlerta: number;
  alertasEncontrados: number;
  divergenciasEncontradas: number;
  nfsHeaderOnly: number;
};

export type PortfolioReconciliationOrderRow = {
  salesOrderId: string | null;
  pedido: string | null;
  cliente: string | null;
  customerExternalId: number | null;
  valorPedido: number;
  valorAlocado: number;
  valorAlocadoPorDocumento: number;
  valorCR: number;
  recebido: number;
  saldo: number;
  forecastDate: string | null;
  forecastSource: string;
  forecastDates: string[];
  forecastLabel: string;
  forecastDueCount: number;
  confidenceLevel: string;
  status: string;
  alertas: string[];
  hasIssues: boolean;
  nfsHeaderOnly: boolean;
};

export type PortfolioReconciliationRunDto = {
  id: string;
  status: string;
  mode: string;
  startedAt: string | null;
  finishedAt: string | null;
  fromDate: string | null;
  toDate: string | null;
  customerExternalId: number | null;
  filters: unknown;
  summary: unknown;
  errorMessage: string | null;
  createdAt: string;
};

export type PortfolioReconciliationAvailableFilters = {
  statuses: string[];
  confidenceLevels: string[];
  forecastSources: string[];
  customers: Array<{ customerExternalId: number; customerName: string | null }>;
  years: number[];
  months: number[];
};

export type PortfolioReconciliationListPayload = {
  ok: boolean;
  message: string | null;
  run: PortfolioReconciliationRunDto | null;
  summary: PortfolioReconciliationSummaryCards | null;
  businessAnswers: PortfolioBusinessAnswers | null;
  comparison: PortfolioReconciliationComparison | null;
  rows: PortfolioReconciliationOrderRow[];
  pagination: {
    page: number;
    pageSize: number;
    totalRows: number;
    totalPages: number;
  };
  filters: PortfolioReconciliationUiFilters | Record<string, unknown> | null;
  availableFilters: PortfolioReconciliationAvailableFilters;
};

export type PortfolioBusinessAnswerFilterHint = {
  forecastSource?: "RECEIVABLE" | "NFE" | "ORDER" | "UNRESOLVED" | null;
  onlyIssues?: boolean;
  receiptBucket?:
    | "OPEN_OVERDUE_RECEIVABLE"
    | "OUTDATED_FORECAST"
    | "NEXT_7_DAYS"
    | "NEXT_30_DAYS"
    | "AFTER_30_DAYS"
    | "WITHOUT_RELIABLE_DATE"
    | null;
};

export type PortfolioBusinessAnswers = {
  quantoTenhoParaReceber: {
    value: number;
    label: string;
    explanation: string;
    validationHint: string;
    question: string;
    filterHint: PortfolioBusinessAnswerFilterHint;
  };
  quandoVouReceber: {
    nextDate: string | null;
    nextDateLabel: string | null;
    nextDateValue: number;
    overdueValue: number;
    openOverdueReceivablesValue: number;
    outdatedForecastValue: number;
    next7DaysValue: number;
    next30DaysValue: number;
    over30DaysValue: number;
    withoutReliableDateValue: number;
    highlightKind: "OPEN_OVERDUE_RECEIVABLE" | "NEXT_DATE" | "OUTDATED_FORECAST" | "EMPTY";
    highlightValue: number;
    headlineLabel: string;
    highlightSubtitle: string;
    buckets: Array<{
      id: string;
      label: string;
      value: number;
      ordersCount: number;
    }>;
    explanation: string;
    question: string;
    filterHint: PortfolioBusinessAnswerFilterHint;
  };
  jaVirouContasReceber: {
    value: number;
    ordersCount: number;
    label: string;
    explanation: string;
    question: string;
    filterHint: PortfolioBusinessAnswerFilterHint;
  };
  faturadoSemContasReceber: {
    value: number;
    ordersCount: number;
    label: string;
    explanation: string;
    question: string;
    filterHint: PortfolioBusinessAnswerFilterHint;
  };
  soPedidoCarteira: {
    value: number;
    ordersCount: number;
    reviewValue: number;
    reviewOrdersCount: number;
    totalOrderOnlyValue: number;
    totalOrderOnlyOrdersCount: number;
    label: string;
    explanation: string;
    displayPrimaryValue: number;
    displaySubtitle: string;
    question: string;
    filterHint: PortfolioBusinessAnswerFilterHint;
  };
  precisaRevisar: {
    ordersCount: number;
    alertsCount: number;
    valueAtRisk: number;
    valorPedidosComAlerta: number;
    mainReasons: Array<{ reason: string; count: number; label?: string }>;
    explanation: string;
    question: string;
    filterHint: PortfolioBusinessAnswerFilterHint;
  };
};

export type PortfolioComparisonOrderBreakdown = {
  orderCode: string;
  orderValue: number;
  currentReceivableValue: number;
  receivedValue: number;
  openReceivableValue: number;
  nfeHeaderValue: number;
  itemizedAllocatedValue: number;
  projectedOpenBalance: number;
  orderOnlyValue: number;
  invoicedWithoutReceivableValue: number;
  reviewValue: number;
  headerInflationRiskValue: number;
  mainStatus: string;
  mainExplanation: string;
  alerts: string[];
};

export type PortfolioReconciliationComparison = {
  currentView: {
    officialReceivableOpenValue: number;
    officialReceivableTotalValue: number;
    officialReceivedValue: number;
    officialOverdueReceivableValue: number;
    officialNfeHeaderValue: number;
    officialOrderValue: number;
    explanation: string;
  };
  reconciliationView: {
    projectedOpenBalance: number;
    receivableConfirmedValue: number;
    invoicedWithoutReceivableValue: number;
    orderOnlyValue: number;
    orderOnlyReviewValue: number;
    reviewRequiredValue: number;
    reviewRequiredOrders: number;
    alertsCount: number;
    explanation: string;
  };
  differences: {
    receivableVsReconciledDifference: number;
    invisibleToReceivableValue: number;
    headerInflationRiskValue: number;
    orderOnlyReviewValue: number;
    dataQualityRiskValue: number;
    explanation: string;
  };
  orderBreakdown: PortfolioComparisonOrderBreakdown[];
};

export type PortfolioReconciliationOrderDetailPayload = {
  ok: boolean;
  message: string | null;
  detail: {
    salesOrderId: string;
    run: PortfolioReconciliationRunDto | null;
    order: PortfolioReconciliationOrderRow | null;
    header?: {
      order: PortfolioReconciliationOrderRow | null;
      orderIssueDate: string | null;
      expectedDeliveryDate: string | null;
      externalSalesOrderId: number | null;
      primaryAlerts: string[];
    };
    orderItems?: Array<Record<string, unknown>>;
    documentLinks?: Array<Record<string, unknown>>;
    allocations?: Array<Record<string, unknown>>;
    receivableTitles?: Array<Record<string, unknown>>;
    receivablesSummary?: Record<string, unknown> | null;
    managerNotes?: string[];
    technical?: {
      salesOrderId: string | null;
      externalSalesOrderId: number | null;
      orderCode: string | null;
      customerExternalId: number | null;
      nfeExternalIds: number[];
      stockDocumentExternalIds: number[];
      receivableIds: number[];
      links: Array<{ from: string; to: string; via: string }>;
      sanitizedTraces: Array<{
        factId: string;
        status: string | null;
        confidenceLevel: string;
        trace: Record<string, unknown> | null;
      }>;
    };
    items: Array<Record<string, unknown>>;
    linkedNfes: Array<Record<string, unknown>>;
    stockDocuments: Array<Record<string, unknown>>;
    allocatedItems: Array<Record<string, unknown>>;
    receivables: Record<string, unknown> | null;
    timeline: Array<{ at: string; kind: string; label: string }>;
    alertas: string[];
    traces: Array<{
      factId: string;
      status: string | null;
      confidenceLevel: string;
      trace: Record<string, unknown> | null;
    }>;
  } | null;
  run?: PortfolioReconciliationRunDto | null;
};

export type PortfolioReconciliationRunsPayload = {
  ok: boolean;
  runs: PortfolioReconciliationRunDto[];
};

/** Card da Central de Inteligência (vindo da API — UI só formata). */
export type PortfolioIntelligenceCardDto = {
  key: string;
  title: string;
  value: number;
  count: number;
  percentage: number | null;
  colorTone: string;
  isAlertCard: boolean;
  explanation: {
    whatItMeans: string;
    howWeCalculate: string;
    whatIsIncluded: string;
    whatIsExcluded: string;
    howToInterpret: string;
  };
};

export type PortfolioIntelligenceEvidenceFlags = {
  hasNfe: boolean;
  hasStockDocument: boolean;
  hasAllocatedStockDocument: boolean;
  hasReceivable: boolean;
  hasReceived: boolean;
  hasOpenReceivable: boolean;
};

export type PortfolioIntelligenceOrderRow = {
  salesOrderId: string | null;
  orderCode: string;
  externalSalesOrderId: number | null;
  customerName: string | null;
  customerExternalId: number | null;
  sellerName: string | null;
  sellerExternalId: number | null;
  issueDate: string | null;
  expectedDeliveryDate: string | null;
  forecastDate: string | null;
  updatedAt: string | null;
  orderValue: number;
  receivableTotalValue: number;
  receivedValue: number;
  openReceivableValue: number;
  statusPrincipal: string;
  tagsAlerta: string[];
  confidenceScore: number;
  confidenceLabel: string;
  confidenceReasons: string[];
  recommendedAction: string;
  mainReason: string;
  daysSinceIssue: number | null;
  daysSinceExpected: number | null;
  nextRelevantDate: string | null;
  evidenceFlags: PortfolioIntelligenceEvidenceFlags;
  productExternalIds: number[];
};

export type PortfolioIntelligenceGroupDto = {
  statusPrincipal: string;
  title: string;
  ordersCount: number;
  orderValue: number;
  averageConfidence: number;
  orderCodes: string[];
};

export type PortfolioIntelligenceSellerKpiDto = {
  sellerKey: string;
  sellerName: string;
  sellerExternalId: number | null;
  sellerSource: "SALES_ORDER" | "UNAVAILABLE" | string;
  ordersCount: number;
  orderValue: number;
  receivableValue: number;
  conversionCrValuePct: number | null;
  conversionCrQtyPct: number | null;
  documentConvertedValue: number;
  conversionDocValuePct: number | null;
  receivedValue: number;
  receiptRatePct: number | null;
  stuckWithoutNfCrValue: number;
  blockedValue: number;
  lowConfidenceValuePct: number | null;
  averageConfidence: number;
  confidenceAvailable: boolean;
  mainBottleneck: string;
  mainBottleneckKey: string;
  note: string | null;
};

export type PortfolioIntelligenceListPayload = {
  ok: boolean;
  message: string | null;
  cards: PortfolioIntelligenceCardDto[];
  groups: PortfolioIntelligenceGroupDto[];
  sellerKpis: PortfolioIntelligenceSellerKpiDto[];
  rows: PortfolioIntelligenceOrderRow[];
  pagination: {
    page: number;
    pageSize: number;
    totalRows: number;
    totalPages: number;
  };
  filters: Record<string, unknown>;
  metricExplanations: Record<string, unknown>;
  warnings: string[];
  totals: Record<string, number> | null;
  run: { id: string; status: string; finishedAt?: string | Date | null } | null;
};

/** Detalhe do pedido na Central de Inteligência (API read-only). */
export type PortfolioIntelligenceOrderItemDto = {
  salesOrderItemId: string | null;
  externalProductId: number | null;
  productSku: string | null;
  productDescription: string | null;
  orderQuantity: number;
  orderUnitPrice: number;
  orderItemValue: number;
  allocatedQuantity: number;
  remainingQuantity: number;
  status: string;
  alerts: string[];
};

export type PortfolioIntelligenceDocumentDto = {
  nfeNumber: string | null;
  nfeExternalId: number | null;
  nfeProcessedAt: string | null;
  nfeHeaderValue: number | null;
  stockDocumentExternalId: number | null;
  stockDocumentDate: string | null;
  allocatedValueToOrder: number;
  surplusOrUnallocatedValue: number;
  headerOnly: boolean;
  alerts: string[];
  productsAllocated: number[];
  productsSurplus: number[];
};

export type PortfolioIntelligenceReceivableTitleDto = {
  receivableId: number | null;
  label: string;
  amount: number | null;
  dueDate: string | null;
  settlementDate: string | null;
  received: number | null;
  open: number | null;
  status: string;
};

export type PortfolioIntelligenceOrderDetail = {
  executiveSummary: string;
  order: {
    salesOrderId: string | null;
    orderCode: string;
    externalSalesOrderId: number | null;
    orderValue: number;
    issueDate: string | null;
    expectedDeliveryDate: string | null;
    forecastDate: string | null;
    forecastSource: string;
  };
  customer: {
    customerId: string | null;
    customerExternalId: number | null;
    customerName: string | null;
  };
  seller: {
    sellerId: string | null;
    sellerExternalId: number | null;
    sellerName: string | null;
    available: boolean;
    note: string | null;
  };
  dates: {
    issueDate: string | null;
    expectedDeliveryDate: string | null;
    nfeDate: string | null;
    stockDocumentDate: string | null;
    receivableDueDate: string | null;
    receivableSettlementDate: string | null;
    forecastDate: string | null;
    updatedAt: string | null;
    nextRelevantDate: string | null;
  };
  paymentCondition: {
    available: boolean;
    paymentTerms: string | null;
    paymentMethod: string | null;
    note: string | null;
  };
  items: PortfolioIntelligenceOrderItemDto[];
  nfeDocuments: PortfolioIntelligenceDocumentDto[];
  stockDocuments: PortfolioIntelligenceDocumentDto[];
  receivables: {
    summary: {
      receivableIds: number[];
      receivableTotalValue: number;
      receivedValue: number;
      openReceivableValue: number;
    } | null;
    titles: PortfolioIntelligenceReceivableTitleDto[];
    receivableTotalValue: number;
    receivedValue: number;
    openReceivableValue: number;
  };
  classification: {
    statusPrincipal: string;
    tagsAlerta: string[];
    confidenceScore: number;
    confidenceLabel: string;
    confidenceReasons: string[];
    recommendedAction: string;
    mainReason: string;
    evidenceFlags: PortfolioIntelligenceEvidenceFlags;
    financialStatus?: string;
    operationalStatus?: string;
    technicalAlerts?: string[];
  };
  fulfillmentMap?: {
    financialStatus: string;
    operationalStatus: string;
    technicalAlerts: string[];
    fulfillmentSummary: {
      orderValue: number;
      attributedOrderValueByOrderPrice?: number;
      attributedOrderValue: number;
      totalOrderedQuantity?: number;
      totalOrderQuantity: number;
      totalAttendedQuantityCapped?: number;
      attendedQuantity: number;
      totalRemainingQuantity?: number;
      remainingQuantity: number;
      totalExcessQuantity?: number;
      fulfillmentPercent: number | null;
      receivableTotalValue?: number;
      receivableTotal: number;
      receivedValue: number;
      openReceivableValue: number;
      nfeHeaderTotalValue?: number;
      nfeHeaderTotal: number;
      nfeHeaderAttributedToOrderValue?: number;
      nfeHeaderNotAttributedToOrderValue?: number;
      nfeHeaderNotAttributed: number;
      isFullyFulfilledByItems: boolean;
      hasExcessQuantity?: boolean;
      hasHeaderInflationRisk: boolean;
      hasProductsOutsideOrder?: boolean;
    };
    orderItemsCoverage: Array<{
      salesOrderItemId: string | null;
      externalProductId?: number | null;
      productExternalId: number | null;
      productCode: string | null;
      description: string | null;
      orderedQuantity: number;
      attendedQuantityCapped?: number;
      attendedQuantity: number;
      remainingQuantity: number;
      excessQuantityForThisProduct?: number;
      fulfillmentPercentCapped?: number | null;
      fulfillmentPercent: number | null;
      orderUnitValue: number;
      orderItemValue: number;
      attendedValueByOrderPrice: number;
      documentsUsed: Array<{
        nfeNumber: string | null;
        nfeExternalId: number | null;
        stockDocumentExternalId: number | null;
        allocatedQuantity: number;
      }>;
      alerts: string[];
    }>;
    stockDocumentsCoverage: Array<{
      nfeNumber: string | null;
      nfeExternalId: number | null;
      stockDocumentExternalId: number | null;
      date: string | null;
      nfeHeaderValue: number | null;
      documentTotalValue?: number | null;
      valueAttributedToOrder: number;
      valueNotAttributedToOrder: number;
      matchedItems: Array<{
        productExternalId: number | null;
        allocatedQuantity: number;
        allocatedValueByOrderPrice: number;
      }>;
      unmatchedItems: Array<{
        productExternalId: number | null;
        stockQuantity: number | null;
        stockItemValue?: number | null;
        reason: string;
      }>;
      itemsOutsideOrder?: Array<{
        productExternalId: number | null;
        stockQuantity: number | null;
        stockItemValue?: number | null;
        reason: string;
      }>;
      surplusItems: Array<{
        productExternalId: number | null;
        stockQuantity: number | null;
        stockItemValue: number | null;
      }>;
      alerts: string[];
    }>;
    receivablesCoverage: Array<{
      receivableId: number | null;
      receivableIds?: number[];
      dueDate: string | null;
      dueDates?: string[];
      settlementDate: string | null;
      settlementDates?: string[];
      totalValue: number | null;
      receivedValue: number | null;
      openValue: number | null;
      sourceNfe: number | null;
      attributionStatus: string;
    }>;
    executiveConclusion: string;
    evidenceWarnings?: string[];
  } | null;
  /** Avisos amigáveis (ex.: mapa de atendimento indisponível). */
  warnings?: string[];
  timeline: Array<{ at: string; kind: string; label: string }>;
  values: {
    orderValue: number;
    nfeHeaderValue: number;
    stockDocumentValue: number;
    itemizedAllocatedValue: number;
    receivableTotalValue: number;
    receivedValue: number;
    openReceivableValue: number;
  };
};

export type PortfolioIntelligenceOrderDetailPayload = {
  ok: boolean;
  message: string | null;
  detail: PortfolioIntelligenceOrderDetail | null;
  run?: { id: string; status: string; finishedAt?: string | Date | null } | null;
};

export function buildPortfolioIntelligenceListQuery(args: {
  runId?: string;
  customerExternalId?: string;
  customerId?: string;
  sellerExternalId?: string;
  sellerId?: string;
  sellerName?: string;
  companyId?: string;
  orderCode?: string;
  productExternalId?: string;
  statusPrincipal?: string;
  confidenceLabel?: string;
  tagsAlerta?: string;
  minValue?: string;
  maxValue?: string;
  dateAxis?: string;
  from?: string;
  to?: string;
  asOfDate?: string;
  page?: number;
  pageSize?: number;
  onlyWithoutNfe?: boolean;
  onlyWithoutStockDocument?: boolean;
  onlyWithoutReceivable?: boolean;
  onlyWithoutSeller?: boolean;
  sortBy?: string;
  sortDirection?: string;
}): string {
  const params = new URLSearchParams();
  const setIf = (key: string, value: string | undefined) => {
    const v = value?.trim();
    if (v) params.set(key, v);
  };
  setIf("runId", args.runId);
  setIf("customerExternalId", args.customerExternalId);
  setIf("customerId", args.customerId);
  setIf("sellerExternalId", args.sellerExternalId);
  setIf("sellerId", args.sellerId);
  setIf("sellerName", args.sellerName);
  setIf("companyId", args.companyId);
  setIf("orderCode", args.orderCode);
  setIf("productExternalId", args.productExternalId);
  setIf("statusPrincipal", args.statusPrincipal);
  setIf("confidenceLabel", args.confidenceLabel);
  setIf("tagsAlerta", args.tagsAlerta);
  setIf("minValue", args.minValue);
  setIf("maxValue", args.maxValue);
  setIf("dateAxis", args.dateAxis);
  setIf("from", args.from);
  setIf("to", args.to);
  setIf("asOfDate", args.asOfDate);
  setIf("sortBy", args.sortBy);
  setIf("sortDirection", args.sortDirection);
  if (args.onlyWithoutNfe) params.set("onlyWithoutNfe", "true");
  if (args.onlyWithoutStockDocument) params.set("onlyWithoutStockDocument", "true");
  if (args.onlyWithoutReceivable) params.set("onlyWithoutReceivable", "true");
  if (args.onlyWithoutSeller) params.set("onlyWithoutSeller", "true");
  params.set("page", String(args.page ?? 1));
  params.set("pageSize", String(args.pageSize ?? 50));
  return params.toString();
}

export function createDefaultPortfolioReconciliationUiFilters(): PortfolioReconciliationUiFilters {
  return {
    runId: "",
    customerExternalId: "",
    year: "",
    month: "",
    orderCode: "",
    status: "",
    confidenceLevel: "",
    forecastSource: "",
    onlyIssues: false,
    page: 1,
    pageSize: 50,
  };
}

export function buildPortfolioReconciliationListQuery(
  filters: PortfolioReconciliationUiFilters
): string {
  const params = new URLSearchParams();
  if (filters.runId.trim()) params.set("runId", filters.runId.trim());
  if (filters.customerExternalId.trim()) {
    params.set("customerExternalId", filters.customerExternalId.trim());
  }
  if (filters.year.trim()) params.set("year", filters.year.trim());
  if (filters.month.trim()) params.set("month", filters.month.trim());
  if (filters.orderCode.trim()) params.set("orderCode", filters.orderCode.trim());
  if (filters.status.trim()) params.set("status", filters.status.trim());
  if (filters.confidenceLevel.trim()) {
    params.set("confidenceLevel", filters.confidenceLevel.trim());
  }
  if (filters.forecastSource.trim()) {
    params.set("forecastSource", filters.forecastSource.trim());
  }
  if (filters.onlyIssues) params.set("onlyIssues", "true");
  params.set("page", String(Math.max(1, filters.page)));
  params.set("pageSize", String(Math.max(1, filters.pageSize)));
  return params.toString();
}

export const PORTFOLIO_RECONCILIATION_PARALLEL_NOTICE =
  "Esta visão é uma auditoria paralela de carteira, documentos de saída e contas a receber. Ela não altera o fluxo de caixa oficial.";

export const PORTFOLIO_RECONCILIATION_BUSINESS_ANSWERS_BANNER =
  'Esta tela mostra a carteira sem duplicar valores. Quando um pedido já virou Contas a Receber, usamos o CR. Quando ainda não virou CR, usamos a NF/documento de saída. Quando ainda não foi faturado, usamos o pedido. "Títulos vencidos" são somente CR em aberto com vencimento passado — previsões antigas de pedido/NF aparecem como "Previsões para revisar", não como atraso do cliente.';

export const PORTFOLIO_RECONCILIATION_NO_RUN_UI_MESSAGE =
  "Nenhuma conciliação materializada encontrada. Solicite a execução do rebuild manual no servidor.";
