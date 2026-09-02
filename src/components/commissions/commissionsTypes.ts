/** Tipos de payload das APIs de comissões (frontend — sem imports server-only). */

export type CommissionSellerDisplayDto = {
  id: string | null;
  name: string | null;
  nomusPersonId: number | null;
  resolutionStatus:
    | "RESOLVED"
    | "BROKEN_COMMISSION_PERSON_REFERENCE"
    | "SELLER_UNRESOLVED"
    | "NO_SELLER";
  source: "COMMISSION_PERSON" | "UNRESOLVED";
  label: string;
};

export type CommissionsPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type CommissionsDashboardPayload = {
  cards: {
    forecastAmount: number;
    confirmedAmount: number;
    waitingNfeAmount: number;
    waitingReceivableAmount: number;
    releasedAmount: number;
    paidAmount: number;
    balanceToPayAmount: number;
    criticalDivergencesCount: number;
  };
  monthlySeries: Array<{
    year: number;
    month: number;
    forecastAmount: number;
    confirmedAmount: number;
    releasedAmount: number;
    paidAmount: number;
  }>;
  byPerson: Array<{
    commissionPersonId: string;
    personName: string;
    commissionAmount: number;
    releasedAmount: number;
    paidAmount: number;
  }>;
  byStatus: Array<{ status: string; count: number; commissionAmount: number }>;
  topCustomers: Array<{
    customerExternalId: number | null;
    customerName: string | null;
    commissionAmount: number;
  }>;
  auditSummary: { total: number; critical: number; warning: number; unresolved: number };
  ytd: CommissionDashboardYtdPayload | null;
};

export type CommissionDashboardYtdPayload = {
  year: number;
  generatedYtd: number;
  releasedYtd: number;
  payableInMonth: number;
  futureCommission: number;
  overdueCommission: number;
  averageRatePercent: number;
  commissionableBaseYtd: number;
  noCommissionSales: { amount: number; customerCount: number; documentCount: number };
  tierDistribution: Array<{
    tierCode: string;
    tierName: string;
    baseAmount: number;
    commissionAmount: number;
    count: number;
  }>;
  monthlyYtd: Array<{ month: number; generated: number; released: number; pending: number }>;
  sellerRanking: Array<{
    commissionPersonId: string;
    personName: string;
    generated: number;
    released: number;
    future: number;
    overdue: number;
  }>;
};

export type CommissionsArViewRow = {
  scheduleId: string;
  commissionPersonName: string;
  customerName: string | null;
  orderCode: string | null;
  nfeNumber: string | null;
  installmentNumber: number | null;
  dueDate: string | null;
  /** Data real do recebimento — competência da comissão. */
  receiptDate?: string | null;
  /** Baixa administrativa no Contas a Receber. */
  settlementDate: string | null;
  parcelAmount: number;
  commissionParcelAmount: number;
  commissionReleasedAmount: number;
  paymentStatus: string;
  daysUntilDue: number | null;
  daysOverdue: number | null;
  commissionBlocked: number;
};

export type CommissionsArViewPayload = {
  cards: {
    totalCommission: number;
    totalReleased: number;
    totalBlocked: number;
    rowCount: number;
  };
  rows: CommissionsArViewRow[];
  pagination: CommissionsPagination;
};

export type CommissionsExceptionItem = {
  id: string;
  customerExternalId: number | null;
  customerName: string | null;
  commissionPersonId: string | null;
  commissionPersonName: string | null;
  productCode: string | null;
  productExternalId: number | null;
  reason: string;
  startDate: string;
  endDate: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CustomerExclusionRuleItem = {
  id: string;
  customerId: string | null;
  customerExternalId: number | null;
  customerNameSnapshot: string;
  customerTaxId: string | null;
  normalizedCustomerName: string;
  reason: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: "ACTIVE" | "INACTIVE";
  createdByUserId: string | null;
  inactivatedAt: string | null;
  inactivatedByUserId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CustomerExclusionRulesPayload = {
  rows: CustomerExclusionRuleItem[];
  pagination: CommissionsPagination;
};

export type CustomerExclusionClosingReconciliationPayload = {
  year: number;
  month: number;
  scopeNote: string;
  materializationSummary: {
    excludedCustomerCount: number;
    groupCompanyExcludedCount: number;
    groupCompanyExcludedReceivedAmount: number;
    totalReceivedAmount: number;
  };
  manualExcludedCustomers: Array<{
    customerKey: string;
    customerName: string | null;
    customerExternalId: number | null;
    customerId: string | null;
    exclusionRuleId: string | null;
    exclusionReason: string | null;
    exclusionLabel: string;
    receivableCount: number;
    receivedAmount: number;
    matchedRuleIds: string[];
  }>;
  groupCompanyExcluded: Array<{
    cnpj: string;
    displayCnpj: string;
    companyName: string;
    receivableCount: number;
    receivedAmount: number;
    exclusionLabel: string;
  }>;
  registeredRulesImpact: Array<{
    ruleId: string;
    customerNameSnapshot: string;
    customerExternalId: number | null;
    customerTaxId: string | null;
    reason: string;
    status: string;
    receivableCount: number;
    receivedAmount: number;
    usedInClosing: boolean;
    impactLabel: string | null;
  }>;
  fixedGroupCompanies: Array<{
    cnpj: string;
    displayCnpj: string;
    name: string;
    exclusionLabel: string;
    requiresManualRegistration: false;
  }>;
};

export type CommissionsRecordItem = {
  id: string;
  status: string;
  originStage: string;
  kind: string;
  orderCode: string | null;
  nfeNumber: string | null;
  productCode: string | null;
  productName: string | null;
  commissionPersonId: string;
  commissionPersonName: string;
  seller: CommissionSellerDisplayDto;
  customerName: string | null;
  baseAmount: number;
  ratePercent: number;
  commissionAmount: number;
  releasedAmount: number;
  paidAmount: number;
  balanceAmount: number;
  calculatedAt: string;
  confirmedAt: string | null;
};

export type CommissionsForecastCards = {
  totalForecastAmount: number;
  ordersWaitingNfe: number;
  ordersWithoutRule: number;
  ordersWithoutSellerOrRep: number;
  forecastBaseToInvoice: number;
  orderCount: number;
};

export type CommissionsForecastRow = {
  orderKey: string;
  orderCode: string | null;
  nomusOrderId: number | null;
  localOrderId: string | null;
  orderDate: string | null;
  customerName: string | null;
  seller: CommissionSellerDisplayDto;
  sellerLabel: string | null;
  representativeLabel: string | null;
  orderAmount: number;
  baseAmount: number;
  ratePercent: number;
  forecastCommissionAmount: number;
  paymentTermsHint: string | null;
  nextDueDate: string | null;
  status: string;
  hasRule: boolean;
  hasOutOfTablePrice: boolean;
  recordIds: string[];
};

export type CommissionsForecastPayload = {
  cards: CommissionsForecastCards;
  rows: CommissionsForecastRow[];
  pagination: CommissionsPagination;
};

export type CommissionsForecastDetailPayload = {
  orderKey: string;
  orderCode: string | null;
  nomusOrderId: number | null;
  localOrderId: string | null;
  orderDate: string | null;
  customerName: string | null;
  seller: CommissionSellerDisplayDto;
  sellerLabel: string | null;
  representativeLabel: string | null;
  paymentTerms: string | null;
  orderNetValue: number | null;
  status: string;
  forecastReason: string;
  totalBaseAmount: number;
  totalForecastCommission: number;
  items: Array<{
    recordId: string;
    productCode: string | null;
    productName: string | null;
    commissionPersonId: string;
    commissionPersonName: string;
    baseAmount: number;
    ratePercent: number;
    commissionAmount: number;
    ruleId: string | null;
    ruleName: string | null;
    outOfTablePrice: boolean;
  }>;
  installments: Array<{
    installmentNumber: number | null;
    dueDate: string | null;
    expectedAmount: number | null;
    commissionExpectedAmount: number;
  }>;
  auditIssues: Array<{
    id: string;
    severity: string;
    type: string;
    message: string;
    resolved: boolean;
    createdAt: string;
  }>;
};

export type CommissionsConfirmedCards = {
  totalConfirmedCommission: number;
  invoicedAmount: number;
  receivedAmount: number;
  waitingReceivableCommission: number;
  partiallyReleasedCommission: number;
  fullyReleasedCommission: number;
  balanceToRelease: number;
  inconsistentDocumentsCount: number;
};

export type CommissionsConfirmedRow = {
  confirmKey: string;
  orderCode: string | null;
  nomusOrderId: number | null;
  localOrderId: string | null;
  nfeNumber: string | null;
  nomusNfeId: number | null;
  outputDocumentLabel: string | null;
  customerName: string | null;
  commissionPersonId: string;
  commissionPersonName: string;
  confirmedBaseAmount: number;
  ratePercent: number;
  confirmedCommissionAmount: number;
  receivedAmount: number;
  releasedCommissionAmount: number;
  pendingBalance: number;
  status: string;
  highlight: "confirmed" | "waiting_receivable" | "divergence" | "cancelled";
  hasDivergence: boolean;
  hasOutOfTablePrice: boolean;
  recordIds: string[];
  confirmedAt: string | null;
};

export type CommissionsConfirmedPayload = {
  cards: CommissionsConfirmedCards;
  rows: CommissionsConfirmedRow[];
  pagination: CommissionsPagination;
};

export type CommissionsConfirmedDetailPayload = {
  confirmKey: string;
  orderCode: string | null;
  nomusOrderId: number | null;
  localOrderId: string | null;
  nfeNumber: string | null;
  nomusNfeId: number | null;
  outputDocumentLabel: string | null;
  customerName: string | null;
  commissionPersonId: string;
  commissionPersonName: string;
  status: string;
  confirmedAt: string | null;
  totalBaseAmount: number;
  totalConfirmedCommission: number;
  totalReceivedAmount: number;
  totalReleasedAmount: number;
  pendingBalance: number;
  orderItems: Array<{
    recordId: string;
    productCode: string | null;
    productName: string | null;
    baseAmount: number;
    ratePercent: number;
    commissionAmount: number;
    ruleId: string | null;
    ruleName: string | null;
    outOfTablePrice: boolean;
  }>;
  outputDocumentItems: Array<{
    movementId: string;
    documentNumber: string | null;
    productLabel: string | null;
    quantity: number;
    movementDate: string;
  }>;
  receivables: Array<{
    nomusReceivableId: number | null;
    installmentNumber: number | null;
    dueDate: string | null;
    amountReceivable: number;
    amountReceived: number;
    balanceReceivable: number;
    commissionExpectedAmount: number;
    commissionReleasedAmount: number;
  }>;
  supersessionHistory: Array<{
    recordId: string;
    productCode: string | null;
    productName: string | null;
    commissionAmount: number;
    supersededAt: string;
  }>;
  auditIssues: Array<{
    id: string;
    severity: string;
    type: string;
    message: string;
    resolved: boolean;
    createdAt: string;
  }>;
};

export type CommissionsRecordsPayload = {
  items: CommissionsRecordItem[];
  pagination: CommissionsPagination;
  totals: {
    commissionAmount: number;
    releasedAmount: number;
    paidAmount: number;
    balanceAmount: number;
    count: number;
  };
  kind: string;
};

export type CommissionsReleaseItem = {
  scheduleId: string;
  commissionRecordId: string;
  commissionPersonId: string;
  commissionPersonName: string;
  orderCode: string | null;
  nfeNumber: string | null;
  nomusReceivableId: number | null;
  customerName: string | null;
  dueDate: string | null;
  /** Data real do recebimento — competência da comissão. */
  receiptDate?: string | null;
  /** Baixa administrativa no Contas a Receber. */
  settlementDate: string | null;
  installmentNumber: number | null;
  parcelAmount: number;
  receivedAmount: number;
  receivableBalance: number;
  receivedPercent: number | null;
  commissionParcelAmount: number;
  commissionReleasedAmount: number;
  balanceToRelease: number;
  allocationPercent: number | null;
  status: string;
  highlight: "overdue" | "received" | "partial_release" | "open" | "released";
  recordCommissionTotal: number;
};

export type CommissionsReleasesCards = {
  commissionToRelease: number;
  commissionAlreadyReleased: number;
  commissionBlockedByNoReceipt: number;
  accountsReceivedCount: number;
  accountsOpenCount: number;
  accountsOverdueCount: number;
  upcomingReleasesCount: number;
};

export type CommissionsReleasesPayload = {
  cards: CommissionsReleasesCards;
  rows: CommissionsReleaseItem[];
  /** Alias legado — mesma lista de `rows` na página atual. */
  items: CommissionsReleaseItem[];
  pagination: CommissionsPagination;
};

export type CommissionsReleaseDetailPayload = {
  scheduleId: string;
  commissionRecordId: string;
  commissionPersonId: string;
  commissionPersonName: string;
  orderCode: string | null;
  nfeNumber: string | null;
  nomusReceivableId: number | null;
  customerName: string | null;
  dueDate: string | null;
  /** Data real do recebimento — competência da comissão. */
  receiptDate?: string | null;
  /** Baixa administrativa no Contas a Receber. */
  settlementDate: string | null;
  installmentNumber: number | null;
  releaseRule: string;
  recordCommissionTotal: number;
  allocationPercent: number | null;
  commissionParcelAmount: number;
  commissionReleasedAmount: number;
  balanceToRelease: number;
  parcelAmount: number;
  receivedAmount: number;
  receivableBalance: number;
  receivedPercent: number | null;
  releaseExplanation: string;
  releaseHistory: Array<{
    scheduleId: string;
    installmentNumber: number | null;
    dueDate: string | null;
    commissionExpectedAmount: number;
    commissionReleasedAmount: number;
    receivedAmount: number;
    status: string;
  }>;
  auditIssues: Array<{
    id: string;
    severity: string;
    type: string;
    message: string;
    resolved: boolean;
    createdAt: string;
  }>;
};

export type CommissionsPersonItem = {
  id: string;
  nomusPersonId: number | null;
  name: string;
  type: string;
  source: string;
  email: string | null;
  document: string | null;
  active: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  linkedRulesCount?: number;
  hasCommissionInPeriod?: boolean;
};

export type CommissionsPersonsCards = {
  totalCount: number;
  activeSellersCount: number;
  activeRepresentativesCount: number;
  withoutActiveRuleCount: number;
  withCommissionInPeriodCount: number;
};

export type CommissionsPersonsPayload = {
  cards?: CommissionsPersonsCards;
  rows?: CommissionsPersonItem[];
  items: CommissionsPersonItem[];
  pagination: CommissionsPagination;
};

export type CommissionsPersonsImportResult = {
  ordersScanned: number;
  created: number;
  updated: number;
  skippedNoName: number;
  skippedNoNomusId: number;
  unchanged: number;
};

export type CommissionsPersonFormInput = {
  name: string;
  type: string;
  source: string;
  nomusPersonId: number | null;
  email: string | null;
  document: string | null;
  active: boolean;
  notes: string | null;
};

export type CommissionsRuleConditionItem = {
  id?: string;
  companyExternalId?: number | null;
  customerExternalId?: number | null;
  customerUf?: string | null;
  nomusSellerId?: number | null;
  nomusRepresentativeId?: number | null;
  productExternalId?: number | null;
  productGroupExternalId?: number | null;
  priceTableExternalId?: number | null;
  paymentConditionExternalId?: number | null;
  movementTypeExternalId?: number | null;
  minOrderAmount?: number | null;
  maxOrderAmount?: number | null;
  minDiscountPercent?: number | null;
  maxDiscountPercent?: number | null;
};

export type CommissionsRuleItem = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  priority: number;
  beneficiaryType: string;
  calculationType: string;
  fixedCommissionPersonId: string | null;
  fixedCommissionPersonName?: string | null;
  ratePercent: number;
  baseType: string;
  releaseRule: string;
  validFrom: string | null;
  validTo: string | null;
  conditions: CommissionsRuleConditionItem[];
  conditionsCount?: number;
  usageCount?: number;
  createdAt: string;
  updatedAt: string;
};

export type CommissionsRulesCards = {
  totalCount: number;
  activeCount: number;
  inactiveCount: number;
  withUsageCount: number;
  withConditionsCount: number;
};

export type CommissionsRulesPayload = {
  cards?: CommissionsRulesCards;
  rows?: CommissionsRuleItem[];
  items: CommissionsRuleItem[];
  pagination: CommissionsPagination;
};

export type CommissionsRuleFormInput = {
  name: string;
  description: string | null;
  active: boolean;
  priority: number;
  beneficiaryType: string;
  calculationType: string;
  fixedCommissionPersonId: string | null;
  ratePercent: number;
  baseType: string;
  releaseRule: string;
  validFrom: string | null;
  validTo: string | null;
  conditions: CommissionsRuleConditionItem[];
};

export type CommissionsRuleUsagePayload = {
  rule: CommissionsRuleItem;
  usageCount: number;
  recentUsageCount: number;
};

export type CommissionsAuditItem = {
  id: string;
  severity: string;
  type: string;
  entityType: string;
  entityId: string | null;
  message: string;
  metadataJson: unknown;
  resolved: boolean;
  resolvedAt: string | null;
  createdAt: string;
  orderCode: string | null;
  nfeNumber: string | null;
  customerName: string | null;
  commissionPersonId: string | null;
  commissionPersonName: string | null;
  involvedAmount: number | null;
  suggestedAction: string;
};

export type CommissionsAuditCards = {
  criticalOpenCount: number;
  warningOpenCount: number;
  infoOpenCount: number;
  resolvedInPeriodCount: number;
  ordersWithoutRuleCount: number;
  nfesWithoutOutputDocumentCount: number;
  nfesWithoutReceivableCount: number;
};

export type CommissionsAuditPayload = {
  cards: CommissionsAuditCards;
  rows: CommissionsAuditItem[];
  items: CommissionsAuditItem[];
  pagination: CommissionsPagination;
};

export type CommissionsAuditRerunResult = {
  runId: string;
  summary: {
    ordersEvaluated: number;
    nfeEvaluated: number;
    outputDocumentsEvaluated: number;
    receivablesEvaluated: number;
    commissionsCreated: number;
    commissionsUpdated: number;
    commissionsSuperseded: number;
    errorsCount: number;
    issuesCreated: number;
    errors: string[];
  };
};

export type CommissionsSettingsPayload = {
  releaseDefaultRule: string;
  forecastEnabled: boolean;
  outputDocumentSupersedesForecast: boolean;
  receivableAsDefinitiveReleaseSource: boolean;
  paidCommissionBlockAutoChange: boolean;
  manualPaymentEnabled: boolean;
  partialPaymentEnabled: boolean;
  requireApprovalBeforePaid: boolean;
  auditOrderWithoutSeller: boolean;
  auditOrderWithoutRepresentative: boolean;
  auditNfeWithoutOutputDocument: boolean;
  auditNfeWithoutReceivable: boolean;
  auditPaidWithoutRelease: boolean;
  calculateForSellers: boolean;
  calculateForRepresentatives: boolean;
  allowFixedPersonInRule: boolean;
  warnings?: string[];
};

export type CommissionsPaymentBatchListItem = {
  id: string;
  periodStart: string;
  periodEnd: string;
  commissionPersonId: string;
  commissionPersonName: string;
  commissionPersonType?: string;
  status: string;
  totalReleased: number;
  totalSelected: number;
  totalPaid: number;
  paymentDate: string | null;
  itemsCount: number;
  createdAt: string;
};

export type CommissionsPaymentBatchDetailItem = {
  id: string;
  commissionRecordId: string;
  orderCode: string | null;
  productCode: string | null;
  nfeNumber: string | null;
  customerName: string | null;
  nomusReceivableId: number | null;
  commissionAmount: number;
  releasedAmount: number;
  paidAmount: number;
  amountToPay: number;
  amountPaid: number;
  status: string;
  notes: string | null;
};

export type CommissionsPaymentBatchDetail = {
  id: string;
  periodStart: string;
  periodEnd: string;
  commissionPersonId: string;
  commissionPersonName: string;
  commissionPersonType?: string;
  status: string;
  totalReleased: number;
  totalSelected: number;
  totalPaid: number;
  paymentDate: string | null;
  notes: string | null;
  items: CommissionsPaymentBatchDetailItem[];
  createdAt: string;
};

export type CommissionsPaymentsCards = {
  unpaidReleasedAmount: number;
  draftBatchTotal: number;
  approvedBatchTotal: number;
  paidInPeriodTotal: number;
  balanceToPay: number;
};

export type CommissionsPaymentsPayload = {
  cards?: CommissionsPaymentsCards;
  rows?: CommissionsPaymentBatchListItem[];
  items: CommissionsPaymentBatchListItem[];
  pagination: CommissionsPagination;
};

export type UnpaidReleasedCommissionRow = {
  commissionRecordId: string;
  commissionPersonId: string;
  orderCode: string | null;
  productCode: string | null;
  nfeNumber: string | null;
  customerName: string | null;
  status: string;
  commissionAmount: number;
  releasedAmount: number;
  paidAmount: number;
  balanceAmount: number;
  availableToPay: number;
  nomusReceivableId: number | null;
};

export type UnpaidReleasedCommissionsPayload = {
  items: UnpaidReleasedCommissionRow[];
};

export type CommissionsVisualAuditRow = {
  lineId: string;
  recordId: string;
  scheduleId: string | null;
  commissionPersonId: string;
  commissionPersonName: string;
  customerName: string | null;
  orderCode: string | null;
  nfeNumber: string | null;
  confirmedAt: string | null;
  documentBaseAmount: number;
  documentCommissionTotal: number;
  nomusReceivableId: number | null;
  installmentNumber: number | null;
  dueDate: string | null;
  /** Data real do recebimento — competência da comissão. */
  receiptDate?: string | null;
  /** Baixa administrativa no Contas a Receber. */
  settlementDate: string | null;
  receivableAmount: number;
  receivedAmount: number;
  openBalance: number;
  financialSharePercent: number | null;
  commissionExpected: number;
  commissionReleased: number;
  commissionPending: number;
  allocatedBaseAmount?: number;
  receivableTitleStatus: string;
  commissionStatus: string;
  alertLabels: string[];
  auditCategory?: string;
  auditCategoryLabel?: string;
  lineStatus?: string;
  statusReason?: string | null;
};

export type CommissionsVisualAuditPayload = {
  cards: {
    appraisalMode: string;
    documentAmountTotal: number;
    receivableAmountTotal: number;
    receivedAmountTotal: number;
    commissionableBaseTotal: number;
    commissionCalculatedTotal: number;
    commissionExpectedTotal: number;
    commissionReleasedTotal: number;
    commissionPendingTotal: number;
    commissionFutureTotal: number;
    commissionBlockedTotal: number;
    documentCount: number;
    receivableCount: number;
    scheduleCount: number;
    divergenceCount: number;
    averageRatePercent: number;
  };
  rows: CommissionsVisualAuditRow[];
  pagination: CommissionsPagination;
  nomusReference: {
    base: number | null;
    commission: number | null;
    baseDiff: number | null;
    commissionDiff: number | null;
    baseDiffPercent: number | null;
    commissionDiffPercent: number | null;
    nomusAverageRatePercent: number | null;
    indusAverageRatePercent: number | null;
    comparable: boolean;
  };
  scopeNote?: string;
  reconciliationNote?: string;
  materializationSummary?: {
    totalReceivablesCount: number;
    receivablesWithScheduleCount: number;
    receivablesWithoutScheduleCount: number;
    excludedCustomerCount: number;
    groupCompanyExcludedCount: number;
    groupCompanyExcludedReceivedAmount: number;
    sellerUnresolvedCount: number;
    staleScheduleCount: number;
    totalReceivedAmount: number;
    totalExpectedCommission: number;
    totalReleasedCommission: number;
    pendingMaterialization: boolean;
    pendingMaterializationMessage: string | null;
    rebuildScriptHint: string | null;
  };
  officialCards?: {
    totalReceivedAmount: number;
    receivedWithScheduleAmount: number;
    receivedExcludedCustomerAmount: number;
    receivedGroupCompanyExcludedAmount: number;
    receivedWithoutScheduleAmount: number;
    commissionableBaseAmount: number;
    grossCommissionAmount: number;
    excludedCommissionAmount: number;
    finalCommissionAmount: number;
    nomusCommissionDiff: number | null;
    nomusDiffExplanation: string | null;
    reportStatus: string;
  };
  reconciliation?: {
    divergentReceivableCount: number;
    excludedCustomerCount: number;
    groupCompanyExcludedCount: number;
    groupCompanyExcludedReceivedAmount: number;
    receivablesWithoutScheduleCount: number;
    staleScheduleCount: number;
    sellerUnresolvedCount?: number;
    duplicateReceivedCount: number;
    diffExplanation: string | null;
  };
  criticalDivergence?: boolean;
  criticalDivergenceReason?: string | null;
  categoryRowCounts?: Partial<Record<string, number>>;
  criticalDivergenceReceivableCount?: number;
};

export type CommissionsMonthlyClosingDetailRow = {
  lineId: string;
  sellerId: string;
  sellerName: string;
  month: string;
  nomusReceivableId: number | null;
  installmentNumber: number | null;
  orderCode: string | null;
  nfeNumber: string | null;
  customerName: string | null;
  productCode: string | null;
  confirmedAt: string | null;
  dueDate: string | null;
  settlementDate: string | null;
  receivedAmount: number;
  allocatedBaseAmount: number;
  expectedCommissionAmount: number;
  releasedCommissionAmount: number;
  pendingCommissionAmount: number;
  itemRatePercent: number;
  alerts: string[];
};

export type CommissionsMonthlyClosingGroupRow = {
  groupKey: string;
  groupLabel: string;
  lineCount: number;
  receivedTitlesCount: number;
  receivedAmount: number;
  allocatedBaseAmount: number;
  releasedCommissionAmount: number;
  averageCommissionRate: number;
};

export type CommissionsMonthlyClosingPayload = {
  year: number;
  month: number;
  monthKey: string;
  monthLabelPt: string;
  payableCommissionTotal: number;
  receivedAmountTotal: number;
  allocatedBaseAmountTotal: number;
  expectedCommissionAmountTotal: number;
  pendingCommissionAmountTotal: number;
  uniqueReceivablesCount: number;
  uniqueSellersCount: number;
  averageCommissionRate: number;
  receivedVsBaseDiff: number;
  warnings: string[];
  sellers: Array<{
    sellerId: string;
    sellerName: string;
    receivedTitlesCount: number;
    receivedAmount: number;
    allocatedBaseAmount: number;
    releasedCommissionAmount: number;
    averageCommissionRate: number;
  }>;
  cards: {
    payableCommissionTotal: number;
    allocatedBaseAmountTotal: number;
    receivedAmountTotal: number;
    uniqueReceivablesCount: number;
    averageCommissionRate: number;
    divergenceCount: number;
  };
  nomusReference: CommissionsVisualAuditPayload["nomusReference"];
  groupings: {
    bySeller: CommissionsMonthlyClosingGroupRow[];
    byCustomer: CommissionsMonthlyClosingGroupRow[];
    byNfe: CommissionsMonthlyClosingGroupRow[];
    byReceivable: CommissionsMonthlyClosingGroupRow[];
    byProduct: CommissionsMonthlyClosingGroupRow[];
  };
  detailRows: CommissionsMonthlyClosingDetailRow[];
  pagination: CommissionsPagination;
  workflow: CommissionsMonthlyClosingWorkflowMeta;
};

export type CommissionsMonthlyClosingSellerWorkflow = {
  status: string;
  statusLabel: string;
  isCriticalDivergence: boolean;
  canApprove: boolean;
  approvalBlockedReason: string | null;
  paymentBatchId: string | null;
  paymentBatchStatus: string | null;
};

export type CommissionsMonthlyClosingWorkflowMeta = {
  persistApproval: false;
  overallStatus: string;
  overallStatusLabel: string;
  canApprove: boolean;
  approvalBlockedReason: string | null;
  sellerRows: Array<{
    sellerId: string;
    sellerName: string;
    receivedTitlesCount: number;
    receivedAmount: number;
    allocatedBaseAmount: number;
    releasedCommissionAmount: number;
    averageCommissionRate: number;
    workflow: CommissionsMonthlyClosingSellerWorkflow;
  }>;
};

export type CommissionsReceivableForecastMonthlyRow = {
  dueMonthKey: string;
  dueMonthLabelPt: string;
  openTitlesAmount: number;
  allocatedBaseAmount: number;
  forecastCommissionAmount: number;
  titleCount: number;
  sellerCount: number;
  bucket: string;
};

export type CommissionsReceivableForecastDetailRow = {
  lineId: string;
  sellerName: string;
  customerName: string | null;
  orderCode: string | null;
  nfeNumber: string | null;
  nomusReceivableId: number | null;
  dueDate: string | null;
  openAmount: number;
  allocatedBaseAmount: number;
  forecastCommissionAmount: number;
  receivableTitleStatus: string;
  bucket: string;
  alerts: string[];
};

export type CommissionsReceivableForecastPayload = {
  cards: {
    futureCommissionTotal: number;
    overdueCommissionTotal: number;
    futureTitlesAmountTotal: number;
    overdueTitlesAmountTotal: number;
    peakMonthKey: string | null;
    peakMonthLabelPt: string | null;
    peakMonthCommission: number;
    nextMonthKey: string | null;
    nextMonthLabelPt: string | null;
    nextMonthCommission: number;
    titleCount: number;
    sellerCount: number;
  };
  monthly: CommissionsReceivableForecastMonthlyRow[];
  overdue: CommissionsReceivableForecastMonthlyRow[];
  currentMonth: CommissionsReceivableForecastMonthlyRow | null;
  futureMonths: CommissionsReceivableForecastMonthlyRow[];
  detailRows: CommissionsReceivableForecastDetailRow[];
  pagination: CommissionsPagination;
  scopeNote?: string;
  reconciliationNote?: string;
  materializationSummary?: CommissionsReceiptClosingMaterializationSummary;
  officialCards?: CommissionsReceiptClosingMaterializationCards;
};

export type CommissionsReceiptClosingSnapshot = {
  closingId: string;
  year: number;
  month: number;
  status: string;
  source: string;
  calculationHash: string | null;
  totalReceivedAmount: number;
  totalCommissionableBase: number;
  totalExpectedCommission: number;
  totalReleasedCommission: number;
  totalExcludedAmount: number;
  totalExceptionAmount: number;
  lineCount: number;
  closedAt: string | null;
  closedBy: string | null;
  notes: string | null;
};

export type CommissionsReceiptClosingMaterializationCards = {
  totalReceivedAmount: number;
  receivedWithScheduleAmount: number;
  receivedExcludedCustomerAmount: number;
  receivedGroupCompanyExcludedAmount: number;
  receivedWithoutScheduleAmount: number;
  commissionableBaseAmount: number;
  grossCommissionAmount: number;
  excludedCommissionAmount: number;
  finalCommissionAmount: number;
  nomusCommissionDiff: number | null;
  nomusDiffExplanation: string | null;
  reportStatus: "PREVIEW" | "CLOSED";
};

export type CommissionsReceiptClosingMaterializationSummary = {
  totalReceivablesCount: number;
  receivablesWithScheduleCount: number;
  receivablesWithoutScheduleCount: number;
  excludedCustomerCount: number;
  groupCompanyExcludedCount: number;
  groupCompanyExcludedReceivedAmount: number;
  sellerUnresolvedCount: number;
  staleScheduleCount: number;
  totalReceivedAmount: number;
  totalExpectedCommission: number;
  totalReleasedCommission: number;
  pendingMaterialization: boolean;
  pendingMaterializationMessage: string | null;
  rebuildScriptHint: string | null;
};

export type CommissionsReceiptClosingReconciliation = {
  nomusBase: number | null;
  nomusCommission: number | null;
  diffCommissionFinal: number | null;
  diffCommissionBeforeExclusions: number | null;
  diffExplanation: string | null;
  excludedCustomerCount: number;
  groupCompanyExcludedCount: number;
  groupCompanyExcludedReceivedAmount: number;
  receivablesWithoutScheduleCount: number;
  staleScheduleCount: number;
  divergentReceivableCount: number;
  duplicateReceivedCount: number;
  comparable: boolean;
};

export type CommissionsReceiptClosingLine = {
  lineKey: string;
  nomusReceivableId: number | null;
  receivableNumber: string | null;
  installmentNumber: number | null;
  settlementDate: string | null;
  dueDate: string | null;
  customerId: string | null;
  customerExternalId: number | null;
  customerName: string | null;
  orderCode: string | null;
  localOrderId: string | null;
  nomusNfeId: number | null;
  nfeNumber: string | null;
  localItemId: string | null;
  nomusOrderItemId: number | null;
  productCode: string | null;
  productName: string | null;
  rawSellerId: number | null;
  rawSellerName: string | null;
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  sellerResolutionStatus: string | null;
  receivedAmount: number;
  uniqueReceivedAmount: number;
  /** Valor original do título CR. */
  receivableOriginalAmount?: number;
  /** Principal comissionável (sem juros/multa). */
  commissionPrincipalAmount?: number;
  /** Juros/multa/acréscimos ignorados na base. */
  ignoredFinancialChargesAmount?: number;
  auditFlags?: string[];
  commissionableBaseAmount: number;
  ratePercent: number;
  expectedCommissionAmount: number;
  releasedCommissionAmount: number;
  grossCommissionAmount: number;
  scheduledCommissionAmount: number | null;
  commissionReceivableScheduleId: string | null;
  ruleId: string | null;
  ruleName: string | null;
  exclusionReason: string | null;
  status: string;
  statusReason: string | null;
  source: string;
};

export type CommissionsReceiptClosingSellerRow = {
  sellerGroupKey: string;
  sellerId: string | null;
  sellerName: string | null;
  receivableCount: number;
  receivedAmount: number;
  commissionableBase: number;
  grossCommission: number;
  excludedCommission: number;
  expectedCommission: number;
  releasedCommission: number;
  exceptionCount: number;
};

export type CommissionsReceiptClosingPayload = {
  year: number;
  month: number;
  mode: "EMPTY" | "PREVIEW" | "CLOSED";
  exportMode: "PREVIEW" | "CLOSED" | "NONE";
  closing: CommissionsReceiptClosingSnapshot | null;
  canApply: boolean;
  applyBlockedReason: string | null;
  criticalDivergence: boolean;
  criticalDivergenceReason: string | null;
  requiresCriticalConfirmation: boolean;
  cards: CommissionsReceiptClosingMaterializationCards;
  materializationSummary: CommissionsReceiptClosingMaterializationSummary;
  reconciliation: CommissionsReceiptClosingReconciliation;
  summary: {
    totalReceivables: number;
    totalReceivedAmount: number;
    totalCommissionableBase: number;
    totalExpectedCommission: number;
    totalReleasedCommission: number;
    totalExcludedAmount: number;
    totalExceptionAmount: number;
    countByStatus: Record<string, number>;
  };
  bySeller: CommissionsReceiptClosingSellerRow[];
  lines: CommissionsReceiptClosingLine[];
  groupCompanyAuditLines: CommissionsReceiptClosingLine[];
};
