/**
 * Adapter fino — orquestra motores oficiais AR/AP para o Fluxo de Caixa.
 *
 * Regra: não recalcula AR nem AP. Combina entradas oficiais, saídas oficiais,
 * saldo líquido (entradas − saídas) e saldo acumulado.
 */
import { roundMoney } from "./financeAccountsReceivableDashboard.js";
import {
  buildOfficialAccountsReceivableDashboard,
  OFFICIAL_AR_RULES_SOURCE,
  resolveOfficialArCashFlowExecutiveMetrics,
  type OfficialAccountsReceivableDashboardPayload,
} from "./financeAccountsReceivableRulesAdapter.js";
import {
  buildOfficialAccountsPayableDashboard,
  OFFICIAL_AP_RULES_SOURCE,
  resolveOfficialApCashFlowExecutiveMetrics,
  type OfficialAccountsPayableDashboardPayload,
} from "./financeAccountsPayableRulesAdapter.js";
import type {
  FinanceCashFlowApRow,
  FinanceCashFlowArRow,
  FinanceCashFlowDashboardFilters,
} from "./financeCashFlowDashboard.js";
import {
  toApLoadFilters,
  toArLoadFilters,
  toCashFlowPortfolioApFilters,
  toCashFlowPortfolioArFilters,
} from "./financeCashFlowDashboard.js";
import type { FinanceCashFlowMonthlyPoint } from "./financeCashFlowDashboardTypes.js";
import type { NomusApReportSyncCutoff } from "./financeNomusApReportFreshness.js";
import type { NomusArReportSyncCutoff } from "./financeNomusArReportFreshness.js";

export const OFFICIAL_CF_RULES_SOURCE = "official-cash-flow-rules-orchestrator" as const;

export type OfficialCashFlowSources = {
  inflows: typeof OFFICIAL_AR_RULES_SOURCE;
  outflows: typeof OFFICIAL_AP_RULES_SOURCE;
  orchestrator: typeof OFFICIAL_CF_RULES_SOURCE;
};

/** Identificadores oficiais expostos no payload do Fluxo de Caixa. */
export function resolveOfficialCashFlowSources(): OfficialCashFlowSources {
  return {
    inflows: OFFICIAL_AR_RULES_SOURCE,
    outflows: OFFICIAL_AP_RULES_SOURCE,
    orchestrator: OFFICIAL_CF_RULES_SOURCE,
  };
}

export type OfficialCashFlowArApDashboardBundle = {
  arPortfolio: OfficialAccountsReceivableDashboardPayload;
  apPortfolio: OfficialAccountsPayableDashboardPayload;
  arPeriod: OfficialAccountsReceivableDashboardPayload;
  apPeriod: OfficialAccountsPayableDashboardPayload;
  metricsSource: OfficialCashFlowSources;
};

/** Dashboards AR/AP oficiais para reconciliação e cards de carteira/período. */
export function buildOfficialCashFlowArApDashboardBundle(input: {
  arRows: FinanceCashFlowArRow[];
  apRows: FinanceCashFlowApRow[];
  filters: FinanceCashFlowDashboardFilters;
  referenceDate: Date;
  arSyncCutoff?: NomusArReportSyncCutoff | null;
  apSyncCutoff?: NomusApReportSyncCutoff | null;
}): OfficialCashFlowArApDashboardBundle {
  const { arRows, apRows, filters, referenceDate, arSyncCutoff, apSyncCutoff } = input;
  return {
    arPortfolio: buildOfficialAccountsReceivableDashboard({
      rows: arRows,
      filters: toCashFlowPortfolioArFilters(filters),
      referenceDate,
      syncCutoff: arSyncCutoff,
    }),
    apPortfolio: buildOfficialAccountsPayableDashboard({
      rows: apRows,
      filters: toCashFlowPortfolioApFilters(filters),
      referenceDate,
      syncCutoff: apSyncCutoff,
    }),
    arPeriod: buildOfficialAccountsReceivableDashboard({
      rows: arRows,
      filters: toArLoadFilters(filters),
      referenceDate,
      syncCutoff: arSyncCutoff,
      year: filters.year,
      month: filters.month,
    }),
    apPeriod: buildOfficialAccountsPayableDashboard({
      rows: apRows,
      filters: toApLoadFilters(filters),
      referenceDate,
      syncCutoff: apSyncCutoff,
      year: filters.year,
      month: filters.month,
    }),
    metricsSource: resolveOfficialCashFlowSources(),
  };
}

export type OfficialCashFlowExecutiveSideMetrics = {
  receivable: ReturnType<typeof resolveOfficialArCashFlowExecutiveMetrics>;
  payable: ReturnType<typeof resolveOfficialApCashFlowExecutiveMetrics>;
  netRealizedYtd: number;
  netOpenUntilYearEnd: number;
  netEstimatedYearTotal: number;
  metricsSource: OfficialCashFlowSources;
};

/** YTD e projeções anuais — AR/AP oficiais; saldo líquido calculado pelo Fluxo. */
export function resolveOfficialCashFlowExecutiveSideMetrics(input: {
  arRows: FinanceCashFlowArRow[];
  apRows: FinanceCashFlowApRow[];
  filters: FinanceCashFlowDashboardFilters;
  referenceDate: Date;
  arSyncCutoff?: NomusArReportSyncCutoff | null;
  apSyncCutoff?: NomusApReportSyncCutoff | null;
  year: number;
}): OfficialCashFlowExecutiveSideMetrics {
  const arFilters = toArLoadFilters(input.filters);
  const apFilters = toApLoadFilters(input.filters);
  const receivable = resolveOfficialArCashFlowExecutiveMetrics(
    input.arRows,
    arFilters,
    input.referenceDate,
    input.arSyncCutoff,
    input.year
  );
  const payable = resolveOfficialApCashFlowExecutiveMetrics(
    input.apRows,
    apFilters,
    input.referenceDate,
    input.apSyncCutoff,
    input.year
  );
  return {
    receivable,
    payable,
    netRealizedYtd: computeCashFlowNetBalance(receivable.receivedYtd, payable.paidYtd),
    netOpenUntilYearEnd: computeCashFlowNetBalance(
      receivable.openUntilYearEnd,
      payable.openUntilYearEnd
    ),
    netEstimatedYearTotal: computeCashFlowNetBalance(
      receivable.estimatedYearTotal,
      payable.estimatedYearTotal
    ),
    metricsSource: resolveOfficialCashFlowSources(),
  };
}

/** Saldo líquido = entradas oficiais AR − saídas oficiais AP. */
export function computeCashFlowNetBalance(inflow: number, outflow: number): number {
  return roundMoney(inflow - outflow);
}

/** Soma acumulada de saldos líquidos mensais (Fluxo de Caixa). */
export function computeCashFlowAccumulatedFromMonthlySeries(
  series: FinanceCashFlowMonthlyPoint[],
  monthFilter?: number
): number {
  let accumulated = 0;
  for (const point of series) {
    if (monthFilter != null && point.month !== monthFilter) continue;
    if (point.netFlowAmount == null) continue;
    accumulated = roundMoney(accumulated + point.netFlowAmount);
  }
  return accumulated;
}

export {
  OFFICIAL_AR_RULES_SOURCE,
  OFFICIAL_AP_RULES_SOURCE,
};
