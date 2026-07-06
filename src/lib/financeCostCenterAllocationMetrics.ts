import { decimalFieldToNumber, roundMoney } from "@/src/lib/financeAccountsPayableDashboard.js";
import type { FinanceApDashboardRow } from "@/src/lib/financeAccountsPayableDashboard.js";
import {
  FINANCE_AP_ALLOCATION_AMOUNT_TOLERANCE,
  FINANCE_AP_ALLOCATION_PERCENTAGE_TOLERANCE,
} from "@/src/lib/financeApAllocationShared.js";

export type FinanceCostCenterApScope = "open_only" | "all_in_filter";

export type CostCenterAllocationRow = {
  amount: { toNumber?: () => number } | number | null;
  percentage: { toNumber?: () => number } | number;
};

function finiteMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return roundMoney(value);
}

function decimalToNumber(value: CostCenterAllocationRow["percentage"]): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  return decimalFieldToNumber(value as Parameters<typeof decimalFieldToNumber>[0]);
}

function allocationAmount(
  allocation: CostCenterAllocationRow,
  titleAmount: number
): number {
  const explicit =
    allocation.amount == null
      ? 0
      : typeof allocation.amount === "number"
        ? allocation.amount
        : decimalFieldToNumber(allocation.amount as Parameters<typeof decimalFieldToNumber>[0]);
  if (explicit > 0) return finiteMoney(explicit);
  return finiteMoney((titleAmount * decimalToNumber(allocation.percentage)) / 100);
}

export type CappedCostCenterAllocationAmount = {
  allocatedAmount: number;
  rawAllocatedAmount: number;
  staleExcludedAmount: number;
};

/** Alocação limitada ao valor atual do título AP (evita snapshot stale no banco). */
export function resolveCappedCostCenterAllocationAmount(
  allocation: CostCenterAllocationRow,
  titleAmount: number
): CappedCostCenterAllocationAmount {
  const rawAllocatedAmount = allocationAmount(allocation, titleAmount);
  if (titleAmount <= FINANCE_AP_ALLOCATION_AMOUNT_TOLERANCE) {
    return {
      allocatedAmount: 0,
      rawAllocatedAmount,
      staleExcludedAmount: finiteMoney(rawAllocatedAmount),
    };
  }
  const allocatedAmount = finiteMoney(Math.min(rawAllocatedAmount, titleAmount));
  return {
    allocatedAmount,
    rawAllocatedAmount,
    staleExcludedAmount: finiteMoney(Math.max(0, rawAllocatedAmount - allocatedAmount)),
  };
}

export function parseFinanceCostCenterApScope(value: unknown): FinanceCostCenterApScope {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "all" || raw === "all_in_filter" || raw === "periodo" || raw === "competencia") {
    return "all_in_filter";
  }
  if (raw === "open" || raw === "open_only" || raw === "aberto") {
    return "open_only";
  }
  return "open_only";
}

/** Escopo gerencial derivado do filtro de status AP (quando apScope não é explícito na query). */
export function resolveCostCenterApScopeFromStatus(status: string | undefined): FinanceCostCenterApScope {
  const normalized = (status ?? "all").trim().toLowerCase();
  if (
    normalized === "open" ||
    normalized === "overdue" ||
    normalized === "duetoday" ||
    normalized === "upcoming"
  ) {
    return "open_only";
  }
  return "all_in_filter";
}

export function resolveOpenOnlyFromApStatus(status: string | undefined): boolean {
  return resolveCostCenterApScopeFromStatus(status) === "open_only";
}

export function resolveCostCenterClassificationScopeLabel(
  status: string | undefined,
  scope: FinanceCostCenterApScope
): string {
  const normalized = (status ?? "all").trim().toLowerCase();
  if (scope === "open_only" || normalized === "open") return "Total AP em aberto";
  if (normalized === "settled") return "Total AP pago/liquidado";
  return "Total AP no filtro";
}

/**
 * Valor base do título para métricas de centro de custo.
 * - open_only: saldo em aberto (balancePayable), coerente com visão “em aberto”.
 * - all_in_filter: amountPayable nominal — mesma base do card Total a pagar AP.
 */
export function resolveCostCenterTitleAmount(
  row: Pick<FinanceApDashboardRow, "balancePayable" | "amountPayable" | "amountPaid">,
  scope: FinanceCostCenterApScope = "open_only"
): number {
  const balance = Math.abs(row.balancePayable);
  if (scope === "open_only") return finiteMoney(balance);
  return finiteMoney(Math.abs(row.amountPayable ?? 0));
}

export function isCostCenterTitleInScope(
  row: Pick<FinanceApDashboardRow, "balancePayable">,
  scope: FinanceCostCenterApScope = "open_only"
): boolean {
  if (scope === "all_in_filter") return true;
  return row.balancePayable > FINANCE_AP_ALLOCATION_AMOUNT_TOLERANCE;
}

export function resolveTitleAllocatedAmount(
  allocations: CostCenterAllocationRow[],
  titleAmount: number
): number {
  if (allocations.length === 0) return 0;
  return finiteMoney(
    allocations.reduce((sum, row) => sum + allocationAmount(row, titleAmount), 0)
  );
}

/** Diferença financeira sem centro de custo alocado (tolerância R$ 0,01). */
export function resolveTitleUnallocatedGap(
  allocations: CostCenterAllocationRow[],
  titleAmount: number
): number {
  if (titleAmount <= FINANCE_AP_ALLOCATION_AMOUNT_TOLERANCE) {
    const allocated = resolveTitleAllocatedAmount(allocations, titleAmount);
    return allocated <= FINANCE_AP_ALLOCATION_AMOUNT_TOLERANCE ? 0 : finiteMoney(allocated);
  }
  const allocated = resolveTitleAllocatedAmount(allocations, titleAmount);
  return finiteMoney(Math.max(0, titleAmount - allocated));
}

/** Título com alocação real completa (valor alocado cobre o valor base). */
export function isTitleRealAllocated(
  allocations: CostCenterAllocationRow[],
  titleAmount: number
): boolean {
  return resolveTitleUnallocatedGap(allocations, titleAmount) <= FINANCE_AP_ALLOCATION_AMOUNT_TOLERANCE;
}

/**
 * Compatibilidade retroativa: com titleAmount > 0 usa alocação real por valor;
 * sem titleAmount mantém checagem legada por percentual.
 */
export function isTitleFullyClassified(
  allocations: CostCenterAllocationRow[],
  titleAmount = 0
): boolean {
  if (titleAmount > FINANCE_AP_ALLOCATION_AMOUNT_TOLERANCE) {
    return isTitleRealAllocated(allocations, titleAmount);
  }
  if (allocations.length === 0) return false;
  const pct = finiteMoney(
    allocations.reduce((sum, row) => sum + decimalToNumber(row.percentage), 0)
  );
  return Math.abs(pct - 100) <= FINANCE_AP_ALLOCATION_PERCENTAGE_TOLERANCE;
}
