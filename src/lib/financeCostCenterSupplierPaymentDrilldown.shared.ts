/** Tipos client-safe — drilldown Pagamentos por Fornecedor (Centro de Custo). */

export const COST_CENTER_SUPPLIER_PAYMENT_METRICS_SOURCE =
  "financeCostCenterSupplierPaymentDrilldown" as const;

export const COST_CENTER_SUPPLIER_PAYMENT_DATE_RULE_NOTE =
  "Valor pago no período conforme data gerencial de liquidação do motor oficial de AP (vencimento do título para títulos liquidados). Datas operacionais de baixa permanecem no detalhe do título." as const;

export type CostCenterSupplierPaymentFiltersApplied = {
  year?: number;
  month?: number;
  status?: string;
  companyName?: string;
  costCenterId?: string;
  supplierId?: string;
  classification?: string;
};

export type CostCenterSupplierPaymentSummaryRow = {
  supplierKey: string;
  supplierId: string | null;
  supplierName: string;
  supplierDocument: string | null;
  supplierDisplayName: string;
  totalPaidAmount: number;
  paidTitlesCount: number;
  costCentersCount: number;
  lastPaymentDate: string | null;
  percentageOfTotalPaid: number;
  drilldownAvailable: boolean;
};

export type CostCenterSupplierPaymentSummaryPayload = {
  supplierPaymentSummary: CostCenterSupplierPaymentSummaryRow[];
  totalPaidAmountAllSuppliers: number;
  suppliersCount: number;
  periodLabel: string;
  paymentDateRuleNote: typeof COST_CENTER_SUPPLIER_PAYMENT_DATE_RULE_NOTE;
  filtersApplied: CostCenterSupplierPaymentFiltersApplied;
  metricsSource: typeof COST_CENTER_SUPPLIER_PAYMENT_METRICS_SOURCE;
  officialApSource: string;
};

export type CostCenterSupplierPaymentYearRow = {
  year: number;
  totalPaidAmount: number;
  paidTitlesCount: number;
  averageMonthlyPaidAmount: number | null;
  peakMonthLabel: string | null;
  peakMonthAmount: number | null;
};

export type CostCenterSupplierPaymentYearsPayload = {
  supplierKey: string;
  supplierDisplayName: string;
  years: CostCenterSupplierPaymentYearRow[];
  totalPaidAmount: number;
  paidTitlesCount: number;
  filtersApplied: CostCenterSupplierPaymentFiltersApplied;
  note: string;
};

export type CostCenterSupplierPaymentTitleRow = {
  accountsPayableId: number;
  paymentDate: string | null;
  operationalPaymentDate: string | null;
  dueDate: string | null;
  issueDate: string | null;
  documentNumber: string | null;
  sourceInvoiceId: number | null;
  sourceInvoiceNumber: string | null;
  description: string | null;
  descriptiveText: string;
  costCenterName: string;
  costCenterCode: string | null;
  amountPayable: number;
  paidAmount: number;
  statusLabel: string;
  companyName: string | null;
  nomusClassification: string | null;
  classificationOriginLabel: string;
  isManualClassification: boolean;
  primaryCostCenterId: string | null;
  hasCostCenterClassification: boolean;
  costCenterIds: string[];
};

export type CostCenterSupplierPaymentTitlesPayload = {
  supplierKey: string;
  supplierDisplayName: string;
  supplierDocument: string | null;
  year: number;
  periodLabel: string;
  periodScopeNote: string;
  items: CostCenterSupplierPaymentTitleRow[];
  totalPaidAmount: number;
  paidTitlesCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  filtersApplied: CostCenterSupplierPaymentFiltersApplied;
  listFiltersApplied: {
    search: string;
    costCenterFilter: string;
    classificationStatus: string;
  };
  costCenterOptions: Array<{ id: string; code: string; name: string }>;
};
