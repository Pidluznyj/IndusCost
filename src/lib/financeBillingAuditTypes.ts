/** Tipos da auditoria de composição do faturamento (Financeiro > Faturamento). */

export type BillingAuditDateBase =
  | "emissao"
  | "processamento"
  | "competencia"
  | "importacao";

export type BillingAuditValueMode =
  | "total_nf"
  | "liquido"
  | "produtos"
  | "servicos"
  | "produtos_servicos"
  | "sem_impostos"
  | "pedido_total_net";

export type BillingAuditDataSource = "SalesOrder" | "NomusNfe";

export type BillingExclusionReasonCode =
  | "OUT_OF_DATE_RANGE"
  | "WRONG_COMPANY"
  | "CANCELLED_NFE"
  | "DENIED_NFE"
  | "RETURN_OR_DEVOLUTION"
  | "NON_REVENUE_OPERATION"
  | "MISSING_ISSUE_DATE"
  | "MISSING_VALUE"
  | "DUPLICATED_KEY"
  | "NOT_LINKED_TO_ORDER"
  | "NOT_IMPORTED_FROM_NOMUS"
  | "FILTERED_BY_STATUS"
  | "FILTERED_BY_CUSTOMER"
  | "FILTERED_BY_SELLER"
  | "FILTERED_BY_CFOP"
  | "FILTERED_BY_CLASSIFICATION"
  | "UNKNOWN_REASON";

export type BillingAuditFilters = {
  year: number;
  month: number | null;
  startDate: string | null;
  endDate: string | null;
  dateBase: BillingAuditDateBase;
  companyName: string | null;
  customerName: string | null;
  customerDocument: string | null;
  sellerId: string | null;
  status: string | null;
  cfop: string | null;
  operationNature: string | null;
  classification: string | null;
  origin: string | null;
  includeCancelled: boolean;
  includeReturns: boolean;
  valueMode: BillingAuditValueMode;
};

export type BillingAuditRow = {
  id: string;
  dataSource: BillingAuditDataSource;
  includedInBilling: boolean;
  exclusionReason: string | null;
  exclusionReasonCode: BillingExclusionReasonCode | null;
  companyName: string | null;
  companyDocument: string | null;
  nfNumber: string | null;
  nfSeries: string | null;
  nfKey: string | null;
  nfStatus: string | null;
  operationNature: string | null;
  cfop: string | null;
  issueDate: string | null;
  processingDate: string | null;
  competenceDateUsed: string | null;
  importDate: string | null;
  customerName: string | null;
  customerDocument: string | null;
  sellerName: string | null;
  salesOrderCode: string | null;
  valueProducts: number | null;
  valueServices: number | null;
  valueFreight: number | null;
  valueDiscount: number | null;
  valueTaxes: number | null;
  valueTotalNf: number | null;
  valueNet: number | null;
  valueUsedInDashboard: number | null;
  valueCalculationMode: string | null;
  billingClassification: string | null;
  syncedAt: string | null;
  originLabel: string | null;
  xmlPath: string | null;
  notes: string | null;
};

export type BillingAuditItemRow = {
  id: string;
  nfKey: string | null;
  nfNumber: string | null;
  nfSeries: string | null;
  companyName: string | null;
  customerName: string | null;
  productCode: string | null;
  productDescription: string | null;
  ncm: string | null;
  cfop: string | null;
  unit: string | null;
  quantity: number | null;
  unitValue: number | null;
  grossValue: number | null;
  discountValue: number | null;
  netValue: number | null;
  salesOrderCode: string | null;
  includedInBilling: boolean;
  exclusionReason: string | null;
};

export type BillingAuditDailyTotal = {
  date: string;
  includedTotal: number;
  excludedTotal: number;
  includedCount: number;
  excludedCount: number;
};

export type BillingAuditCustomerTotal = {
  customerName: string;
  customerDocument: string | null;
  includedTotal: number;
  excludedTotal: number;
  noteCount: number;
};

export type BillingAuditOperationTotal = {
  cfop: string | null;
  operationNature: string | null;
  includedTotal: number;
  excludedTotal: number;
  noteCount: number;
  ruleApplied: string;
};

export type BillingAuditDiagnostic = {
  code: string;
  label: string;
  value: string | number | null;
  hint?: string;
};

export type BillingSourceDailyComparisonRow = {
  date: string;
  nfeTotal: number;
  salesOrderTotal: number;
  difference: number;
};

export type BillingAuditSummary = {
  dataSourceOfficial: BillingAuditDataSource;
  /** Total NF-e fiscal incluído no período (auditoria). */
  nfeFiscalTotal: number;
  /** Total SalesOrder incluído no período (auditoria). */
  salesOrderTotal: number;
  /** NF-e − SalesOrder no período. */
  sourceComparisonDifference: number;
  dateBaseUsed: BillingAuditDateBase;
  dateBaseLabel: string;
  valueModeUsed: BillingAuditValueMode;
  valueFieldLabel: string;
  periodFrom: string;
  periodTo: string;
  periodLabel: string;
  dashboardDisplayedTotal: number | null;
  grossFoundTotal: number;
  includedTotal: number;
  excludedTotal: number;
  includedCount: number;
  excludedCount: number;
  itemCount: number;
  firstDate: string | null;
  lastDate: string | null;
  lastNomusSyncAt: string | null;
  lastImportedNfeAt: string | null;
  divergenceHints: string[];
};

export type BillingAuditDivergenceRow = {
  kind: "nomus_only" | "system_only" | "value_mismatch" | "date_mismatch" | "status_mismatch";
  nfKey: string | null;
  nfNumber: string | null;
  nomusValue: number | null;
  systemValue: number | null;
  nomusDate: string | null;
  systemDate: string | null;
  notes: string;
};

export type BillingAuditResult = {
  generatedAt: string;
  exportedBy: string | null;
  filters: BillingAuditFilters;
  filtersSummary: string[];
  summary: BillingAuditSummary;
  includedRows: BillingAuditRow[];
  excludedRows: BillingAuditRow[];
  itemRows: BillingAuditItemRow[];
  dailyTotals: BillingAuditDailyTotal[];
  /** Comparação diária NF-e fiscal × SalesOrder. */
  dailySourceComparison: BillingSourceDailyComparisonRow[];
  customerTotals: BillingAuditCustomerTotal[];
  operationTotals: BillingAuditOperationTotal[];
  diagnostics: BillingAuditDiagnostic[];
  divergences: BillingAuditDivergenceRow[];
  nomusComparisonNote: string;
};
