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
