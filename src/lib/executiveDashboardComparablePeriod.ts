/**
 * Referência temporal comparável no ano anterior (puro, sem backend).
 *
 * Mesmo dia da referência atual, clampado ao ÚLTIMO DIA REAL do mês no ano
 * anterior (fevereiro, meses de 30/31 dias, ano bissexto). Nunca assume dia 28.
 */
export function resolveComparablePreviousYearReference(
  referenceDate: Date,
  previousYear: number,
  metricMonth: number
): Date {
  const lastDayOfPreviousYearMonth = new Date(previousYear, metricMonth, 0).getDate();
  const day = Math.min(referenceDate.getDate(), lastDayOfPreviousYearMonth);
  return new Date(previousYear, metricMonth - 1, day, 23, 59, 59, 999);
}
