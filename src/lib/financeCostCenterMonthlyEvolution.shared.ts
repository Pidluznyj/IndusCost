/**
 * Evolução mensal do centro de custo (bloco abaixo da tabela de títulos).
 * Helpers puros (client-safe) — sem Prisma / server.
 *
 * Regra financeira: o eixo de período é SEMPRE a data de vencimento (dueDate).
 * A fonte de dados é a MESMA da tabela de títulos do drilldown
 * (resolveCostCenterDetailFilteredRowsForCenters) — este arquivo apenas agrupa
 * as linhas já filtradas por mês de vencimento e calcula a linha de tendência.
 */
import {
  COST_CENTER_MONTHLY_CHART_MONTH_LABELS,
  formatCostCenterMonthlyChartPeriodLabel,
} from "./financeCostCenterMonthlyChart.shared.js";

export const COST_CENTER_MONTHLY_EVOLUTION_METRICS_SCOPE =
  "Valores por data de vencimento (Contas a Pagar)";

/** Linha mínima necessária para o agrupamento — subconjunto de CostCenterDetailAllocationRow. */
export type CostCenterMonthlyEvolutionSourceRow = {
  dueDate: string | null;
  allocatedAmount: number;
};

export type CostCenterMonthlyEvolutionPoint = {
  month: number;
  monthLabel: string;
  amount: number;
  trend: number;
  highlighted: boolean;
};

export type CostCenterMonthlyEvolutionExtremeMonth = {
  month: number;
  monthLabel: string;
  amount: number;
};

export type CostCenterMonthlyEvolutionSummary = {
  totalYear: number;
  monthlyAverage: number;
  maxMonth: CostCenterMonthlyEvolutionExtremeMonth | null;
  minMonth: CostCenterMonthlyEvolutionExtremeMonth | null;
};

export type CostCenterMonthlyEvolutionPayload = {
  hasYear: boolean;
  year: number | null;
  costCenterIds: string[];
  points: CostCenterMonthlyEvolutionPoint[];
  summary: CostCenterMonthlyEvolutionSummary;
  hasData: boolean;
  highlightMonth: number | null;
  periodLabel: string;
  metricsScope: string;
};

function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Agrupa as linhas por mês de vencimento (dueDate) dentro do ano informado.
 * Retorna 12 posições (Jan..Dez), meses sem título ficam em 0.
 * Usa o mesmo critério de mês do dashboard oficial (Date.getFullYear/getMonth).
 */
export function groupCostCenterAllocationByDueMonth(
  rows: CostCenterMonthlyEvolutionSourceRow[],
  year: number
): number[] {
  const buckets = new Array<number>(12).fill(0);
  for (const row of rows) {
    if (!row.dueDate) continue;
    const date = new Date(row.dueDate);
    if (Number.isNaN(date.getTime())) continue;
    if (date.getFullYear() !== year) continue;
    const monthIndex = date.getMonth();
    if (monthIndex < 0 || monthIndex > 11) continue;
    const amount = Number.isFinite(row.allocatedAmount) ? row.allocatedAmount : 0;
    buckets[monthIndex] += amount;
  }
  return buckets.map(round2);
}

/**
 * Linha de tendência via regressão linear simples sobre os 12 meses.
 * x = número do mês (1..12), y = valor mensal.
 * Regras: sem tendência negativa; todos os meses zero => tendência zero.
 */
export function computeCostCenterMonthlyTrend(amounts: number[]): number[] {
  const n = amounts.length;
  if (n === 0) return [];
  const allZero = amounts.every((value) => !(value > 0));
  if (allZero) return amounts.map(() => 0);

  const xs = amounts.map((_, index) => index + 1);
  const meanX = xs.reduce((acc, value) => acc + value, 0) / n;
  const meanY = amounts.reduce((acc, value) => acc + value, 0) / n;

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i]! - meanX;
    numerator += dx * (amounts[i]! - meanY);
    denominator += dx * dx;
  }

  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = meanY - slope * meanX;

  return xs.map((x) => {
    const estimate = intercept + slope * x;
    return round2(estimate > 0 ? estimate : 0);
  });
}

export function buildCostCenterMonthlyEvolutionSummary(
  amounts: number[]
): CostCenterMonthlyEvolutionSummary {
  const totalYear = round2(amounts.reduce((acc, value) => acc + value, 0));
  const monthlyAverage = round2(totalYear / 12);

  let maxMonth: CostCenterMonthlyEvolutionExtremeMonth | null = null;
  let minMonth: CostCenterMonthlyEvolutionExtremeMonth | null = null;

  amounts.forEach((amount, index) => {
    const month = index + 1;
    const monthLabel = COST_CENTER_MONTHLY_CHART_MONTH_LABELS[index]!;
    if (amount > 0) {
      if (!maxMonth || amount > maxMonth.amount) {
        maxMonth = { month, monthLabel, amount };
      }
      if (!minMonth || amount < minMonth.amount) {
        minMonth = { month, monthLabel, amount };
      }
    }
  });

  return { totalYear, monthlyAverage, maxMonth, minMonth };
}

/**
 * Monta o payload completo do gráfico a partir das linhas já filtradas
 * (mesma fonte/filtro da tabela) para o ano selecionado.
 */
export function buildCostCenterMonthlyEvolutionPayload(input: {
  rows: CostCenterMonthlyEvolutionSourceRow[];
  costCenterIds: string[];
  year: number;
  highlightMonth?: number | null;
}): CostCenterMonthlyEvolutionPayload {
  const highlightMonth =
    input.highlightMonth != null && input.highlightMonth >= 1 && input.highlightMonth <= 12
      ? input.highlightMonth
      : null;
  const amounts = groupCostCenterAllocationByDueMonth(input.rows, input.year);
  const trend = computeCostCenterMonthlyTrend(amounts);
  const points: CostCenterMonthlyEvolutionPoint[] = amounts.map((amount, index) => ({
    month: index + 1,
    monthLabel: COST_CENTER_MONTHLY_CHART_MONTH_LABELS[index]!,
    amount,
    trend: trend[index] ?? 0,
    highlighted: highlightMonth === index + 1,
  }));
  const summary = buildCostCenterMonthlyEvolutionSummary(amounts);

  return {
    hasYear: true,
    year: input.year,
    costCenterIds: input.costCenterIds,
    points,
    summary,
    hasData: summary.totalYear > 0,
    highlightMonth,
    periodLabel: formatCostCenterMonthlyChartPeriodLabel(input.year, highlightMonth),
    metricsScope: COST_CENTER_MONTHLY_EVOLUTION_METRICS_SCOPE,
  };
}

/** Payload vazio quando não há ano selecionado (filtro "Todos"). */
export function buildCostCenterMonthlyEvolutionEmptyPayload(
  costCenterIds: string[]
): CostCenterMonthlyEvolutionPayload {
  return {
    hasYear: false,
    year: null,
    costCenterIds,
    points: [],
    summary: { totalYear: 0, monthlyAverage: 0, maxMonth: null, minMonth: null },
    hasData: false,
    highlightMonth: null,
    periodLabel: "Selecione um ano para visualizar a evolução mensal.",
    metricsScope: COST_CENTER_MONTHLY_EVOLUTION_METRICS_SCOPE,
  };
}
