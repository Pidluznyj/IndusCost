const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type FinanceApOperationalRow = {
  dueDate?: Date | null;
  scheduleDate?: Date | null;
  balancePayable?: number;
  suspendPayment?: boolean | null;
  type?: number | null;
  description?: string | null;
};

function normalizeApDescription(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

export function getAccountsPayableOperationalDueDate(row: FinanceApOperationalRow): Date | null {
  return row.scheduleDate ?? row.dueDate;
}

export function isAccountsPayablePurchaseOrderSchedule(row: FinanceApOperationalRow): boolean {
  if (row.type === 2) return true;
  const desc = normalizeApDescription(row.description ?? "");
  return desc.startsWith("PEDIDO DE COMPRA PC") || desc.startsWith("PEDIDO DE COMPRA");
}

export function isAccountsPayableOpen(row: FinanceApOperationalRow): boolean {
  return Number(row.balancePayable ?? 0) > 0 && row.suspendPayment !== true;
}

export function isAccountsPayableOverdue(row: FinanceApOperationalRow, today: Date): boolean {
  const operationalDueDate = getAccountsPayableOperationalDueDate(row);
  if (!operationalDueDate) return false;
  return (
    isAccountsPayableOpen(row) &&
    !isAccountsPayablePurchaseOrderSchedule(row) &&
    startOfLocalDay(operationalDueDate) < startOfLocalDay(today)
  );
}

export function computeDaysOverdueForDate(dueDate: Date | null, today: Date): number {
  if (!dueDate) return 0;
  const due = startOfLocalDay(dueDate);
  const t = startOfLocalDay(today);
  if (due >= t) return 0;
  return Math.floor((t.getTime() - due.getTime()) / MS_PER_DAY);
}

export function computeFinanceApDaysOverdue(
  row: FinanceApOperationalRow,
  today: Date
): number {
  return computeDaysOverdueForDate(getAccountsPayableOperationalDueDate(row), today);
}

export function getAccountsPayableExcludedReason(row: FinanceApOperationalRow): string {
  if (isAccountsPayablePurchaseOrderSchedule(row)) {
    return "Agenda de pedido de compra";
  }
  return "";
}

export function hasAccountsPayableRescheduledPayment(row: FinanceApOperationalRow): boolean {
  if (!row.scheduleDate || !row.dueDate) return false;
  return (
    startOfLocalDay(row.scheduleDate).getTime() !== startOfLocalDay(row.dueDate).getTime()
  );
}
