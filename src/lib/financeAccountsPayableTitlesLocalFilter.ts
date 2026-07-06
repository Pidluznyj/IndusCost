import {
  classifyFinanceApTitle,
  isFinanceApOpen,
  isFinanceApSettled,
  type FinanceApDashboardRow,
} from "./financeAccountsPayableDashboard.js";
import { isFinanceApPurchaseOrderAgenda } from "./financeInternalGroupExclusions.js";
import {
  getAccountsPayableExcludedReason,
  hasAccountsPayableRescheduledPayment,
  isAccountsPayableOverdue,
  isAccountsPayablePurchaseOrderSchedule,
} from "./financeAccountsPayableOperational.js";

export type FinanceApTitlesLocalFilter =
  | "all"
  | "settled"
  | "open"
  | "overdue"
  | "dueToday"
  | "upcoming"
  | "scheduled"
  | "excluded"
  | "purchaseOrder";

export const FINANCE_AP_TITLES_LOCAL_FILTER_OPTIONS: Array<{
  value: FinanceApTitlesLocalFilter;
  label: string;
}> = [
  { value: "all", label: "Todos" },
  { value: "settled", label: "Pagos" },
  { value: "open", label: "Em aberto" },
  { value: "overdue", label: "Vencidos gerenciais" },
  { value: "dueToday", label: "Vence hoje" },
  { value: "upcoming", label: "A vencer" },
  { value: "scheduled", label: "Agendados" },
  { value: "excluded", label: "Excluídos da visão" },
  { value: "purchaseOrder", label: "Pedido de compra" },
];

export function parseFinanceApTitlesLocalFilter(
  value: unknown,
  fallback: FinanceApTitlesLocalFilter = "all"
): FinanceApTitlesLocalFilter {
  const raw = String(value ?? "").trim();
  return FINANCE_AP_TITLES_LOCAL_FILTER_OPTIONS.some((o) => o.value === raw)
    ? (raw as FinanceApTitlesLocalFilter)
    : fallback;
}

export function isFinanceApTitleExcludedFromManagement(row: FinanceApDashboardRow): boolean {
  return isFinanceApPurchaseOrderAgenda(row) || isAccountsPayablePurchaseOrderSchedule(row);
}

/** Filtro local do grid — não altera filtros globais aplicados. */
export function filterApTitleRowsByLocalFilter(
  rows: FinanceApDashboardRow[],
  localFilter: FinanceApTitlesLocalFilter,
  referenceDate: Date = new Date()
): FinanceApDashboardRow[] {
  if (localFilter === "all") return rows;

  return rows.filter((row) => {
    const status = classifyFinanceApTitle(row, referenceDate);
    const open = isFinanceApOpen(row);
    const scheduled =
      isFinanceApOpen(row) && hasAccountsPayableRescheduledPayment(row);
    const excluded = isFinanceApTitleExcludedFromManagement(row);
    const managerialOverdue = isAccountsPayableOverdue(row, referenceDate);

    switch (localFilter) {
      case "settled":
        return isFinanceApSettled(row);
      case "open":
        return open && !excluded;
      case "overdue":
        return managerialOverdue;
      case "dueToday":
        return status === "dueToday" && !excluded;
      case "upcoming":
        return status === "upcoming" && !excluded;
      case "scheduled":
        return scheduled && !excluded;
      case "excluded":
        return excluded;
      case "purchaseOrder":
        return isAccountsPayablePurchaseOrderSchedule(row);
      default:
        return true;
    }
  });
}

export function resolveFinanceApTitleExclusionReason(row: FinanceApDashboardRow): string {
  const reason = getAccountsPayableExcludedReason(row);
  if (reason) return reason;
  if (hasAccountsPayableRescheduledPayment(row)) {
    return "Data agendada divergente do vencimento original";
  }
  return "Incluído na visão gerencial";
}
