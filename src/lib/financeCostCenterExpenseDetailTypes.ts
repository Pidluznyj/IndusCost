import type { FinanceApDashboardFilters, FinanceApDashboardRow } from "@/src/lib/financeAccountsPayableDashboard.js";
import type { FinanceCostCenterApScope } from "@/src/lib/financeCostCenterAllocationMetrics.js";
import type { CostCenterDetailAllocationRow } from "@/src/lib/financeCostCenterDetailShared.js";
import type { CostCenterAllocationSource } from "@/src/lib/financeCostCenterDetailShared.js";

export type CostCenterExpenseDetailAllocationInput = {
  id: string;
  accountsPayableId: number;
  supplierId: string | null;
  costCenterId: string;
  amount: { toNumber?: () => number } | number | null;
  percentage: { toNumber?: () => number } | number;
  source: CostCenterAllocationSource;
  lockedManual: boolean;
  classificationRuleId: string | null;
  classificationRuleType: string | null;
  classificationRuleName: string | null;
  classificationRuleReason: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CostCenterExpenseDetailEntry = {
  allocation: CostCenterExpenseDetailAllocationInput;
  ap: FinanceApDashboardRow & {
    classification: string | null;
    comments: string | null;
    competenceDate: Date | null;
  };
  supplierName: string | null;
  costCenterCode: string;
  costCenterName: string;
};

export type CostCenterExpenseDetailExclusionReason =
  | "ORPHAN_ALLOCATION"
  | "AP_CANCELLED"
  | "AP_NOT_OFFICIAL"
  | "AP_OUT_OF_SCOPE"
  | "ZERO_CURRENT_TITLE"
  | "STALE_ALLOCATION_ONLY"
  | "DETAIL_FILTER";

export type CostCenterExpenseDetailExcludedLine = {
  allocationId: string;
  accountsPayableId: number;
  reason: CostCenterExpenseDetailExclusionReason;
  rawAllocatedAmount: number;
  currentTitleAmount: number;
  personName: string | null;
  description: string | null;
};

export type CostCenterExpenseDetailSnapshot = {
  apScope: FinanceCostCenterApScope;
  displayRows: CostCenterDetailAllocationRow[];
  excluded: CostCenterExpenseDetailExcludedLine[];
  totals: {
    allocatedAmount: number;
    balancePayable: number;
    amountPayable: number;
    titlesCount: number;
  };
  audit: {
    headerAllocatedTotal: number;
    linesAllocatedSum: number;
    difference: number;
    orphanAllocations: CostCenterExpenseDetailExcludedLine[];
    staleAllocationAmountExcluded: number;
    cancelledApAllocations: CostCenterExpenseDetailExcludedLine[];
    overAllocatedLines: Array<{
      allocationId: string;
      accountsPayableId: number;
      rawAllocatedAmount: number;
      currentTitleAmount: number;
      excludedStaleAmount: number;
    }>;
  };
};

export type CostCenterExpenseDetailListFilters = FinanceApDashboardFilters & {
  competenceYear?: number;
  competenceMonth?: number;
  supplierId?: string;
  allocationSource?: CostCenterAllocationSource | "all";
  manualOnly?: boolean;
  lockedOnly?: boolean;
  batchOnly?: boolean;
  divergentOnly?: boolean;
  minAmount?: number;
  maxAmount?: number;
  search?: string;
  hasPayment?: "all" | "yes" | "no";
  timing?: "all" | "overdue" | "upcoming" | "paid";
  nomusClassification?: string;
  competenceDateFrom?: string;
  competenceDateTo?: string;
  paymentDateFrom?: string;
  paymentDateTo?: string;
};
