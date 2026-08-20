/**
 * Adapter fino — transforma o motor oficial de AP para DTOs existentes.
 * Sem regra de negócio: apenas mapeamento, renomeação e compatibilidade de payload.
 */
import {
  sumFinanceApPaidInPaymentPeriod,
  type FinanceApDashboardFilters,
  type FinanceApDashboardRow,
} from "./financeAccountsPayableDashboard.js";
import {
  buildFinanceAccountsPayableRulesResult,
  countOfficialApOpenDueInPeriod,
  filterOfficialApManagementTitles,
  FINANCE_AP_RULES_ENGINE_VERSION,
  sumOfficialApOpenDueInPeriod,
  type FinanceAccountsPayableDashboardPayload,
  type FinanceAccountsPayableMetrics,
  type FinanceAccountsPayableRulesBuildInput,
  type FinanceAccountsPayableRulesResult,
  type OfficialApMetricScope,
} from "./financeAccountsPayableRulesEngine.js";
import {
  buildFinanceApDueRadar,
  type DueRadarPayload,
  type DueRadarQuery,
} from "./financeDueRadar.js";
import type { AccountsPayableSummary } from "./nomusAccountsPayableSummary.js";
import type { FinanceApDashboardCards } from "./financeAccountsPayableDashboardTypes.js";
import type { FinanceOfficialRulesProjection } from "./financeOfficialEngineProjection.js";
import type { NomusApReportSyncCutoff } from "./financeNomusApReportFreshness.js";

export const OFFICIAL_AP_RULES_SOURCE = "official-accounts-payable-rules-engine" as const;

export type OfficialAccountsPayableBuildInput = {
  rows: FinanceApDashboardRow[];
  filters?: FinanceApDashboardFilters;
  referenceDate?: Date;
  syncCutoff?: NomusApReportSyncCutoff | null;
  year?: number;
  month?: number;
  projection?: FinanceOfficialRulesProjection;
};

function toRulesBuildInput(input: OfficialAccountsPayableBuildInput): FinanceAccountsPayableRulesBuildInput {
  return {
    filters: input.filters,
    referenceDate: input.referenceDate,
    syncCutoff: input.syncCutoff,
    year: input.year,
    month: input.month,
    projection: input.projection,
  };
}

/** Executa o motor oficial de regras de Contas a Pagar. */
export function buildOfficialAccountsPayableRulesResult(
  input: OfficialAccountsPayableBuildInput
): FinanceAccountsPayableRulesResult {
  return buildFinanceAccountsPayableRulesResult(input.rows, toRulesBuildInput(input));
}

export type OfficialApMetricsProjection = {
  metrics: FinanceAccountsPayableMetrics;
  cards: FinanceApDashboardCards;
  engineVersion: string;
  projection: "metrics";
};

/**
 * Projeção de métricas oficiais AP — mesmos primitives do dashboard full.
 * Não monta aging, ranking, grid, horizonte nem formatação de apresentação.
 */
export function computeOfficialApMetrics(
  input: OfficialAccountsPayableBuildInput
): OfficialApMetricsProjection {
  const result = buildOfficialAccountsPayableRulesResult({
    ...input,
    projection: "metrics",
  });
  return {
    metrics: result.metrics,
    cards: result.cards,
    engineVersion: result.engineVersion,
    projection: "metrics",
  };
}

export type OfficialAccountsPayableDashboardPayload = FinanceAccountsPayableDashboardPayload & {
  metricsSource: typeof OFFICIAL_AP_RULES_SOURCE;
  rulesEngineVersion: string;
  metrics: FinanceAccountsPayableMetrics;
};

/** Payload da tela Contas a Pagar — cards, horizonte e métricas vêm do motor oficial. */
export function buildOfficialAccountsPayableDashboard(
  input: OfficialAccountsPayableBuildInput
): OfficialAccountsPayableDashboardPayload {
  const rulesResult = buildOfficialAccountsPayableRulesResult(input);
  const dashboard = rulesResult.fullDashboard;

  return {
    ...dashboard,
    cards: rulesResult.cards,
    financialHorizon: rulesResult.horizon,
    dataSanitization: rulesResult.dataSanitization,
    purchaseOrderScheduleAudit: rulesResult.purchaseOrderScheduleAudit,
    metricsSource: OFFICIAL_AP_RULES_SOURCE,
    rulesEngineVersion: rulesResult.engineVersion,
    metrics: rulesResult.metrics,
  };
}

/** Pago por data efetiva — mesma função interna do motor oficial. */
export function sumOfficialApPaidInPaymentPeriod(
  rows: FinanceApDashboardRow[],
  filters: FinanceApDashboardFilters,
  referenceDate: Date,
  syncCutoff: NomusApReportSyncCutoff | null | undefined,
  periodStart: Date,
  periodEnd: Date
): number {
  return sumFinanceApPaidInPaymentPeriod(
    rows,
    filters,
    referenceDate,
    syncCutoff,
    periodStart,
    periodEnd
  );
}

export type OfficialApCashFlowExecutiveMetrics = Pick<
  FinanceAccountsPayableMetrics,
  "paidYtd" | "openUntilYearEnd" | "estimatedYearTotal" | "paidThisMonth" | "openAmount"
>;

/** Métricas AP do resumo executivo do Fluxo de Caixa — motor oficial. */
export function resolveOfficialApCashFlowExecutiveMetrics(
  rows: FinanceApDashboardRow[],
  filters: FinanceApDashboardFilters,
  referenceDate: Date,
  syncCutoff: NomusApReportSyncCutoff | null | undefined,
  year: number
): OfficialApCashFlowExecutiveMetrics {
  const result = computeOfficialApMetrics({
    rows,
    filters,
    referenceDate,
    syncCutoff,
    year,
  });
  return {
    paidYtd: result.metrics.paidYtd,
    openUntilYearEnd: result.metrics.openUntilYearEnd,
    estimatedYearTotal: result.metrics.estimatedYearTotal,
    paidThisMonth: result.metrics.paidThisMonth,
    openAmount: result.metrics.openAmount,
  };
}

export type OfficialApPortfolioFinancialMetrics = {
  source: typeof OFFICIAL_AP_RULES_SOURCE;
  totalPayable: number;
  openAmount: number;
  overdueAmount: number;
  paidThisMonth: number;
};

/** Carteira AP oficial para cards financeiros (Total a pagar, em aberto, vencido, pago no mês). */
export function resolveOfficialApPortfolioFinancialMetrics(
  input: OfficialAccountsPayableBuildInput
): OfficialApPortfolioFinancialMetrics {
  const result = computeOfficialApMetrics(input);
  return {
    source: OFFICIAL_AP_RULES_SOURCE,
    totalPayable: result.metrics.totalPayable,
    openAmount: result.metrics.openAmount,
    overdueAmount: result.metrics.overdueAmount,
    paidThisMonth: result.metrics.paidThisMonth,
  };
}

export {
  filterOfficialApManagementTitles,
  sumOfficialApOpenDueInPeriod,
  type OfficialApMetricScope,
};

export type OfficialNomusAccountsPayableSummaryResponse = {
  generatedAt: string;
  source: typeof OFFICIAL_AP_RULES_SOURCE;
  rulesEngineVersion: string;
  scopeLabel: string;
  summary: AccountsPayableSummary;
};

function resolveOfficialApLastSyncedAt(
  rows: FinanceApDashboardRow[],
  syncCutoff: NomusApReportSyncCutoff | null | undefined
): string | null {
  if (syncCutoff?.maxSyncedAt) return syncCutoff.maxSyncedAt.toISOString();
  let last: Date | null = null;
  for (const row of rows) {
    if (last == null || row.syncedAt > last) last = row.syncedAt;
  }
  return last?.toISOString() ?? null;
}

/**
 * Resumo Nomus compatível — métricas gerenciais oficiais (não Prisma bruto).
 * Escopo: carteira gerencial com saneamento, freshness e vencimento operacional.
 */
export function buildOfficialNomusAccountsPayableSummaryResponse(
  input: OfficialAccountsPayableBuildInput
): OfficialNomusAccountsPayableSummaryResponse {
  const referenceDate = input.referenceDate ?? new Date();
  const filters = input.filters ?? { status: "all" as const };
  const result = buildOfficialAccountsPayableRulesResult(input);

  return {
    generatedAt: new Date().toISOString(),
    source: OFFICIAL_AP_RULES_SOURCE,
    rulesEngineVersion: result.engineVersion,
    scopeLabel:
      "Carteira gerencial oficial — saneamento, freshness Nomus e vencimento operacional",
    summary: {
      total: result.cards.totalRecords,
      open: result.cards.openTitlesCount,
      settled: result.cards.settledTitlesCount,
      totalOpenAmount: result.metrics.openAmount,
      overdueAmount: result.metrics.overdueAmount,
      dueNext7DaysAmount: result.metrics.dueNext7DaysAmount,
      dueNext30DaysAmount: result.metrics.dueNext30DaysAmount,
      paidThisMonthAmount: result.metrics.paidThisMonth,
      lastSyncAt: resolveOfficialApLastSyncedAt(input.rows, input.syncCutoff),
    },
  };
}

export type OfficialApDueRadarPayload = DueRadarPayload & {
  metricsSource: typeof OFFICIAL_AP_RULES_SOURCE;
  rulesEngineVersion: string;
  scopeLabel: string;
};

/** Due-radar AP — títulos filtrados pelo motor; apresentação no helper legado. */
export function buildOfficialApDueRadarPayload(
  rows: FinanceApDashboardRow[],
  query: DueRadarQuery,
  referenceDate: Date = new Date()
): OfficialApDueRadarPayload {
  const payload = buildFinanceApDueRadar(rows, query, referenceDate);
  return {
    ...payload,
    metricsSource: OFFICIAL_AP_RULES_SOURCE,
    rulesEngineVersion: FINANCE_AP_RULES_ENGINE_VERSION,
    scopeLabel: "Radar de pagamentos — vencimento operacional gerencial oficial",
  };
}

/** Base AP oficial para classificação/rateio de Centro de Custo. */
export function filterOfficialApTitlesForCostCenter(
  rows: FinanceApDashboardRow[],
  filters: FinanceApDashboardFilters,
  referenceDate: Date,
  syncCutoff?: NomusApReportSyncCutoff | null
): FinanceApDashboardRow[] {
  return filterOfficialApManagementTitles(rows, filters, referenceDate, syncCutoff);
}

export { FINANCE_AP_RULES_ENGINE_VERSION };
