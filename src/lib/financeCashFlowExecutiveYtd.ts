import {
  classifyFinanceArTitle,
  isFinanceArOpen,
  roundMoney,
  startOfLocalDay,
} from "./financeAccountsReceivableDashboard.js";
import {
  classifyFinanceApTitle,
  isFinanceApOpen,
} from "./financeAccountsPayableDashboard.js";
import { formatFinanceCurrency } from "./financeAccountsReceivableFormat.js";
import type {
  FinanceCashFlowApRow,
  FinanceCashFlowArRow,
  FinanceCashFlowDashboardFilters,
} from "./financeCashFlowDashboard.js";
import type { FinanceCashFlowMonthlyPoint } from "./financeCashFlowDashboardTypes.js";
import { buildNetCashPositionMetrics } from "./financeCashFlowIntelligence.js";

export type FinanceCashFlowYtdTrendDirection = "improving" | "worsening" | "stable";

export type FinanceCashFlowExecutiveYtdTrendPoint = {
  month: string;
  monthLabel: string;
  inflow: number | null;
  outflow: number | null;
  net: number | null;
  accumulated: number | null;
  status: "positive" | "negative" | "neutral";
};

export type FinanceCashFlowExecutiveYtd = {
  year: number;
  startDate: string;
  endDate: string;
  scopeLabel: string;
  isCurrentYear: boolean;
  totalReceivableOpen: number;
  totalPayableOpen: number;
  netCashPosition: number;
  cashNeedAmount: number;
  cashSurplusAmount: number;
  cashCoverageRatio: number | null;
  overdueReceivableAmount: number;
  overduePayableAmount: number;
  overdueCashImpact: number;
  negativeMonthsCount: number;
  trend: {
    direction: FinanceCashFlowYtdTrendDirection;
    label: string;
    monthlyNetSeries: FinanceCashFlowExecutiveYtdTrendPoint[];
  };
};

export function resolveYtdDateRange(
  year: number,
  referenceDate: Date
): {
  startDate: Date;
  endDate: Date;
  isCurrentYear: boolean;
  scopeLabel: string;
} {
  const startDate = startOfLocalDay(new Date(year, 0, 1));
  const refYear = referenceDate.getFullYear();
  const isCurrentYear = year === refYear;
  const endDate = isCurrentYear
    ? startOfLocalDay(referenceDate)
    : startOfLocalDay(new Date(year, 11, 31));

  const fmt = (d: Date) => d.toLocaleDateString("pt-BR");
  const scopeLabel = isCurrentYear
    ? `YTD ${year} · ${fmt(startDate)} até hoje`
    : `Ano fechado ${year} · ${fmt(startDate)} até ${fmt(endDate)}`;

  return { startDate, endDate, isCurrentYear, scopeLabel };
}

export function buildYtdDashboardFilters(
  filters: FinanceCashFlowDashboardFilters,
  referenceDate: Date
): FinanceCashFlowDashboardFilters {
  const year = filters.year ?? referenceDate.getFullYear();
  return { ...filters, year, month: undefined };
}

function mapMonthlyToYtdTrend(
  points: FinanceCashFlowMonthlyPoint[],
  endMonth: number
): FinanceCashFlowExecutiveYtdTrendPoint[] {
  return points
    .filter((p) => p.month <= endMonth)
    .map((p) => {
      const net = p.netFlowAmount;
      let status: "positive" | "negative" | "neutral" = "neutral";
      if (net != null) {
        if (net > 0) status = "positive";
        else if (net < 0) status = "negative";
      }
      return {
        month: String(p.month),
        monthLabel: p.monthLabel,
        inflow: p.inflowAmount,
        outflow: p.outflowAmount,
        net,
        accumulated: p.accumulatedBalance,
        status,
      };
    });
}

export function resolveYtdTrendDirection(
  series: FinanceCashFlowExecutiveYtdTrendPoint[]
): { direction: FinanceCashFlowYtdTrendDirection; label: string } {
  const valid = series.filter((p) => p.accumulated != null && p.net != null);
  if (valid.length < 4) {
    return { direction: "stable", label: "Dados insuficientes" };
  }
  const last = valid[valid.length - 1]!;
  const threeBack = valid[valid.length - 4]!;
  const delta = roundMoney((last.accumulated ?? 0) - (threeBack.accumulated ?? 0));
  if (delta > 0) return { direction: "improving", label: "Tendência melhorando" };
  if (delta < 0) return { direction: "worsening", label: "Tendência piorando" };
  return { direction: "stable", label: "Tendência estável" };
}

function countNegativeMonths(series: FinanceCashFlowExecutiveYtdTrendPoint[]): number {
  return series.filter((p) => p.net != null && p.net < 0).length;
}

export function buildFinanceCashFlowExecutiveYtd(
  arRows: FinanceCashFlowArRow[],
  apRows: FinanceCashFlowApRow[],
  monthlySeries: FinanceCashFlowMonthlyPoint[],
  filters: FinanceCashFlowDashboardFilters,
  referenceDate: Date
): FinanceCashFlowExecutiveYtd {
  const ytdFilters = buildYtdDashboardFilters(filters, referenceDate);
  const year = ytdFilters.year!;
  const { startDate, endDate, isCurrentYear, scopeLabel } = resolveYtdDateRange(
    year,
    referenceDate
  );
  const endMonth = isCurrentYear ? referenceDate.getMonth() + 1 : 12;

  const monthlyNetSeries = mapMonthlyToYtdTrend(monthlySeries, endMonth);
  const trendMeta = resolveYtdTrendDirection(monthlyNetSeries);

  let totalReceivableOpen = 0;
  let totalPayableOpen = 0;
  let overdueReceivable = 0;
  let overduePayable = 0;

  for (const row of arRows) {
    if (isFinanceArOpen(row)) {
      totalReceivableOpen += row.balanceReceivable;
      if (classifyFinanceArTitle(row, referenceDate) === "overdue") {
        overdueReceivable += row.balanceReceivable;
      }
    }
  }

  for (const row of apRows) {
    if (isFinanceApOpen(row)) {
      totalPayableOpen += row.balancePayable;
      if (classifyFinanceApTitle(row, referenceDate) === "overdue") {
        overduePayable += row.balancePayable;
      }
    }
  }

  const receivable = roundMoney(totalReceivableOpen);
  const payable = roundMoney(totalPayableOpen);
  const net = buildNetCashPositionMetrics(receivable, payable);

  return {
    year,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    scopeLabel,
    isCurrentYear,
    totalReceivableOpen: receivable,
    totalPayableOpen: payable,
    netCashPosition: net.netCashPosition,
    cashNeedAmount: net.cashNeedAmount,
    cashSurplusAmount: net.netCashPositionStatus === "surplus" ? net.netCashPositionAbs : 0,
    cashCoverageRatio: net.cashCoverageRatio,
    overdueReceivableAmount: roundMoney(overdueReceivable),
    overduePayableAmount: roundMoney(overduePayable),
    overdueCashImpact: roundMoney(overdueReceivable + overduePayable),
    negativeMonthsCount: countNegativeMonths(monthlyNetSeries),
    trend: {
      direction: trendMeta.direction,
      label: trendMeta.label,
      monthlyNetSeries,
    },
  };
}

export function buildCashFlowExecutiveYtdReading(
  executiveYtd: FinanceCashFlowExecutiveYtd
): string[] {
  const lines: string[] = [];
  const { trend } = executiveYtd;

  if (executiveYtd.netCashPosition < 0) {
    lines.push(
      `No acumulado do ano, a carteira projetada indica déficit de ${formatFinanceCurrency(executiveYtd.cashNeedAmount)}.`
    );
  } else {
    lines.push(
      `No acumulado do ano, a carteira projetada indica folga de ${formatFinanceCurrency(executiveYtd.cashSurplusAmount)}.`
    );
  }

  if (executiveYtd.overdueReceivableAmount > 0) {
    lines.push(
      `No acumulado do ano, há ${formatFinanceCurrency(executiveYtd.overdueReceivableAmount)} vencidos a receber.`
    );
  }

  if (executiveYtd.overduePayableAmount > 0) {
    lines.push(
      `Há ${formatFinanceCurrency(executiveYtd.overduePayableAmount)} em pagamentos vencidos pressionando o caixa.`
    );
  }

  if (executiveYtd.negativeMonthsCount > 0) {
    const n = executiveYtd.negativeMonthsCount;
    lines.push(
      `O caixa apresenta ${n} ${n === 1 ? "mês" : "meses"} com fluxo líquido negativo no ano.`
    );
  }

  if (trend.label === "Dados insuficientes") {
    lines.push("A tendência dos últimos meses ainda não pode ser calculada com segurança.");
  } else if (trend.direction === "improving") {
    lines.push("A tendência dos últimos meses está melhorando no saldo acumulado.");
  } else if (trend.direction === "worsening") {
    lines.push("A tendência dos últimos meses está piorando no saldo acumulado.");
  } else {
    lines.push("A tendência dos últimos meses está estável no saldo acumulado.");
  }

  return lines;
}

export function executiveYtdMetricsAreFinite(ytd: FinanceCashFlowExecutiveYtd): boolean {
  const nums = [
    ytd.totalReceivableOpen,
    ytd.totalPayableOpen,
    ytd.netCashPosition,
    ytd.cashNeedAmount,
    ytd.cashSurplusAmount,
    ytd.overdueReceivableAmount,
    ytd.overduePayableAmount,
    ytd.overdueCashImpact,
    ytd.negativeMonthsCount,
  ];
  if (!nums.every((n) => Number.isFinite(n))) return false;
  if (ytd.cashCoverageRatio != null && !Number.isFinite(ytd.cashCoverageRatio)) return false;
  for (const p of ytd.trend.monthlyNetSeries) {
    for (const v of [p.inflow, p.outflow, p.net, p.accumulated]) {
      if (v != null && !Number.isFinite(v)) return false;
    }
  }
  return true;
}
