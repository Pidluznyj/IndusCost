/**
 * Utilitários puros do Relatório Presidencial.
 * Delegam regras compartilhadas aos módulos oficiais quando já existem.
 */
import {
  formatExecutiveCompactCurrency,
  formatExecutiveCurrency,
  formatExecutivePercent,
} from "./executiveDashboardFormatters.js";
import {
  computeAchievementPercent,
  computeDailyAverageByWorkday,
  computeMonthProjection,
} from "./salesOrderDashboardRules.js";

export { formatExecutiveCurrency, formatExecutiveCompactCurrency };

/** Alias semântico para o relatório presidencial. */
export const formatExecutiveReportCurrency = formatExecutiveCurrency;

export function formatExecutiveReportPercent(
  value: number | null,
  decimals: 1 | 2 = 1
): string {
  return formatExecutivePercent(value, decimals);
}

/** Variação percentual entre valor atual e base anterior. Retorna null se inválido. */
export function calculatePercentageChange(
  current: number | null,
  previous: number | null
): number | null {
  if (
    current == null ||
    previous == null ||
    !Number.isFinite(current) ||
    !Number.isFinite(previous)
  ) {
    return null;
  }
  if (previous === 0) return current > 0 ? 100 : current < 0 ? -100 : 0;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** % de atingimento da meta — delega à regra oficial (+20% / divisão por target). */
export function calculateTargetAchievement(
  actual: number | null,
  target: number | null
): number | null {
  return computeAchievementPercent(actual, target);
}

/** Média diária por dias úteis decorridos — delega à regra oficial. */
export function calculateDailyAverage(
  totalValue: number | null,
  workdaysElapsed: number
): number | null {
  return computeDailyAverageByWorkday(totalValue, workdaysElapsed);
}

/** Projeção linear do período — delega à regra oficial (média × dias úteis). */
export function calculateMonthProjection(
  dailyAverage: number | null,
  workdaysInPeriod: number
): number | null {
  return computeMonthProjection(dailyAverage, workdaysInPeriod);
}

/** Chave normalizada YYYY-MM para séries comparativas. */
export function normalizeExecutiveMonthKey(year: number, month: number): string {
  const y = Math.trunc(year);
  const m = Math.trunc(month);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    throw new RangeError(`normalizeExecutiveMonthKey: ano/mês inválidos (${year}, ${month})`);
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** Parse seguro de chave YYYY-MM. */
export function parseExecutiveMonthKey(key: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(key.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || month < 1 || month > 12) return null;
  return { year, month };
}

/** Rótulo de capa no padrão dos prints presidenciais: REPORT DD/MM/AAAA. */
export function formatExecutiveReportCoverDate(asOfDate: Date): string {
  const d = asOfDate.getDate().toString().padStart(2, "0");
  const m = (asOfDate.getMonth() + 1).toString().padStart(2, "0");
  const y = asOfDate.getFullYear();
  return `${d}/${m}/${y}`;
}

/** Título exibido no PDF e na capa do relatório executivo. */
export const EXECUTIVE_REPORT_DOCUMENT_TITLE =
  "Relatório Executivo Financeiro e Comercial";

/** Título de capa padronizado. */
export function buildExecutiveReportCoverTitle(asOfDate: Date): string {
  return `REPORT ${formatExecutiveReportCoverDate(asOfDate)}`;
}
