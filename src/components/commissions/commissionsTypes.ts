/** Tipos de payload das APIs de comissões (frontend — sem imports server-only). */

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
