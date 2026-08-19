import {
  classifyFinanceArTitle,
  isFinanceArOpen,
  roundMoney,
} from "./financeAccountsReceivableDashboard.js";
import { isFinanceApOpen } from "./financeAccountsPayableDashboard.js";
import { formatFinanceCurrency } from "./financeAccountsReceivableFormat.js";
import type {
  FinanceCashFlowArRow,
  FinanceCashFlowApRow,
  FinanceCashFlowDashboardFilters,
} from "./financeCashFlowDashboard.js";
import type {
  FinanceCashFlowCriticalMovement,
  FinanceCashFlowDashboardCards,
  FinanceCashFlowMonthlyNetStatus,
  FinanceCashFlowPartySummary,
} from "./financeCashFlowDashboardTypes.js";
import { resolveMonthlyNetStatus } from "./financeCashFlowIntelligence.js";
import {
  cashFlowViewModeSlices,
  resolveCashFlowArAmount,
  resolveCashFlowApAmount,
  resolveCashFlowArMovementDate,
  resolveCashFlowApMovementDate,
  shouldIncludeCashFlowArMovement,
  shouldIncludeCashFlowApMovement,
} from "./financeCashFlowLedger.js";

const MONTH_LABELS = [
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
] as const;

export const CONSERVATIVE_OPEN_RECEIVABLE_FACTOR = 0.8;
export const CONSERVATIVE_OVERDUE_RECEIVABLE_FACTOR = 0.5;
export const STRESS_OPEN_RECEIVABLE_FACTOR = 0.6;
export const STRESS_OVERDUE_RECEIVABLE_FACTOR = 0.3;

export type FinanceCashFlowForecastMonthRef = {
  year: number;
  month: number;
  monthLabel: string;
  projectedNet: number;
};

export type FinanceCashFlowForecastMonthPoint = {
  year: number;
  month: number;
  monthLabel: string;
  projectedInflow: number | null;
  projectedOutflow: number | null;
  projectedNet: number | null;
  projectedAccumulated: number | null;
  status: FinanceCashFlowMonthlyNetStatus | null;
};

export type FinanceCashFlowForecastHorizonSummary = {
  horizonLabel: string;
  monthCount: number;
  projectedInflow: number;
  projectedOutflow: number;
  projectedNet: number;
  projectedAccumulated: number;
  worstMonth: FinanceCashFlowForecastMonthRef | null;
  bestMonth: FinanceCashFlowForecastMonthRef | null;
  negativeMonthsCount: number;
  firstNegativeMonth: FinanceCashFlowForecastMonthRef | null;
  maxCashNeed: number;
  maxCashSurplus: number;
};

export type FinanceCashFlowCashForecast = {
  monthlyPoints: FinanceCashFlowForecastMonthPoint[];
  horizons: {
    currentMonth: FinanceCashFlowForecastHorizonSummary;
    next3Months: FinanceCashFlowForecastHorizonSummary;
    next6Months: FinanceCashFlowForecastHorizonSummary;
    next12Months: FinanceCashFlowForecastHorizonSummary;
  };
};

export type FinanceCashFlowConservativeScenario = {
  disclaimer: string;
  assumptions: string[];
  projectedInflowConservative: number;
  projectedOutflow: number;
  projectedNetConservative: number;
  cashNeedConservative: number;
  deltaVsBase: number;
  monthlyPoints: FinanceCashFlowForecastMonthPoint[];
};

export type FinanceCashFlowStressScenario = {
  disclaimer: string;
  assumptions: string[];
  projectedInflowStress: number;
  projectedOutflowStress: number;
  projectedNetStress: number;
  cashNeedStress: number;
  monthsAtRiskStress: number;
  monthlyPoints: FinanceCashFlowForecastMonthPoint[];
};

export type FinanceCashFlowScenarioChartPoint = {
  name: string;
  year: number;
  month: number;
  base: number | null;
  conservative: number | null;
  stress: number | null;
};

type MonthBucket = { inflow: number; outflow: number };

type InflowFactorFn = (row: FinanceCashFlowArRow, referenceDate: Date) => number;

function addCalendarMonths(year: number, month: number, offset: number): { year: number; month: number } {
  const d = new Date(year, month - 1 + offset, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function monthLabel(year: number, month: number): string {
  return `${MONTH_LABELS[month - 1]}/${String(year).slice(-2)}`;
}

function isFutureCalendarMonth(
  year: number,
  month: number,
  refYear: number,
  refMonth: number
): boolean {
  if (year > refYear) return true;
  if (year < refYear) return false;
  return month > refMonth;
}

function emptyForwardBuckets(referenceDate: Date): Map<string, MonthBucket> {
  const buckets = new Map<string, MonthBucket>();
  const refYm = { year: referenceDate.getFullYear(), month: referenceDate.getMonth() + 1 };
  for (let i = 0; i < 12; i += 1) {
    const ym = addCalendarMonths(refYm.year, refYm.month, i);
    buckets.set(`${ym.year}-${ym.month}`, { inflow: 0, outflow: 0 });
  }
  return buckets;
}

function buildForwardBuckets(
  arRows: FinanceCashFlowArRow[],
  apRows: FinanceCashFlowApRow[],
  filters: FinanceCashFlowDashboardFilters,
  referenceDate: Date,
  inflowFactor: InflowFactorFn = () => 1
): Map<string, MonthBucket> {
  return buildForwardBucketsForFactors(arRows, apRows, filters, referenceDate, [inflowFactor])[0]!;
}

function buildForwardBucketsForFactors(
  arRows: FinanceCashFlowArRow[],
  apRows: FinanceCashFlowApRow[],
  filters: FinanceCashFlowDashboardFilters,
  referenceDate: Date,
  inflowFactors: InflowFactorFn[]
): Map<string, MonthBucket>[] {
  const refYm = { year: referenceDate.getFullYear(), month: referenceDate.getMonth() + 1 };
  const maps = inflowFactors.map(() => emptyForwardBuckets(referenceDate));
  const modes = cashFlowViewModeSlices(filters.viewMode);
  const nullFutureRealized = filters.viewMode === "realized";

  for (const slice of modes) {
    for (const row of arRows) {
      if (!shouldIncludeCashFlowArMovement(row, slice)) continue;
      const rawAmount = resolveCashFlowArAmount(row, slice);
      if (rawAmount <= 0) continue;
      const date = resolveCashFlowArMovementDate(row, slice, filters.dateBase);
      if (!date) continue;
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      const key = `${year}-${month}`;
      if (nullFutureRealized && isFutureCalendarMonth(year, month, refYm.year, refYm.month)) {
        continue;
      }
      for (let i = 0; i < inflowFactors.length; i += 1) {
        const bucket = maps[i]!.get(key);
        if (!bucket) continue;
        bucket.inflow += roundMoney(rawAmount * inflowFactors[i]!(row, referenceDate));
      }
    }

    for (const row of apRows) {
      if (!shouldIncludeCashFlowApMovement(row, slice)) continue;
      const amount = resolveCashFlowApAmount(row, slice);
      if (amount <= 0) continue;
      const date = resolveCashFlowApMovementDate(row, slice, filters.dateBase);
      if (!date) continue;
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      const key = `${year}-${month}`;
      if (nullFutureRealized && isFutureCalendarMonth(year, month, refYm.year, refYm.month)) {
        continue;
      }
      for (const buckets of maps) {
        const bucket = buckets.get(key);
        if (!bucket) continue;
        bucket.outflow += amount;
      }
    }
  }

  return maps;
}

function bucketsToMonthlyPoints(
  buckets: Map<string, MonthBucket>,
  referenceDate: Date,
  filters: FinanceCashFlowDashboardFilters
): FinanceCashFlowForecastMonthPoint[] {
  const refYm = { year: referenceDate.getFullYear(), month: referenceDate.getMonth() + 1 };
  const nullFutureRealized = filters.viewMode === "realized";
  let accumulated = 0;
  const points: FinanceCashFlowForecastMonthPoint[] = [];

  for (let i = 0; i < 12; i += 1) {
    const ym = addCalendarMonths(refYm.year, refYm.month, i);
    const key = `${ym.year}-${ym.month}`;
    const bucket = buckets.get(key);
    const future = nullFutureRealized && isFutureCalendarMonth(ym.year, ym.month, refYm.year, refYm.month);

    if (!bucket || future) {
      points.push({
        year: ym.year,
        month: ym.month,
        monthLabel: monthLabel(ym.year, ym.month),
        projectedInflow: null,
        projectedOutflow: null,
        projectedNet: null,
        projectedAccumulated: null,
        status: null,
      });
      continue;
    }

    const inflow = roundMoney(bucket.inflow);
    const outflow = roundMoney(bucket.outflow);
    const net = roundMoney(inflow - outflow);
    accumulated = roundMoney(accumulated + net);

    points.push({
      year: ym.year,
      month: ym.month,
      monthLabel: monthLabel(ym.year, ym.month),
      projectedInflow: inflow,
      projectedOutflow: outflow,
      projectedNet: net,
      projectedAccumulated: accumulated,
      status: resolveMonthlyNetStatus(net),
    });
  }

  return points;
}

function summarizeHorizon(
  points: FinanceCashFlowForecastMonthPoint[],
  monthCount: number,
  horizonLabel: string
): FinanceCashFlowForecastHorizonSummary {
  const slice = points.slice(0, monthCount);
  const valid = slice.filter((p) => p.projectedNet != null);

  let inflow = 0;
  let outflow = 0;
  let net = 0;
  let accumulated = 0;
  let negativeMonths = 0;
  let worst: FinanceCashFlowForecastMonthRef | null = null;
  let best: FinanceCashFlowForecastMonthRef | null = null;
  let firstNegative: FinanceCashFlowForecastMonthRef | null = null;
  let maxNeed = 0;
  let maxSurplus = 0;

  for (const p of valid) {
    inflow += p.projectedInflow ?? 0;
    outflow += p.projectedOutflow ?? 0;
    net += p.projectedNet ?? 0;
    accumulated = p.projectedAccumulated ?? accumulated;
    const n = p.projectedNet ?? 0;
    if (n < 0) {
      negativeMonths += 1;
      if (!firstNegative) {
        firstNegative = {
          year: p.year,
          month: p.month,
          monthLabel: p.monthLabel,
          projectedNet: n,
        };
      }
    }
    const ref: FinanceCashFlowForecastMonthRef = {
      year: p.year,
      month: p.month,
      monthLabel: p.monthLabel,
      projectedNet: n,
    };
    if (!worst || n < worst.projectedNet) worst = ref;
    if (!best || n > best.projectedNet) best = ref;
    if (n < 0) maxNeed = Math.max(maxNeed, Math.abs(n));
    if (n > 0) maxSurplus = Math.max(maxSurplus, n);
  }

  const endAccumulated = valid.length > 0 ? (valid[valid.length - 1]!.projectedAccumulated ?? 0) : 0;
  if (endAccumulated < 0) maxNeed = Math.max(maxNeed, Math.abs(endAccumulated));

  return {
    horizonLabel,
    monthCount,
    projectedInflow: roundMoney(inflow),
    projectedOutflow: roundMoney(outflow),
    projectedNet: roundMoney(net),
    projectedAccumulated: roundMoney(endAccumulated),
    worstMonth: worst,
    bestMonth: best,
    negativeMonthsCount: negativeMonths,
    firstNegativeMonth: firstNegative,
    maxCashNeed: roundMoney(maxNeed),
    maxCashSurplus: roundMoney(maxSurplus),
  };
}

export function buildCashFlowForecastWithScenarios(
  arRows: FinanceCashFlowArRow[],
  apRows: FinanceCashFlowApRow[],
  filters: FinanceCashFlowDashboardFilters,
  referenceDate: Date
): {
  cashForecast: FinanceCashFlowCashForecast;
  conservativeScenario: FinanceCashFlowConservativeScenario;
  stressScenario: FinanceCashFlowStressScenario;
} {
  const [baseBuckets, conservativeBuckets, stressBuckets] = buildForwardBucketsForFactors(
    arRows,
    apRows,
    filters,
    referenceDate,
    [() => 1, conservativeInflowFactor, stressInflowFactor]
  );
  const cashForecast = forecastFromBuckets(baseBuckets!, referenceDate, filters);
  return {
    cashForecast,
    conservativeScenario: conservativeScenarioFromMonthlyPoints(
      bucketsToMonthlyPoints(conservativeBuckets!, referenceDate, filters),
      cashForecast.horizons.next12Months
    ),
    stressScenario: stressScenarioFromMonthlyPoints(
      bucketsToMonthlyPoints(stressBuckets!, referenceDate, filters)
    ),
  };
}

function forecastFromBuckets(
  buckets: Map<string, MonthBucket>,
  referenceDate: Date,
  filters: FinanceCashFlowDashboardFilters
): FinanceCashFlowCashForecast {
  const monthlyPoints = bucketsToMonthlyPoints(buckets, referenceDate, filters);
  return {
    monthlyPoints,
    horizons: {
      currentMonth: summarizeHorizon(monthlyPoints, 1, "Mês atual"),
      next3Months: summarizeHorizon(monthlyPoints, 3, "Próximos 3 meses"),
      next6Months: summarizeHorizon(monthlyPoints, 6, "Próximos 6 meses"),
      next12Months: summarizeHorizon(monthlyPoints, 12, "Próximos 12 meses"),
    },
  };
}

export function buildCashFlowForecast(
  arRows: FinanceCashFlowArRow[],
  apRows: FinanceCashFlowApRow[],
  filters: FinanceCashFlowDashboardFilters,
  referenceDate: Date
): FinanceCashFlowCashForecast {
  return forecastFromBuckets(
    buildForwardBuckets(arRows, apRows, filters, referenceDate),
    referenceDate,
    filters
  );
}

function conservativeInflowFactor(row: FinanceCashFlowArRow, referenceDate: Date): number {
  const status = classifyFinanceArTitle(row, referenceDate);
  return status === "overdue" ? CONSERVATIVE_OVERDUE_RECEIVABLE_FACTOR : CONSERVATIVE_OPEN_RECEIVABLE_FACTOR;
}

function stressInflowFactor(row: FinanceCashFlowArRow, referenceDate: Date): number {
  const status = classifyFinanceArTitle(row, referenceDate);
  return status === "overdue" ? STRESS_OVERDUE_RECEIVABLE_FACTOR : STRESS_OPEN_RECEIVABLE_FACTOR;
}

function conservativeScenarioFromMonthlyPoints(
  monthlyPoints: FinanceCashFlowForecastMonthPoint[],
  baseHorizon: FinanceCashFlowForecastHorizonSummary
): FinanceCashFlowConservativeScenario {
  const horizon = summarizeHorizon(monthlyPoints, 12, "Conservador 12m");
  const cashNeed = horizon.projectedAccumulated < 0 ? roundMoney(Math.abs(horizon.projectedAccumulated)) : horizon.maxCashNeed;

  return {
    disclaimer: "Cenário conservador — estimativa, não altera dados oficiais.",
    assumptions: [
      `${Math.round(CONSERVATIVE_OPEN_RECEIVABLE_FACTOR * 100)}% dos recebíveis em aberto considerados realizáveis`,
      `${Math.round(CONSERVATIVE_OVERDUE_RECEIVABLE_FACTOR * 100)}% dos vencidos a receber`,
      "100% das contas a pagar mantidas",
    ],
    projectedInflowConservative: horizon.projectedInflow,
    projectedOutflow: horizon.projectedOutflow,
    projectedNetConservative: horizon.projectedNet,
    cashNeedConservative: cashNeed,
    deltaVsBase: roundMoney(cashNeed - baseHorizon.maxCashNeed),
    monthlyPoints,
  };
}

function stressScenarioFromMonthlyPoints(
  monthlyPoints: FinanceCashFlowForecastMonthPoint[]
): FinanceCashFlowStressScenario {
  const horizon = summarizeHorizon(monthlyPoints, 12, "Crítico 12m");
  const cashNeed =
    horizon.projectedAccumulated < 0
      ? roundMoney(Math.abs(horizon.projectedAccumulated))
      : horizon.maxCashNeed;

  return {
    disclaimer: "Cenário crítico — simulação gerencial.",
    assumptions: [
      `${Math.round(STRESS_OPEN_RECEIVABLE_FACTOR * 100)}% dos recebíveis em aberto`,
      `${Math.round(STRESS_OVERDUE_RECEIVABLE_FACTOR * 100)}% dos vencidos a receber`,
      "100% das contas a pagar, vencidos a pagar imediatos",
    ],
    projectedInflowStress: horizon.projectedInflow,
    projectedOutflowStress: horizon.projectedOutflow,
    projectedNetStress: horizon.projectedNet,
    cashNeedStress: cashNeed,
    monthsAtRiskStress: horizon.negativeMonthsCount,
    monthlyPoints,
  };
}

export function buildConservativeScenario(
  arRows: FinanceCashFlowArRow[],
  apRows: FinanceCashFlowApRow[],
  filters: FinanceCashFlowDashboardFilters,
  referenceDate: Date,
  baseHorizon: FinanceCashFlowForecastHorizonSummary
): FinanceCashFlowConservativeScenario {
  const buckets = buildForwardBuckets(arRows, apRows, filters, referenceDate, conservativeInflowFactor);
  return conservativeScenarioFromMonthlyPoints(
    bucketsToMonthlyPoints(buckets, referenceDate, filters),
    baseHorizon
  );
}

export function buildStressScenario(
  arRows: FinanceCashFlowArRow[],
  apRows: FinanceCashFlowApRow[],
  filters: FinanceCashFlowDashboardFilters,
  referenceDate: Date
): FinanceCashFlowStressScenario {
  const buckets = buildForwardBuckets(arRows, apRows, filters, referenceDate, stressInflowFactor);
  return stressScenarioFromMonthlyPoints(bucketsToMonthlyPoints(buckets, referenceDate, filters));
}

export function buildScenarioChartPoints(
  base: FinanceCashFlowForecastMonthPoint[],
  conservative: FinanceCashFlowForecastMonthPoint[],
  stress: FinanceCashFlowForecastMonthPoint[]
): FinanceCashFlowScenarioChartPoint[] {
  return base.map((b, idx) => ({
    name: b.monthLabel,
    year: b.year,
    month: b.month,
    base: b.projectedNet,
    conservative: conservative[idx]?.projectedNet ?? null,
    stress: stress[idx]?.projectedNet ?? null,
  }));
}

export function buildCashFlowOperationalRecommendations(input: {
  cards: Pick<
    FinanceCashFlowDashboardCards,
    "netCashPositionAbs" | "netCashPositionStatus" | "cashNeedAmount"
  >;
  cashForecast: FinanceCashFlowCashForecast;
  conservativeScenario: FinanceCashFlowConservativeScenario;
  overdueReceivables: FinanceCashFlowCriticalMovement[];
  overduePayables: FinanceCashFlowCriticalMovement[];
  topSupplier?: FinanceCashFlowPartySummary;
}): string[] {
  const lines: string[] = [];
  const { cards, cashForecast, conservativeScenario, overdueReceivables, overduePayables, topSupplier } =
    input;
  const horizon12 = cashForecast.horizons.next12Months;

  if (overdueReceivables.length > 0) {
    const n = Math.min(overdueReceivables.length, 5);
    lines.push(`Priorizar cobrança dos ${n} maiores vencidos a receber.`);
  }

  if (topSupplier && topSupplier.amount > 0) {
    const name = topSupplier.personName?.trim() || "principal fornecedor";
    lines.push(`Negociar prazo com fornecedor ${name}.`);
  }

  if (horizon12.worstMonth) {
    lines.push(
      `Acompanhar ${horizon12.worstMonth.monthLabel}, mês de maior pressão projetada (${formatFinanceCurrency(horizon12.worstMonth.projectedNet)}).`
    );
  }

  if (cards.netCashPositionStatus === "deficit" && cards.cashNeedAmount > 0) {
    lines.push(
      `Evitar assumir novas saídas antes de cobrir déficit de ${formatFinanceCurrency(cards.cashNeedAmount)}.`
    );
  }

  if (conservativeScenario.cashNeedConservative > cards.cashNeedAmount) {
    const worst = conservativeScenario.monthlyPoints.find(
      (p) => p.projectedNet != null && p.projectedNet < 0
    );
    const when = worst?.monthLabel ?? horizon12.worstMonth?.monthLabel ?? "no horizonte";
    lines.push(
      `Se apenas ${Math.round(CONSERVATIVE_OPEN_RECEIVABLE_FACTOR * 100)}% dos recebíveis forem realizados no prazo, a necessidade estimada de caixa sobe para ${formatFinanceCurrency(conservativeScenario.cashNeedConservative)} em ${when}.`
    );
  }

  if (overdueReceivables.length > 0) {
    const top = overdueReceivables[0]!;
    const totalOverdue = overdueReceivables.reduce((s, r) => s + r.amount, 0);
    const pct =
      totalOverdue > 0 ? roundMoney((top.amount / totalOverdue) * 100) : 0;
    const name = top.personName?.trim() || "cliente principal";
    if (pct >= 25) {
      lines.push(
        `Concentrar cobrança no cliente ${name}, responsável por ${pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% das entradas vencidas.`
      );
    }
  }

  if (overduePayables.length > 0 && overduePayables[0]) {
    const top = overduePayables[0];
    lines.push(
      `Quitar ou renegociar pagamento vencido de ${formatFinanceCurrency(top.amount)} (${top.personName ?? "fornecedor"}).`
    );
  }

  return lines;
}
