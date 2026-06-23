/** Tipos compartilhados (client-safe) — detalhe de centro de custo e realocação. */

export const FINANCE_CC_REALLOCATION_REASONS = [
  { value: "MANUAL_CORRECTION", label: "Correção manual" },
  { value: "BUSINESS_RULE", label: "Regra de negócio" },
  { value: "FINANCIAL_RECLASSIFICATION", label: "Reclassificação financeira" },
  { value: "SUPPLIER_ERROR", label: "Erro de fornecedor" },
] as const;

export type FinanceCcReallocationReason =
  (typeof FINANCE_CC_REALLOCATION_REASONS)[number]["value"];

export const FINANCE_CC_REALLOCATION_AUDIT_ACTION = "REALLOCATE_COST_CENTER" as const;

export const FINANCE_CC_REALLOCATION_MANUAL_CONFIRMATION_TEXT =
  "CONFIRMAR REALOCACAO MANUAL" as const;

export type CostCenterAllocationSource = "AUTO_RULE" | "MANUAL" | "BATCH";

export type CostCenterDetailSortField =
  | "supplier"
  | "company"
  | "dueDate"
  | "competenceDate"
  | "amountPayable"
  | "balancePayable"
  | "allocatedAmount"
  | "classification"
  | "source"
  | "status";

export type CostCenterDetailSortDirection = "asc" | "desc";

export type CostCenterDetailAllocationRow = {
  allocationId: string;
  accountsPayableId: number;
  companyName: string | null;
  personName: string | null;
  personCnpj: string | null;
  nomusClassification: string | null;
  description: string | null;
  comments: string | null;
  documentNumber: string | null;
  sourceInvoiceId: number | null;
  dueDate: string | null;
  competenceDate: string | null;
  paymentDate: string | null;
  settlementDate: string | null;
  statusKey: string;
  statusLabel: string;
  amountPayable: number;
  balancePayable: number;
  allocatedAmount: number;
  allocatedPercentage: number;
  allocationSource: CostCenterAllocationSource;
  lockedManual: boolean;
  costCenterId: string;
  costCenterCode: string;
  costCenterName: string;
  supplierId: string | null;
  supplierName: string | null;
  allocationNotes: string | null;
  allocationCreatedAt: string;
  allocationUpdatedAt: string;
  isPartialTitle: boolean;
};

export type CostCenterDetailSummary = {
  costCenterId: string;
  code: string;
  name: string;
  parentId: string | null;
  parentCode: string | null;
  parentName: string | null;
  status: string;
  totalAllocatedAmount: number;
  titlesCount: number;
  suppliersCount: number;
  overdueAmount: number;
  upcomingAmount: number;
  topSupplierName: string | null;
  topSupplierAmount: number;
  topNomusClassification: string | null;
  allocationSourceBreakdown: {
    AUTO_RULE: number;
    BATCH: number;
    MANUAL: number;
  };
};

export type CostCenterDetailListPayload = {
  items: CostCenterDetailAllocationRow[];
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  totals: {
    allocatedAmount: number;
    balancePayable: number;
    amountPayable: number;
  };
};

export type CostCenterReallocationPreviewItem = {
  allocationId: string;
  accountsPayableId: number;
  personName: string | null;
  allocatedAmount: number;
  source: CostCenterAllocationSource;
  lockedManual: boolean;
  action: "move" | "skip";
  skipReason: string | null;
};

export type CostCenterReallocationPreviewPayload = {
  sourceCostCenterId: string;
  sourceCostCenterLabel: string;
  targetCostCenterId: string;
  targetCostCenterLabel: string;
  reason: FinanceCcReallocationReason;
  reasonNote: string | null;
  items: CostCenterReallocationPreviewItem[];
  summary: {
    selected: number;
    wouldMove: number;
    skipped: number;
    skippedManualLocked: number;
    skippedManualSource: number;
    skippedConflict: number;
    totalAmount: number;
    sourceAmountBefore: number;
    sourceAmountAfter: number;
    targetAmountBefore: number;
    targetAmountAfter: number;
  };
  warnings: string[];
  requiresManualConfirmation: boolean;
  requiredManualConfirmationText: string | null;
};

export type CostCenterReallocationApplyPayload = {
  ok: true;
  appliedAt: string;
  moved: number;
  skipped: number;
  totalAmountMoved: number;
  summary: CostCenterReallocationPreviewPayload["summary"];
};
