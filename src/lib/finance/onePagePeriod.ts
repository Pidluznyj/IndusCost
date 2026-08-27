/**
 * Regra temporal do Financeiro > One Page (pura, sem backend).
 *
 * Referência temporal por modo/ano/mês — sem truncar dia 29/30/31:
 * - ano atual + mês atual  → referência = agora;
 * - ano atual + mês passado → último dia REAL do mês selecionado;
 * - ano passado (com mês)  → último dia REAL do mês selecionado;
 * - visão anual (sem mês), ano atual  → agora;
 * - visão anual (sem mês), ano passado → 31/12 do ano.
 *
 * O yearCtx resultante alimenta os MESMOS motores canônicos das telas oficiais
 * (Faturamento NF-e e Pedidos de Venda) — o One Page não recalcula nada.
 */
import {
  resolveExecutiveDashboardYearContext,
  type ExecutiveDashboardYearContext,
} from "../executiveDashboardYear.js";

export type OnePagePeriodMode = "ytd" | "month";

export type OnePagePeriod = {
  mode: OnePagePeriodMode;
  selectedYear: number;
  previousYear: number;
  /** Mês 1–12 dos KPIs mensais (no modo YTD, o mês da própria referência). */
  metricMonth: number;
  referenceDate: Date;
  /** Contexto pronto para os motores canônicos (referência + ytdMonthLimit coerentes). */
  yearCtx: ExecutiveDashboardYearContext;
  /**
   * População da margem comercial (issueDate, inclusive):
   * - modo mês → mês selecionado completo;
   * - modo YTD → 01/01 até a referência (ano passado: ano completo).
   */
  marginRange: { start: Date; end: Date };
  marginPeriodLabel: string;
};

export function lastDayOfMonth(year: number, month1to12: number): number {
  return new Date(year, month1to12, 0).getDate();
}

export function parseOnePageMonth(monthParam: unknown): number | null {
  if (monthParam == null || monthParam === "") return null;
  const m = Number(monthParam);
  return Number.isInteger(m) && m >= 1 && m <= 12 ? m : null;
}

const MONTH_SHORT_PT = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
];

export function resolveOnePagePeriod(
  yearParam: unknown,
  monthParam?: unknown,
  now: Date = new Date()
): OnePagePeriod {
  const base = resolveExecutiveDashboardYearContext(yearParam, now);
  const requestedMonth = parseOnePageMonth(monthParam);

  if (requestedMonth == null) {
    // Modo YTD — contexto idêntico ao das telas oficiais (sem mutação).
    const metricMonth = base.referenceDate.getMonth() + 1;
    return {
      mode: "ytd",
      selectedYear: base.selectedYear,
      previousYear: base.previousYear,
      metricMonth,
      referenceDate: base.referenceDate,
      yearCtx: base,
      marginRange: {
        start: new Date(base.selectedYear, 0, 1, 0, 0, 0, 0),
        end: base.referenceDate,
      },
      marginPeriodLabel: `Jan–${MONTH_SHORT_PT[metricMonth - 1]}/${base.selectedYear} (YTD)`,
    };
  }

  const currentMonth = now.getMonth() + 1;
  let metricMonth = requestedMonth;
  if (base.isSelectedYearCurrent && metricMonth > currentMonth) {
    metricMonth = currentMonth;
  }

  const isOpenCurrentMonth = base.isSelectedYearCurrent && metricMonth === currentMonth;
  const referenceDate = isOpenCurrentMonth
    ? now
    : new Date(
        base.selectedYear,
        metricMonth - 1,
        lastDayOfMonth(base.selectedYear, metricMonth),
        23,
        59,
        59,
        999
      );

  const yearCtx: ExecutiveDashboardYearContext = {
    ...base,
    referenceDate,
    ytdMonthLimit: metricMonth,
  };

  return {
    mode: "month",
    selectedYear: base.selectedYear,
    previousYear: base.previousYear,
    metricMonth,
    referenceDate,
    yearCtx,
    marginRange: {
      start: new Date(base.selectedYear, metricMonth - 1, 1, 0, 0, 0, 0),
      end: new Date(
        base.selectedYear,
        metricMonth - 1,
        lastDayOfMonth(base.selectedYear, metricMonth),
        23,
        59,
        59,
        999
      ),
    },
    marginPeriodLabel: `${MONTH_SHORT_PT[metricMonth - 1]}/${base.selectedYear}`,
  };
}
