import type { FinanceCashFlowCalendarMovement } from "./financeCashFlowCalendar.js";
import type { SortDirection, SortState } from "./soldProductsTableSort.js";

export type CalendarMovementSortKey =
  | "type"
  | "companyName"
  | "personName"
  | "documentNumber"
  | "description"
  | "dueDate"
  | "scheduleDate"
  | "settlementDate"
  | "amountOriginal"
  | "amountRealized"
  | "balanceOpen"
  | "calendarAmount"
  | "status"
  | "source";

export const DEFAULT_CALENDAR_MOVEMENT_SORT: SortState<CalendarMovementSortKey> = {
  key: "calendarAmount",
  direction: "desc",
};

function compareValues(a: unknown, b: unknown, kind: "text" | "number" | "date"): number {
  if (kind === "number") {
    const na = typeof a === "number" && Number.isFinite(a) ? a : 0;
    const nb = typeof b === "number" && Number.isFinite(b) ? b : 0;
    return na - nb;
  }
  if (kind === "date") {
    const ta = a ? new Date(String(a)).getTime() : 0;
    const tb = b ? new Date(String(b)).getTime() : 0;
    if (!Number.isFinite(ta) && !Number.isFinite(tb)) return 0;
    if (!Number.isFinite(ta)) return 1;
    if (!Number.isFinite(tb)) return -1;
    return ta - tb;
  }
  return String(a ?? "").localeCompare(String(b ?? ""), "pt-BR", { sensitivity: "base" });
}

const ACCESSORS: Record<
  CalendarMovementSortKey,
  { get: (row: FinanceCashFlowCalendarMovement) => unknown; kind: "text" | "number" | "date" }
> = {
  type: { get: (r) => r.type, kind: "text" },
  companyName: { get: (r) => r.companyName, kind: "text" },
  personName: { get: (r) => r.personName, kind: "text" },
  documentNumber: { get: (r) => r.documentNumber ?? r.invoiceNumber, kind: "text" },
  description: { get: (r) => r.description, kind: "text" },
  dueDate: { get: (r) => r.dueDate, kind: "date" },
  scheduleDate: { get: (r) => r.scheduleDate, kind: "date" },
  settlementDate: { get: (r) => r.settlementDate, kind: "date" },
  amountOriginal: { get: (r) => r.amountOriginal, kind: "number" },
  amountRealized: { get: (r) => r.amountRealized, kind: "number" },
  balanceOpen: { get: (r) => r.balanceOpen, kind: "number" },
  calendarAmount: { get: (r) => r.calendarAmount, kind: "number" },
  status: { get: (r) => r.status, kind: "text" },
  source: { get: (r) => r.source, kind: "text" },
};

export function toggleCalendarMovementSort(
  current: SortState<CalendarMovementSortKey>,
  key: CalendarMovementSortKey
): SortState<CalendarMovementSortKey> {
  if (current.key === key) {
    return { key, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  const defaultDirection: SortDirection =
    ACCESSORS[key].kind === "text" ? "asc" : "desc";
  return { key, direction: defaultDirection };
}

export function sortCalendarMovements(
  rows: FinanceCashFlowCalendarMovement[],
  sort: SortState<CalendarMovementSortKey>
): FinanceCashFlowCalendarMovement[] {
  const accessor = ACCESSORS[sort.key];
  const sorted = [...rows].sort((a, b) => {
    const cmp = compareValues(accessor.get(a), accessor.get(b), accessor.kind);
    return sort.direction === "asc" ? cmp : -cmp;
  });
  return sorted;
}
