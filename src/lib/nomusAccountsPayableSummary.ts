import type { Prisma } from "@prisma/client";

export type AccountsPayableSummaryRow = {
  balancePayable: Prisma.Decimal | null;
  amountPaid: Prisma.Decimal | null;
  amountPayable: Prisma.Decimal | null;
  status: boolean | null;
  dueDate: Date | null;
  settlementDate: Date | null;
  paymentDate: Date | null;
  syncedAt: Date;
};

export type AccountsPayableSummary = {
  total: number;
  open: number;
  settled: number;
  totalOpenAmount: number;
  overdueAmount: number;
  dueNext7DaysAmount: number;
  dueNext30DaysAmount: number;
  paidThisMonthAmount: number;
  lastSyncAt: string | null;
};

function decimalToNumber(value: Prisma.Decimal | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === "object" && "toNumber" in value ? value.toNumber() : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Registro em aberto = saldo a pagar positivo. */
export function isAccountsPayableOpen(row: Pick<AccountsPayableSummaryRow, "balancePayable">): boolean {
  return decimalToNumber(row.balancePayable) > 0;
}

export function isAccountsPayableSettled(
  row: Pick<AccountsPayableSummaryRow, "balancePayable" | "status">
): boolean {
  const balance = decimalToNumber(row.balancePayable);
  if (balance <= 0) return true;
  return row.status === true;
}

function isDueInRange(dueDate: Date, from: Date, to: Date): boolean {
  const due = startOfDay(dueDate).getTime();
  return due >= from.getTime() && due <= to.getTime();
}

export function buildAccountsPayableSummary(
  rows: AccountsPayableSummaryRow[],
  referenceDate: Date = new Date()
): AccountsPayableSummary {
  const today = startOfDay(referenceDate);
  const in7Days = endOfDay(addDays(today, 7));
  const in30Days = endOfDay(addDays(today, 30));
  const monthStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1, 0, 0, 0, 0);
  const monthEnd = endOfDay(new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0));

  let open = 0;
  let settled = 0;
  let totalOpenAmount = 0;
  let overdueAmount = 0;
  let dueNext7DaysAmount = 0;
  let dueNext30DaysAmount = 0;
  let paidThisMonthAmount = 0;
  let lastSyncAt: Date | null = null;

  for (const row of rows) {
    const balance = decimalToNumber(row.balancePayable);
    const paid = decimalToNumber(row.amountPaid);

    if (lastSyncAt == null || row.syncedAt > lastSyncAt) {
      lastSyncAt = row.syncedAt;
    }

    const paidAt = row.paymentDate ?? row.settlementDate;
    if (paidAt && paidAt.getTime() >= monthStart.getTime() && paidAt.getTime() <= monthEnd.getTime()) {
      paidThisMonthAmount += paid;
    }

    if (isAccountsPayableOpen(row)) {
      open += 1;
      totalOpenAmount += balance;

      if (row.dueDate) {
        const due = startOfDay(row.dueDate);
        if (due < today) {
          overdueAmount += balance;
        }
        if (isDueInRange(row.dueDate, today, in7Days)) {
          dueNext7DaysAmount += balance;
        }
        if (isDueInRange(row.dueDate, today, in30Days)) {
          dueNext30DaysAmount += balance;
        }
      }
    } else if (isAccountsPayableSettled(row)) {
      settled += 1;
    }
  }

  return {
    total: rows.length,
    open,
    settled,
    totalOpenAmount,
    overdueAmount,
    dueNext7DaysAmount,
    dueNext30DaysAmount,
    paidThisMonthAmount,
    lastSyncAt: lastSyncAt?.toISOString() ?? null,
  };
}
