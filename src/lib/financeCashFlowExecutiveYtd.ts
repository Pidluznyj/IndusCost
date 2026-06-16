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
import {
  isFinanceApCancelledTitle,
  resolveFinanceApOpenAmount,
  resolveFinanceApRealizedAmount,
} from "./financeAccountsPayableRules.js";
import { formatFinanceCurrency } from "./financeAccountsReceivableFormat.js";
import {
  filterFinanceArRows,
  type FinanceArDashboardFilters,
} from "./financeAccountsReceivableDashboard.js";
import type {
  FinanceCashFlowApRow,
  FinanceCashFlowArRow,
  FinanceCashFlowDashboardFilters,
} from "./financeCashFlowDashboard.js";
import type { FinanceCashFlowMonthlyPoint } from "./financeCashFlowDashboardTypes.js";
import { buildNetCashPositionMetrics } from "./financeCashFlowIntelligence.js";

export type FinanceCashFlowYtdTrendDirection = "improving" | "worsening" | "stable";

export type FinanceCashFlowYtdReceivedDirection = "up" | "down" | "stable" | "no_previous";

export type FinanceCashFlowExecutiveYtdReceivableTotals = {
  /** Soma amountReceivable da carteira YTD (vencimento no ano, saneada). */
  totalAmount: number;
  /** Soma amountReceived dos títulos da carteira YTD — distinto de Recebido YTD por liquidação. */
  receivedAmount: number;
  /** Soma balanceReceivable da carteira YTD. */
  openAmount: number;
};

export type FinanceCashFlowExecutiveYtdPayableTotals = {
  /** Soma amountPayable da carteira YTD (vencimento no ano, saneada). */
  totalAmount: number;
  /** Soma amountPaid dos títulos da carteira YTD. */
  paidAmount: number;
  /** Soma balancePayable da carteira YTD. */
  openAmount: number;
};

export type FinanceCashFlowExecutiveYtdTotals = {
  receivable: FinanceCashFlowExecutiveYtdReceivableTotals;
  payable: FinanceCashFlowExecutiveYtdPayableTotals;
};

export type FinanceCashFlowExecutiveYtdReceived = {
  currentAmount: number;
  previousAmount: number;
  previousYear: number;
  deltaAmount: number;
  deltaPercent: number | null;
  direction: FinanceCashFlowYtdReceivedDirection;
  currentPeriodLabel: string;
  previousPeriodLabel: string;
  comparisonLabel: string;
};

export type FinanceCashFlowExecutiveYtdTrendPoint = {
  month: string;
  monthLabel: string;
  inflow: number | null;
  outflow: number | null;
  net: number | null;
  accumulated: number | null;
  status: "positive" | "negative" | "neutral";
  receivedInMonth: number | null;
  receivedAccumulated: number | null;
  previousYearReceivedAccumulated: number | null;
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
  received: FinanceCashFlowExecutiveYtdReceived;
  /** Totais consolidados da carteira AR/AP YTD (Power BI — distinto de caixa por liquidação). */
  totals: FinanceCashFlowExecutiveYtdTotals;
  trend: {
    direction: FinanceCashFlowYtdTrendDirection;
    label: string;
    monthlyNetSeries: FinanceCashFlowExecutiveYtdTrendPoint[];
  };
};

const RECEIVED_DELTA_STABLE_EPSILON = 0.01;

function formatPtBrDate(d: Date): string {
  return d.toLocaleDateString("pt-BR");
}

export function resolvePreviousYtdComparableRange(
  year: number,
  referenceDate: Date
): { startDate: Date; endDate: Date; previousYear: number } {
  const previousYear = year - 1;
  const { isCurrentYear } = resolveYtdDateRange(year, referenceDate);
  const prevStart = startOfLocalDay(new Date(previousYear, 0, 1));
  const prevEnd = isCurrentYear
    ? startOfLocalDay(
        new Date(previousYear, referenceDate.getMonth(), referenceDate.getDate())
      )
    : startOfLocalDay(new Date(previousYear, 11, 31));
  return { startDate: prevStart, endDate: prevEnd, previousYear };
}

function toReceivedArLoadFilters(
  filters: FinanceCashFlowDashboardFilters
): FinanceArDashboardFilters {
  const status =
    filters.status === "open"
      ? "open"
      : filters.status === "settled"
        ? "settled"
        : filters.status === "overdue"
          ? "overdue"
          : "all";
  return {
    companyName: filters.companyName,
    personName: filters.customerName,
    personCnpj: filters.personCnpj,
    status,
    paymentMethodName: filters.paymentMethodName,
    bankAccountName: filters.bankAccountName,
    invoiceIssued: filters.invoiceIssued,
  };
}

export function filterArRowsForYtdReceived(
  rows: FinanceCashFlowArRow[],
  filters: FinanceCashFlowDashboardFilters,
  referenceDate: Date
): FinanceCashFlowArRow[] {
  const arFilters = toReceivedArLoadFilters(filters);
  return filterFinanceArRows(rows, arFilters, referenceDate) as FinanceCashFlowArRow[];
}

export function isArReceivedInPeriod(
  row: FinanceCashFlowArRow,
  startDate: Date,
  endDate: Date
): boolean {
  // Fluxo de Caixa planejado aloca entradas/saídas pelo vencimento (dueDate),
  // mantendo settlementDate apenas como auditoria operacional.
  if (row.amountReceived <= 0 || row.dueDate == null) return false;
  const due = startOfLocalDay(row.dueDate).getTime();
  const start = startOfLocalDay(startDate).getTime();
  const end = startOfLocalDay(endDate).getTime();
  return due >= start && due <= end;
}

export function sumArReceivedInPeriod(
  rows: FinanceCashFlowArRow[],
  startDate: Date,
  endDate: Date
): number {
  let total = 0;
  for (const row of rows) {
    if (!isArReceivedInPeriod(row, startDate, endDate)) continue;
    total += row.amountReceived;
  }
  return roundMoney(total);
}

function monthPeriodEnd(year: number, month: number, capDate: Date | null): Date {
  if (
    capDate &&
    capDate.getFullYear() === year &&
    capDate.getMonth() + 1 === month
  ) {
    return startOfLocalDay(capDate);
  }
  return startOfLocalDay(new Date(year, month, 0));
}

export function resolveReceivedComparisonDirection(
  currentAmount: number,
  previousAmount: number,
  deltaAmount: number
): FinanceCashFlowYtdReceivedDirection {
  if (previousAmount === 0) {
    if (currentAmount > 0) return "no_previous";
    return "stable";
  }
  if (Math.abs(deltaAmount) < RECEIVED_DELTA_STABLE_EPSILON) return "stable";
  if (deltaAmount > 0) return "up";
  if (deltaAmount < 0) return "down";
  return "stable";
}

export function buildYtdReceivedComparison(
  rows: FinanceCashFlowArRow[],
  filters: FinanceCashFlowDashboardFilters,
  referenceDate: Date
): FinanceCashFlowExecutiveYtdReceived {
  const ytdFilters = buildYtdDashboardFilters(filters, referenceDate);
  const year = ytdFilters.year!;
  const { startDate, endDate } = resolveYtdDateRange(year, referenceDate);
  const { startDate: prevStart, endDate: prevEnd, previousYear } =
    resolvePreviousYtdComparableRange(year, referenceDate);

  const filteredRows = filterArRowsForYtdReceived(rows, ytdFilters, referenceDate);
  const currentAmount = sumArReceivedInPeriod(filteredRows, startDate, endDate);
  const previousAmount = sumArReceivedInPeriod(filteredRows, prevStart, prevEnd);
  const deltaAmount = roundMoney(currentAmount - previousAmount);
  const deltaPercent =
    previousAmount > 0 ? roundMoney((deltaAmount / previousAmount) * 100) : null;
  const direction = resolveReceivedComparisonDirection(
    currentAmount,
    previousAmount,
    deltaAmount
  );

  const currentPeriodLabel = `${formatPtBrDate(startDate)} até ${formatPtBrDate(endDate)}`;
  const previousPeriodLabel = `Mesmo período ${previousYear}: ${formatPtBrDate(prevStart)} até ${formatPtBrDate(prevEnd)}`;

  return {
    currentAmount,
    previousAmount,
    previousYear,
    deltaAmount,
    deltaPercent,
    direction,
    currentPeriodLabel,
    previousPeriodLabel,
    comparisonLabel: `vs mesmo período ${previousYear}`,
  };
}

function buildReceivedMonthlyAccumulated(
  rows: FinanceCashFlowArRow[],
  seriesYear: number,
  endMonth: number,
  capDate: Date | null
): Map<number, { monthAmount: number; accumulated: number }> {
  const byMonth = new Map<number, { monthAmount: number; accumulated: number }>();
  let accumulated = 0;
  for (let m = 1; m <= endMonth; m += 1) {
    const monthStart = startOfLocalDay(new Date(seriesYear, m - 1, 1));
    const monthEnd = monthPeriodEnd(seriesYear, m, capDate);
    const monthAmount = sumArReceivedInPeriod(rows, monthStart, monthEnd);
    accumulated = roundMoney(accumulated + monthAmount);
    byMonth.set(m, { monthAmount, accumulated });
  }
  return byMonth;
}

function enrichTrendWithReceived(
  points: FinanceCashFlowExecutiveYtdTrendPoint[],
  arRows: FinanceCashFlowArRow[],
  filters: FinanceCashFlowDashboardFilters,
  referenceDate: Date
): FinanceCashFlowExecutiveYtdTrendPoint[] {
  const ytdFilters = buildYtdDashboardFilters(filters, referenceDate);
  const year = ytdFilters.year!;
  const { endDate, isCurrentYear } = resolveYtdDateRange(year, referenceDate);
  const endMonth = isCurrentYear ? referenceDate.getMonth() + 1 : 12;
  const capDate = isCurrentYear ? endDate : null;
  const previousYear = year - 1;

  const filteredRows = filterArRowsForYtdReceived(arRows, ytdFilters, referenceDate);
  const currentByMonth = buildReceivedMonthlyAccumulated(
    filteredRows,
    year,
    endMonth,
    capDate
  );
  const prevCap =
    isCurrentYear && capDate
      ? startOfLocalDay(
          new Date(previousYear, capDate.getMonth(), capDate.getDate())
        )
      : null;
  const previousByMonth = buildReceivedMonthlyAccumulated(
    filteredRows,
    previousYear,
    endMonth,
    prevCap
  );

  return points.map((p) => {
    const m = Number(p.month);
    const current = currentByMonth.get(m);
    const previous = previousByMonth.get(m);
    return {
      ...p,
      receivedInMonth: current?.monthAmount ?? null,
      receivedAccumulated: current?.accumulated ?? null,
      previousYearReceivedAccumulated: previous?.accumulated ?? null,
    };
  });
}

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
        receivedInMonth: null,
        receivedAccumulated: null,
        previousYearReceivedAccumulated: null,
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

/** Totais da carteira YTD a partir de linhas já filtradas (ano YTD, saneamento, sem mês). */
export function buildExecutiveYtdCarteiraTotals(
  arRows: FinanceCashFlowArRow[],
  apRows: FinanceCashFlowApRow[]
): FinanceCashFlowExecutiveYtdTotals {
  let arTotal = 0;
  let arReceived = 0;
  let arOpen = 0;
  for (const row of arRows) {
    arTotal += row.amountReceivable > 0 ? row.amountReceivable : 0;
    arReceived += row.amountReceived > 0 ? row.amountReceived : 0;
    arOpen += row.balanceReceivable > 0 ? row.balanceReceivable : 0;
  }

  let apTotal = 0;
  let apPaid = 0;
  let apOpen = 0;
  for (const row of apRows) {
    if (isFinanceApCancelledTitle(row)) continue;
    apTotal += row.amountPayable > 0 ? row.amountPayable : 0;
    apPaid += resolveFinanceApRealizedAmount(row);
    apOpen += resolveFinanceApOpenAmount(row);
  }

  return {
    receivable: {
      totalAmount: roundMoney(arTotal),
      receivedAmount: roundMoney(arReceived),
      openAmount: roundMoney(arOpen),
    },
    payable: {
      totalAmount: roundMoney(apTotal),
      paidAmount: roundMoney(apPaid),
      openAmount: roundMoney(apOpen),
    },
  };
}

export function buildFinanceCashFlowExecutiveYtd(
  arRows: FinanceCashFlowArRow[],
  apRows: FinanceCashFlowApRow[],
  monthlySeries: FinanceCashFlowMonthlyPoint[],
  allArRows: FinanceCashFlowArRow[],
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

  const monthlyNetSeries = enrichTrendWithReceived(
    mapMonthlyToYtdTrend(monthlySeries, endMonth),
    allArRows,
    filters,
    referenceDate
  );
  const trendMeta = resolveYtdTrendDirection(monthlyNetSeries);
  const received = buildYtdReceivedComparison(allArRows, filters, referenceDate);

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
    if (isFinanceApCancelledTitle(row)) continue;
    if (isFinanceApOpen(row)) {
      const openAmount = resolveFinanceApOpenAmount(row);
      totalPayableOpen += openAmount;
      if (classifyFinanceApTitle(row, referenceDate) === "overdue") {
        overduePayable += openAmount;
      }
    }
  }

  const receivable = roundMoney(totalReceivableOpen);
  const payable = roundMoney(totalPayableOpen);
  const net = buildNetCashPositionMetrics(receivable, payable);
  const totals = buildExecutiveYtdCarteiraTotals(arRows, apRows);

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
    received,
    totals,
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

  const { totals } = executiveYtd;

  if (executiveYtd.netCashPosition < 0) {
    lines.push(
      `No acumulado do ano, a carteira projetada indica déficit de ${formatFinanceCurrency(executiveYtd.cashNeedAmount)}.`
    );
  } else {
    lines.push(
      `No acumulado do ano, a carteira projetada indica folga de ${formatFinanceCurrency(executiveYtd.cashSurplusAmount)}.`
    );
  }

  if (totals.receivable.totalAmount > 0 || totals.receivable.openAmount > 0) {
    lines.push(
      `No YTD, a carteira soma ${formatFinanceCurrency(totals.receivable.totalAmount)} a receber, com ${formatFinanceCurrency(totals.receivable.openAmount)} ainda em aberto.`
    );
  }

  if (totals.payable.totalAmount > 0 || totals.payable.openAmount > 0) {
    lines.push(
      `No YTD, as obrigações somam ${formatFinanceCurrency(totals.payable.totalAmount)} a pagar, com ${formatFinanceCurrency(totals.payable.openAmount)} ainda em aberto.`
    );
  }

  const openNet = roundMoney(totals.receivable.openAmount - totals.payable.openAmount);
  if (openNet !== 0 && (totals.receivable.openAmount > 0 || totals.payable.openAmount > 0)) {
    if (openNet < 0) {
      lines.push(
        `O saldo aberto líquido da carteira YTD indica déficit de ${formatFinanceCurrency(Math.abs(openNet))}.`
      );
    } else {
      lines.push(
        `O saldo aberto líquido da carteira YTD indica superávit de ${formatFinanceCurrency(openNet)}.`
      );
    }
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

  const { received } = executiveYtd;
  if (received.direction === "no_previous") {
    lines.push(
      "Não há base suficiente de recebido no ano anterior para comparação YTD."
    );
  } else if (received.direction === "up" && received.deltaPercent != null) {
    lines.push(
      `Recebido YTD está ${formatFinanceCurrency(received.deltaAmount)} acima do mesmo período de ${received.previousYear} (+${Math.abs(received.deltaPercent).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%).`
    );
  } else if (received.direction === "down" && received.deltaPercent != null) {
    lines.push(
      `Recebido YTD está ${formatFinanceCurrency(Math.abs(received.deltaAmount))} abaixo do mesmo período de ${received.previousYear} (${received.deltaPercent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%).`
    );
  } else if (received.direction === "stable" && received.previousAmount > 0) {
    lines.push(
      `Recebido YTD está estável em relação ao mesmo período de ${received.previousYear}.`
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

  return lines.slice(0, 6);
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
    ytd.received.currentAmount,
    ytd.received.previousAmount,
    ytd.received.deltaAmount,
    ytd.totals.receivable.totalAmount,
    ytd.totals.receivable.receivedAmount,
    ytd.totals.receivable.openAmount,
    ytd.totals.payable.totalAmount,
    ytd.totals.payable.paidAmount,
    ytd.totals.payable.openAmount,
  ];
  if (!nums.every((n) => Number.isFinite(n))) return false;
  if (ytd.cashCoverageRatio != null && !Number.isFinite(ytd.cashCoverageRatio)) return false;
  if (
    ytd.received.deltaPercent != null &&
    !Number.isFinite(ytd.received.deltaPercent)
  ) {
    return false;
  }
  for (const p of ytd.trend.monthlyNetSeries) {
    for (const v of [
      p.inflow,
      p.outflow,
      p.net,
      p.accumulated,
      p.receivedInMonth,
      p.receivedAccumulated,
      p.previousYearReceivedAccumulated,
    ]) {
      if (v != null && !Number.isFinite(v)) return false;
    }
  }
  return true;
}
