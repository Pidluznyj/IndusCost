import type { Prisma } from "@prisma/client";

export type AccountsReceivableSummaryRow = {
  balanceReceivable: Prisma.Decimal | null;
  amountReceived: Prisma.Decimal | null;
  amountReceivable: Prisma.Decimal | null;
  status: boolean | null;
  dueDate: Date | null;
  syncedAt: Date;
};

export type AccountsReceivableSummary = {
  totalRecords: number;
  openCount: number;
  settledCount: number;
  totalBalanceReceivable: number;
  totalAmountReceived: number;
  totalAmountReceivable: number;
  overdueCount: number;
  overdueBalance: number;
  dueNext30DaysCount: number;
  dueNext30DaysBalance: number;
  lastSyncedAt: string | null;
};

function decimalToNumber(value: Prisma.Decimal | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === "object" && "toNumber" in value ? value.toNumber() : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Registro em aberto = saldo a receber positivo. */
export function isAccountsReceivableOpen(row: Pick<AccountsReceivableSummaryRow, "balanceReceivable">): boolean {
  return decimalToNumber(row.balanceReceivable) > 0;
}

export function isAccountsReceivableSettled(row: Pick<AccountsReceivableSummaryRow, "balanceReceivable" | "status">): boolean {
  const balance = decimalToNumber(row.balanceReceivable);
  if (balance <= 0) return true;
  return row.status === true;
}

/** @deprecated Use {@link buildOfficialNomusAccountsReceivableSummaryResponse} — resumo gerencial oficial. */
export function buildAccountsReceivableSummary(
  rows: AccountsReceivableSummaryRow[],
  referenceDate: Date = new Date()
): AccountsReceivableSummary {
  const today = startOfDay(referenceDate);
  const in30Days = addDays(today, 30);

  let openCount = 0;
  let settledCount = 0;
  let totalBalanceReceivable = 0;
  let totalAmountReceived = 0;
  let totalAmountReceivable = 0;
  let overdueCount = 0;
  let overdueBalance = 0;
  let dueNext30DaysCount = 0;
  let dueNext30DaysBalance = 0;
  let lastSyncedAt: Date | null = null;

  for (const row of rows) {
    const balance = decimalToNumber(row.balanceReceivable);
    const received = decimalToNumber(row.amountReceived);
    const receivable = decimalToNumber(row.amountReceivable);
    totalAmountReceived += received;
    totalAmountReceivable += receivable;

    if (lastSyncedAt == null || row.syncedAt > lastSyncedAt) {
      lastSyncedAt = row.syncedAt;
    }

    if (isAccountsReceivableOpen(row)) {
      openCount += 1;
      totalBalanceReceivable += balance;

      if (row.dueDate) {
        const due = startOfDay(row.dueDate);
        if (due < today) {
          overdueCount += 1;
          overdueBalance += balance;
        } else if (due >= today && due <= in30Days) {
          dueNext30DaysCount += 1;
          dueNext30DaysBalance += balance;
        }
      }
    } else if (isAccountsReceivableSettled(row)) {
      settledCount += 1;
    }
  }

  return {
    totalRecords: rows.length,
    openCount,
    settledCount,
    totalBalanceReceivable,
    totalAmountReceived,
    totalAmountReceivable,
    overdueCount,
    overdueBalance,
    dueNext30DaysCount,
    dueNext30DaysBalance,
    lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
  };
}
