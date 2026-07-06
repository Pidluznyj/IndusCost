/**
 * Auditoria: alocações de centro de custo vs títulos AP atuais.
 */
import { roundMoney } from "@/src/lib/financeAccountsPayableDashboard.js";
import type { CostCenterDetailAllocationRow } from "@/src/lib/financeCostCenterDetailShared.js";
import type { CostCenterExpenseDetailSnapshot } from "@/src/lib/financeCostCenterExpenseDetailTypes.js";

export type {
  CostCenterExpenseDetailAllocationInput,
  CostCenterExpenseDetailEntry,
  CostCenterExpenseDetailExcludedLine,
  CostCenterExpenseDetailExclusionReason,
  CostCenterExpenseDetailSnapshot,
} from "@/src/lib/financeCostCenterExpenseDetailTypes.js";

export { buildCostCenterExpenseDetailSnapshot } from "@/src/lib/financeCostCenterDetail.js";

export type CostCenterAllocationVsApAuditLine = {
  allocationId: string;
  accountsPayableId: number;
  personName: string | null;
  description: string | null;
  dueDate: string | null;
  competenceDate: string | null;
  allocatedAmount: number;
  rawAllocatedAmount: number;
  currentTitleAmount: number;
  balancePayable: number;
  amountPayable: number;
  status: string;
  exclusionReason: string | null;
};

export type CostCenterAllocationVsApAuditReport = {
  costCenterCode: string;
  costCenterName: string;
  filters: Record<string, unknown>;
  headerAllocatedTotal: number;
  linesAllocatedSum: number;
  difference: number;
  titlesCount: number;
  orphanAllocations: Array<{
    allocationId: string;
    accountsPayableId: number;
    rawAllocatedAmount: number;
    updatedAt: string | null;
  }>;
  apWithoutAllocation: Array<{
    accountsPayableId: number;
    personName: string | null;
    description: string | null;
    amountPayable: number;
    balancePayable: number;
  }>;
  duplicateAllocations: Array<{
    accountsPayableId: number;
    costCenterId: string;
    count: number;
  }>;
  overAllocatedLines: CostCenterExpenseDetailSnapshot["audit"]["overAllocatedLines"];
  cancelledApLines: CostCenterExpenseDetailSnapshot["audit"]["cancelledApAllocations"];
  staleAllocationAmountExcluded: number;
  topDivergences: CostCenterAllocationVsApAuditLine[];
  supplierGroups: Array<{
    supplierKey: string;
    supplierName: string;
    allocatedAmount: number;
    titlesCount: number;
  }>;
  displayLines: CostCenterAllocationVsApAuditLine[];
};

function finiteMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return roundMoney(value);
}

function toAuditLine(
  row: CostCenterDetailAllocationRow,
  rawAllocatedAmount: number,
  currentTitleAmount: number,
  exclusionReason: string | null
): CostCenterAllocationVsApAuditLine {
  return {
    allocationId: row.allocationId,
    accountsPayableId: row.accountsPayableId,
    personName: row.personName ?? row.supplierName,
    description: row.description,
    dueDate: row.dueDate,
    competenceDate: row.competenceDate,
    allocatedAmount: row.allocatedAmount,
    rawAllocatedAmount,
    currentTitleAmount,
    balancePayable: row.balancePayable,
    amountPayable: row.amountPayable,
    status: row.statusLabel,
    exclusionReason,
  };
}

export function buildCostCenterAllocationVsApAuditReport(input: {
  costCenterCode: string;
  costCenterName: string;
  filters: Record<string, unknown>;
  snapshot: CostCenterExpenseDetailSnapshot;
  orphanAllocations: Array<{
    allocationId: string;
    accountsPayableId: number;
    rawAllocatedAmount: number;
    updatedAt: string | null;
  }>;
  apWithoutAllocation: CostCenterAllocationVsApAuditReport["apWithoutAllocation"];
  duplicateAllocations: CostCenterAllocationVsApAuditReport["duplicateAllocations"];
  rawLinesByAllocationId: Map<string, { raw: number; titleAmount: number }>;
}): CostCenterAllocationVsApAuditReport {
  const displayLines = input.snapshot.displayRows.map((row) => {
    const raw = input.rawLinesByAllocationId.get(row.allocationId);
    return toAuditLine(row, raw?.raw ?? row.allocatedAmount, raw?.titleAmount ?? row.amountPayable, null);
  });

  const excludedLines = input.snapshot.excluded.map((line) =>
    toAuditLine(
      {
        allocationId: line.allocationId,
        accountsPayableId: line.accountsPayableId,
        personName: line.personName,
        description: line.description,
        dueDate: null,
        competenceDate: null,
        allocatedAmount: 0,
        balancePayable: 0,
        amountPayable: line.currentTitleAmount,
        statusLabel: line.reason,
      } as CostCenterDetailAllocationRow,
      line.rawAllocatedAmount,
      line.currentTitleAmount,
      line.reason
    )
  );

  const topDivergences = [...displayLines, ...excludedLines]
    .filter((line) => Math.abs(line.rawAllocatedAmount - line.allocatedAmount) > 0.009)
    .sort(
      (a, b) =>
        Math.abs(b.rawAllocatedAmount - b.allocatedAmount) -
        Math.abs(a.rawAllocatedAmount - a.allocatedAmount)
    )
    .slice(0, 25);

  const supplierGroups = new Map<
    string,
    { supplierName: string; allocatedAmount: number; titleIds: Set<number> }
  >();
  for (const line of displayLines) {
    const key = line.personName ?? `ap:${line.accountsPayableId}`;
    const row = supplierGroups.get(key) ?? {
      supplierName: line.personName ?? "—",
      allocatedAmount: 0,
      titleIds: new Set<number>(),
    };
    row.allocatedAmount = finiteMoney(row.allocatedAmount + line.allocatedAmount);
    row.titleIds.add(line.accountsPayableId);
    supplierGroups.set(key, row);
  }

  return {
    costCenterCode: input.costCenterCode,
    costCenterName: input.costCenterName,
    filters: input.filters,
    headerAllocatedTotal: input.snapshot.audit.headerAllocatedTotal,
    linesAllocatedSum: input.snapshot.audit.linesAllocatedSum,
    difference: input.snapshot.audit.difference,
    titlesCount: input.snapshot.totals.titlesCount,
    orphanAllocations: input.orphanAllocations,
    apWithoutAllocation: input.apWithoutAllocation,
    duplicateAllocations: input.duplicateAllocations,
    overAllocatedLines: input.snapshot.audit.overAllocatedLines,
    cancelledApLines: input.snapshot.audit.cancelledApAllocations,
    staleAllocationAmountExcluded: input.snapshot.audit.staleAllocationAmountExcluded,
    topDivergences,
    supplierGroups: [...supplierGroups.entries()]
      .map(([supplierKey, row]) => ({
        supplierKey,
        supplierName: row.supplierName,
        allocatedAmount: row.allocatedAmount,
        titlesCount: row.titleIds.size,
      }))
      .sort((a, b) => b.allocatedAmount - a.allocatedAmount),
    displayLines,
  };
}
