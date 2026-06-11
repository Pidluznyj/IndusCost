import {
  classifyFinanceArTitle,
  isFinanceArOpen,
  type FinanceArDashboardRow,
} from "./financeAccountsReceivableDashboard.js";

export type FinanceArTitlesLocalFilter =
  | "all"
  | "settled"
  | "open"
  | "overdue"
  | "dueToday"
  | "upcoming"
  | "partial"
  | "missingDocument";

export const FINANCE_AR_TITLES_LOCAL_FILTER_OPTIONS: Array<{
  value: FinanceArTitlesLocalFilter;
  label: string;
}> = [
  { value: "all", label: "Todos" },
  { value: "settled", label: "Pagos" },
  { value: "open", label: "Em aberto" },
  { value: "overdue", label: "Vencidos" },
  { value: "dueToday", label: "Vence hoje" },
  { value: "upcoming", label: "A vencer" },
  { value: "partial", label: "Parcial" },
  { value: "missingDocument", label: "Sem documento" },
];

export function isFinanceArTitlesLocalFilter(value: string): value is FinanceArTitlesLocalFilter {
  return FINANCE_AR_TITLES_LOCAL_FILTER_OPTIONS.some((o) => o.value === value);
}

export function parseFinanceArTitlesLocalFilter(
  value: unknown,
  fallback: FinanceArTitlesLocalFilter = "all"
): FinanceArTitlesLocalFilter {
  const raw = String(value ?? "").trim();
  return isFinanceArTitlesLocalFilter(raw) ? raw : fallback;
}

/** Filtro local do grid — não altera filtros globais aplicados. */
export function filterArTitleRowsByLocalFilter(
  rows: FinanceArDashboardRow[],
  localFilter: FinanceArTitlesLocalFilter,
  referenceDate: Date = new Date()
): FinanceArDashboardRow[] {
  if (localFilter === "all") return rows;

  return rows.filter((row) => {
    const status = classifyFinanceArTitle(row, referenceDate);
    const open = isFinanceArOpen(row);
    const partial = row.amountReceived > 0 && open;
    const missingDoc = open && !row.sourceInvoiceNumber?.trim() && row.sourceInvoiceId == null;

    switch (localFilter) {
      case "settled":
        return !open;
      case "open":
        return open;
      case "overdue":
        return status === "overdue";
      case "dueToday":
        return status === "dueToday";
      case "upcoming":
        return status === "upcoming";
      case "partial":
        return partial;
      case "missingDocument":
        return missingDoc;
      default:
        return true;
    }
  });
}
