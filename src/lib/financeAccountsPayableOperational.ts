import { diffCivilDays, startOfCivilDate } from "./financeCivilDate.js";
import {
  FINANCE_AP_INTERCOMPANY_GROUP,
  isIntercompanyPayable,
} from "./financeInternalGroupExclusions.js";

export type FinanceApOperationalRow = {
  companyName?: string | null;
  personName?: string | null;
  personCnpj?: string | null;
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

/**
 * Eixo financeiro padrão de Contas a Pagar: data de vencimento (dueDate).
 * scheduleDate existe apenas como informação/auditoria — não posterga agrupamento.
 */
export function getAccountsPayableOperationalDueDate(row: FinanceApOperationalRow): Date | null {
  return row.dueDate ?? row.scheduleDate ?? null;
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
    startOfCivilDate(operationalDueDate) < startOfLocalDay(today)
  );
}

export function computeDaysOverdueForDate(dueDate: Date | null, today: Date): number {
  if (!dueDate) return 0;
  const overdue = diffCivilDays(dueDate, today);
  return overdue > 0 ? overdue : 0;
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
  if (isIntercompanyPayable(row)) {
    return `Movimento intercompany (${FINANCE_AP_INTERCOMPANY_GROUP})`;
  }
  return "";
}

export function hasAccountsPayableRescheduledPayment(row: FinanceApOperationalRow): boolean {
  if (!row.scheduleDate || !row.dueDate) return false;
  return (
    startOfCivilDate(row.scheduleDate).getTime() !== startOfCivilDate(row.dueDate).getTime()
  );
}
