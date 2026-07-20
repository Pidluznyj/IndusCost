/**
 * Série oficial "Gastos por Centro de Custo" — derivada de byCostCenter do dashboard gerencial.
 * Não recalcula alocação; apenas formata, ordena, cores estáveis e Top N + Outros para print.
 */
import { OFFICIAL_AP_RULES_SOURCE } from "@/src/lib/financeAccountsPayableRulesAdapter.js";
import type {
  FinanceCostCenterDashboardByCostCenterRow,
  FinanceCostCenterDashboardFilters,
} from "@/src/lib/financeCostCenterDashboard.js";
import { roundMoney } from "@/src/lib/commissions/commission-money.shared.js";
import { safeRatio } from "@/src/lib/financeAccountsPayableDashboard.js";
import { formatFinanceKpiCurrency } from "@/src/lib/financeKpiFormat.js";

export const COST_CENTER_ANNUAL_SPENDING_METRICS_SOURCE =
  "financeCostCenterDashboard.byCostCenter" as const;

/** Paleta executiva estável — evita tons muito claros para PDF. */
export const COST_CENTER_CHART_PALETTE = [
  "#1e3a5f",
  "#2563eb",
  "#059669",
  "#b45309",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
  "#be185d",
  "#4338ca",
  "#0d9488",
  "#ca8a04",
  "#4f46e5",
  "#c2410c",
  "#15803d",
  "#9333ea",
] as const;

export const COST_CENTER_OTHERS_COLOR = "#64748b";

/** Cor principal executiva — barras individuais (exceto Outros). */
export const COST_CENTER_BAR_PRIMARY_COLOR = "#1e3a5f";

/** Top N padrão para exibição (dashboard e relatório). */
export const COST_CENTER_ANNUAL_SPENDING_DEFAULT_TOP_N = 10;

export type CostCenterAnnualSpendingOthersPreviewRow = {
  costCenterCode: string;
  costCenterName: string;
  displayName: string;
  totalAmount: number;
};

export type CostCenterAnnualSpendingPeriodScope = "annual" | "monthly";

export type CostCenterAnnualSpendingRow = {
  costCenterId: string;
  costCenterCode: string;
  costCenterName: string;
  /** Nome legível para eixo/legenda — nunca código cru. */
  displayName: string;
  /** Versão truncada para eixo Y (ellipsis). */
  shortName: string;
  totalAmount: number;
  paidAmount: number;
  openAmount: number;
  overdueAmount: number;
  percentageOfTotal: number;
  rank: number;
  colorKey: string;
  colorHex: string;
  isOthersBucket: boolean;
  /** Top centros dentro do bucket Outros (tooltip). */
  othersContainedPreview?: CostCenterAnnualSpendingOthersPreviewRow[];
};

export type CostCenterAnnualSpendingChartPayload = {
  title: string;
  subtitle: string;
  periodYear: number;
  periodMonth: number | null;
  periodScope: CostCenterAnnualSpendingPeriodScope;
  filtersApplied: Pick<
    FinanceCostCenterDashboardFilters,
    "year" | "month" | "status" | "companyName" | "classification" | "costCenterId" | "supplierId"
  >;
  rows: CostCenterAnnualSpendingRow[];
  /** Linhas para exibição (Top N + Outros quando aplicável). */
  displayRows: CostCenterAnnualSpendingRow[];
  totalAmount: number;
  costCentersCount: number;
  othersAmount: number | null;
  othersIncludedCount: number;
  topNApplied: number | null;
  metricsSource: typeof COST_CENTER_ANNUAL_SPENDING_METRICS_SOURCE;
  officialApSource: typeof OFFICIAL_AP_RULES_SOURCE;
};

export type BuildCostCenterAnnualSpendingChartOptions = {
  /** Limita centros visíveis agrupando excedente em "Outros". null = todos. */
  topN?: number | null;
};

const MONTH_LABELS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
] as const;

function stableHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** Remove prefixo CC_, troca _ por espaço e normaliza caixa para leitura executiva. */
export function humanizeCostCenterCode(code: string): string {
  const trimmed = code.trim();
  if (!trimmed) return "Centro de custo";
  const withoutPrefix = trimmed.replace(/^CC_/i, "");
  const words = withoutPrefix
    .split("_")
    .map((part) => part.trim())
    .filter(Boolean);
  if (words.length === 0) return trimmed.toUpperCase();
  return words
    .map((word) => {
      if (word.length <= 3 && /^[A-Z0-9]+$/i.test(word)) return word.toUpperCase();
      const lower = word.toLocaleLowerCase("pt-BR");
      return lower.charAt(0).toLocaleUpperCase("pt-BR") + lower.slice(1);
    })
    .join(" ")
    .toLocaleUpperCase("pt-BR");
}

/** Rótulo principal: nome do centro; fallback humanizado do código. */
export function resolveCostCenterDisplayName(name: string, code: string, costCenterId?: string): string {
  const normalizedName = name.trim();
  if (normalizedName) return normalizedName.toLocaleUpperCase("pt-BR");
  const normalizedCode = code.trim();
  if (normalizedCode) return humanizeCostCenterCode(normalizedCode);
  return costCenterId?.trim() || "Centro de custo";
}

export function truncateCostCenterChartLabel(label: string, max = 28): string {
  if (label.length <= max) return label;
  return `${label.slice(0, max - 1)}…`;
}

export function resolveCostCenterBarColorHex(
  row: Pick<CostCenterAnnualSpendingRow, "isOthersBucket" | "colorKey">
): string {
  if (row.isOthersBucket) return COST_CENTER_OTHERS_COLOR;
  return COST_CENTER_BAR_PRIMARY_COLOR;
}

export function resolveCostCenterChartColorKey(costCenterId: string, code: string): string {
  const normalized = code.trim() || costCenterId;
  return normalized.toUpperCase();
}

export function resolveCostCenterChartColorHex(colorKey: string): string {
  const index = stableHash(colorKey) % COST_CENTER_CHART_PALETTE.length;
  return COST_CENTER_CHART_PALETTE[index]!;
}

export function resolveCostCenterAnnualSpendingPeriodCopy(filters: {
  year?: number;
  month?: number;
}): {
  periodScope: CostCenterAnnualSpendingPeriodScope;
  periodYear: number;
  periodMonth: number | null;
  title: string;
  subtitle: string;
} {
  const periodYear = filters.year ?? new Date().getFullYear();
  const periodMonth =
    filters.month != null && Number.isFinite(filters.month) && filters.month >= 1 && filters.month <= 12
      ? filters.month
      : null;
  const periodScope: CostCenterAnnualSpendingPeriodScope = periodMonth != null ? "monthly" : "annual";

  if (periodScope === "monthly" && periodMonth != null) {
    const monthName = MONTH_LABELS[periodMonth - 1] ?? String(periodMonth).padStart(2, "0");
    return {
      periodScope,
      periodYear,
      periodMonth,
      title: `Gastos por Centro de Custo — ${monthName}/${periodYear}`,
      subtitle: "Distribuição do AP gerencial classificado por centro de custo.",
    };
  }

  return {
    periodScope,
    periodYear,
    periodMonth: null,
    title: `Gastos anuais por Centro de Custo — ${periodYear}`,
    subtitle: "Distribuição do AP gerencial classificado por centro de custo.",
  };
}

function mapByCostCenterRow(
  row: FinanceCostCenterDashboardByCostCenterRow,
  rank: number,
  totalAmount: number
): CostCenterAnnualSpendingRow {
  const colorKey = resolveCostCenterChartColorKey(row.costCenterId, row.code);
  const displayName = resolveCostCenterDisplayName(row.name, row.code, row.costCenterId);
  const mapped: CostCenterAnnualSpendingRow = {
    costCenterId: row.costCenterId,
    costCenterCode: row.code,
    costCenterName: row.name,
    displayName,
    shortName: truncateCostCenterChartLabel(displayName),
    totalAmount: roundMoney(row.amount),
    paidAmount: roundMoney(row.paidAmount),
    openAmount: roundMoney(row.openAmount),
    overdueAmount: roundMoney(row.overdueAmount),
    percentageOfTotal: roundMoney(safeRatio(row.amount, totalAmount) * 100),
    rank,
    colorKey,
    colorHex: COST_CENTER_BAR_PRIMARY_COLOR,
    isOthersBucket: false,
  };
  mapped.colorHex = resolveCostCenterBarColorHex(mapped);
  return mapped;
}

export function applyCostCenterAnnualSpendingTopN(
  rows: CostCenterAnnualSpendingRow[],
  topN: number | null | undefined
): {
  displayRows: CostCenterAnnualSpendingRow[];
  othersAmount: number | null;
  othersIncludedCount: number;
  topNApplied: number | null;
} {
  if (topN == null || topN <= 0 || rows.length <= topN) {
    return {
      displayRows: rows,
      othersAmount: null,
      othersIncludedCount: 0,
      topNApplied: topN ?? null,
    };
  }

  const top = rows.slice(0, topN);
  const rest = rows.slice(topN);
  const othersAmount = roundMoney(rest.reduce((sum, row) => sum + row.totalAmount, 0));
  const othersPaid = roundMoney(rest.reduce((sum, row) => sum + row.paidAmount, 0));
  const othersOpen = roundMoney(rest.reduce((sum, row) => sum + row.openAmount, 0));
  const othersOverdue = roundMoney(rest.reduce((sum, row) => sum + row.overdueAmount, 0));
  const totalAmount = rows.reduce((sum, row) => sum + row.totalAmount, 0);

  const othersRow: CostCenterAnnualSpendingRow = {
    costCenterId: "__others__",
    costCenterCode: "OUTROS",
    costCenterName: "Outros",
    displayName: "OUTROS",
    shortName: "OUTROS",
    totalAmount: othersAmount,
    paidAmount: othersPaid,
    openAmount: othersOpen,
    overdueAmount: othersOverdue,
    percentageOfTotal: roundMoney(safeRatio(othersAmount, totalAmount) * 100),
    rank: topN + 1,
    colorKey: "OUTROS",
    colorHex: COST_CENTER_OTHERS_COLOR,
    isOthersBucket: true,
    othersContainedPreview: rest.slice(0, 5).map((row) => ({
      costCenterCode: row.costCenterCode,
      costCenterName: row.costCenterName,
      displayName: row.displayName,
      totalAmount: row.totalAmount,
    })),
  };

  return {
    displayRows: [...top, othersRow],
    othersAmount,
    othersIncludedCount: rest.length,
    topNApplied: topN,
  };
}

export function buildCostCenterAnnualSpendingChart(
  byCostCenter: FinanceCostCenterDashboardByCostCenterRow[],
  filters: FinanceCostCenterDashboardFilters,
  options: BuildCostCenterAnnualSpendingChartOptions = {}
): CostCenterAnnualSpendingChartPayload {
  const sorted = [...byCostCenter].sort((a, b) => b.amount - a.amount);
  const totalAmount = roundMoney(sorted.reduce((sum, row) => sum + row.amount, 0));
  const rows = sorted.map((row, index) => mapByCostCenterRow(row, index + 1, totalAmount));
  const periodCopy = resolveCostCenterAnnualSpendingPeriodCopy(filters);
  const topNResult = applyCostCenterAnnualSpendingTopN(
    rows,
    options.topN ?? COST_CENTER_ANNUAL_SPENDING_DEFAULT_TOP_N
  );

  return {
    title: periodCopy.title,
    subtitle: periodCopy.subtitle,
    periodYear: periodCopy.periodYear,
    periodMonth: periodCopy.periodMonth,
    periodScope: periodCopy.periodScope,
    filtersApplied: {
      year: filters.year,
      month: filters.month,
      status: filters.status,
      companyName: filters.companyName,
      classification: filters.classification,
      costCenterId: filters.costCenterId,
      supplierId: filters.supplierId,
    },
    rows,
    displayRows: topNResult.displayRows,
    totalAmount,
    costCentersCount: rows.length,
    othersAmount: topNResult.othersAmount,
    othersIncludedCount: topNResult.othersIncludedCount,
    topNApplied: topNResult.topNApplied,
    metricsSource: COST_CENTER_ANNUAL_SPENDING_METRICS_SOURCE,
    officialApSource: OFFICIAL_AP_RULES_SOURCE,
  };
}

/** Filtros do Relatório Presidencial → dashboard gerencial de Centro de Custo. */
export function formatCostCenterAnnualSpendingPeriodLabel(chart: Pick<
  CostCenterAnnualSpendingChartPayload,
  "periodScope" | "periodYear" | "periodMonth"
>): string {
  if (chart.periodScope === "monthly" && chart.periodMonth != null) {
    const monthName = MONTH_LABELS[chart.periodMonth - 1] ?? String(chart.periodMonth).padStart(2, "0");
    return `${monthName}/${chart.periodYear}`;
  }
  return String(chart.periodYear);
}

/** Texto executivo para "Leitura do cenário". */
export function buildCostCenterAnnualSpendingScenarioText(
  chart: CostCenterAnnualSpendingChartPayload
): string {
  if (chart.totalAmount <= 0 || chart.rows.length === 0) {
    return "Não há contas classificadas para o período selecionado.";
  }

  const topRows = chart.topNApplied != null
    ? chart.displayRows.filter((row) => !row.isOthersBucket)
    : chart.rows;
  const topAmount = roundMoney(topRows.reduce((sum, row) => sum + row.totalAmount, 0));
  const topShare = roundMoney(safeRatio(topAmount, chart.totalAmount) * 100);

  if (chart.othersIncludedCount > 0 && chart.topNApplied != null) {
    const othersFormatted = formatFinanceKpiCurrency(chart.othersAmount ?? 0);
    return `Os ${chart.topNApplied} maiores centros concentram ${formatFinanceKpiCurrency(topAmount)}, representando ${topShare.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% do gasto classificado. Outros ${chart.othersIncludedCount} centros somam ${othersFormatted}.`;
  }

  return `Total classificado de ${formatFinanceKpiCurrency(chart.totalAmount)} distribuído em ${chart.costCentersCount} centro(s) no período ${formatCostCenterAnnualSpendingPeriodLabel(chart)}.`;
}

export function buildExecutiveReportCostCenterDashboardFilters(input: {
  year: number;
  month?: number | null;
  companyName?: string;
}): FinanceCostCenterDashboardFilters {
  return {
    status: "all",
    year: input.year,
    month: input.month ?? undefined,
    companyName: input.companyName,
    classification: "all",
  };
}
