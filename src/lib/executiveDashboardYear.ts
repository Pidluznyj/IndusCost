/** Contexto de ano para o dashboard gerencial executivo. */

export const EXECUTIVE_DASHBOARD_MIN_YEAR = 2020;

export type ExecutiveDashboardYearContext = {
  selectedYear: number;
  previousYear: number;
  /** Data de referência para cards (mês/ano/YTD). */
  referenceDate: Date;
  isSelectedYearCurrent: boolean;
  /** Último mês com barra YTD no ano selecionado (1–12). */
  ytdMonthLimit: number;
};

export function parseExecutiveDashboardYear(
  yearParam: unknown,
  now: Date = new Date()
): number {
  const currentCalendarYear = now.getFullYear();
  if (yearParam == null || yearParam === "") {
    return currentCalendarYear;
  }
  const parsed = Number(yearParam);
  if (!Number.isInteger(parsed)) {
    return currentCalendarYear;
  }
  if (parsed < EXECUTIVE_DASHBOARD_MIN_YEAR || parsed > currentCalendarYear + 1) {
    return currentCalendarYear;
  }
  return parsed;
}

export function resolveExecutiveDashboardYearContext(
  yearParam: unknown,
  now: Date = new Date()
): ExecutiveDashboardYearContext {
  const selectedYear = parseExecutiveDashboardYear(yearParam, now);
  const previousYear = selectedYear - 1;
  const currentCalendarYear = now.getFullYear();
  const isSelectedYearCurrent = selectedYear === currentCalendarYear;

  const ytdMonthLimit = isSelectedYearCurrent ? now.getMonth() + 1 : 12;

  const referenceDate = isSelectedYearCurrent
    ? now
    : new Date(selectedYear, 11, 31, 23, 59, 59, 999);

  return {
    selectedYear,
    previousYear,
    referenceDate,
    isSelectedYearCurrent,
    ytdMonthLimit,
  };
}
