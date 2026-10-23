/**
 * Folga comercial de atraso. Não altera título, saldo nem vencimento do Nomus.
 *
 * O motor oficial de Contas a Receber continua classificando o CR como vencido
 * a partir de D+1. Esta camada só decide a elegibilidade comercial: D+1, D+2
 * e D+3 não bloqueiam por atraso; D+4 bloqueia se o título seguir elegível e
 * com saldo em aberto.
 *
 * O dia civil é America/Sao_Paulo. A virada é meia-noite nesse fuso, não a
 * meia-noite UTC do servidor.
 */

import type { FinanceArDashboardRow } from "@/src/lib/financeAccountsReceivableDashboard.js";

export const COMMERCIAL_DELINQUENCY_TOLERANCE_DAYS = 3;

export const COMMERCIAL_DELINQUENCY_TIMEZONE = "America/Sao_Paulo" as const;

const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

/** Data civil `YYYY-MM-DD` do instante em America/Sao_Paulo. */
export function commercialSaoPauloCivilDate(instant: Date): string | null {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) return null;
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: COMMERCIAL_DELINQUENCY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
  return CIVIL_DATE.test(formatted) ? formatted : null;
}

/**
 * Dias corridos de atraso comercial. Zero no dia do vencimento e antes dele.
 * Não regrava a data do título.
 */
export function commercialCalendarDaysOverdue(dueDate: Date | null, referenceDate: Date): number {
  if (!dueDate) return 0;
  const due = commercialSaoPauloCivilDate(dueDate);
  const reference = commercialSaoPauloCivilDate(referenceDate);
  if (!due || !reference) return 0;
  const dueMs = Date.parse(`${due}T00:00:00.000Z`);
  const referenceMs = Date.parse(`${reference}T00:00:00.000Z`);
  if (!Number.isFinite(dueMs) || !Number.isFinite(referenceMs)) return 0;
  const days = Math.floor((referenceMs - dueMs) / MS_PER_DAY);
  return days > 0 ? days : 0;
}

/** Mantém só os CRs oficiais já vencidos que passaram da folga comercial. */
export function applyCommercialDelinquencyCalendarTolerance(
  officialOverdue: readonly FinanceArDashboardRow[],
  referenceDate: Date
): FinanceArDashboardRow[] {
  return officialOverdue.filter(
    (row) => commercialCalendarDaysOverdue(row.dueDate, referenceDate) > COMMERCIAL_DELINQUENCY_TOLERANCE_DAYS
  );
}
