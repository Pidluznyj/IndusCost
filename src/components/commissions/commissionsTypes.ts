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
  commissionPersonId: string;
  commissionPersonName: string;
  orderCode: string | null;
  nfeNumber: string | null;
  nomusReceivableId: number | null;
  dueDate: string | null;
  installmentNumber: number | null;
  parcelAmount: number | null;
  receivedAmount: number | null;
  receivedPercent: number | null;
  commissionParcelAmount: number;
  commissionReleasedAmount: number;
  balanceToRelease: number;
  status: string;
};

export type CommissionsReleasesPayload = {
  items: CommissionsReleaseItem[];
  pagination: CommissionsPagination;
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
};

export type CommissionsPersonsPayload = {
  items: CommissionsPersonItem[];
  pagination: CommissionsPagination;
};

export type CommissionsRuleItem = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  priority: number;
  beneficiaryType: string;
  fixedCommissionPersonId: string | null;
  ratePercent: number;
  baseType: string;
  releaseRule: string;
  validFrom: string | null;
  validTo: string | null;
  conditions: unknown[];
  createdAt: string;
  updatedAt: string;
};

export type CommissionsRulesPayload = {
  items: CommissionsRuleItem[];
  pagination: CommissionsPagination;
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
};

export type CommissionsAuditPayload = {
  items: CommissionsAuditItem[];
  pagination: CommissionsPagination;
};

export type CommissionsSettingsPayload = {
  releaseDefaultRule: string;
  forecastEnabled: boolean;
  outputDocumentSupersedesForecast: boolean;
  paidCommissionBlockAutoChange: boolean;
};

export type CommissionsPaymentBatchItem = {
  id: string;
  periodStart: string;
  periodEnd: string;
  commissionPersonId: string;
  commissionPersonName: string;
  status: string;
  totalReleased: number;
  totalSelected: number;
  totalPaid: number;
  paymentDate: string | null;
  itemsCount: number;
  createdAt: string;
};

export type CommissionsPaymentBatchesPayload = {
  items: CommissionsPaymentBatchItem[];
  pagination: CommissionsPagination;
};
