/**
 * Adapter fino — transforma o motor oficial de AR para DTOs existentes.
 * Sem regra de negócio: apenas mapeamento, renomeação e compatibilidade de payload.
 */
import {
  addLocalDays,
  sumFinanceArReceivedBySettlementInPeriod,
  startOfLocalDay,
  type FinanceArDashboardFilters,
  type FinanceArDashboardRow,
} from "./financeAccountsReceivableDashboard.js";
import {
  buildFinanceAccountsReceivableRulesResult,
  countOfficialArOpenDueInPeriod,
  filterOfficialArOverdueTitles,
  FINANCE_AR_RULES_ENGINE_VERSION,
  sumOfficialArOpenDueInPeriod,
  type FinanceAccountsReceivableDashboardPayload,
  type FinanceAccountsReceivableMetrics,
  type FinanceAccountsReceivableRulesBuildInput,
  type FinanceAccountsReceivableRulesResult,
  type OfficialArMetricScope,
} from "./financeAccountsReceivableRulesEngine.js";
import type { FinanceArDashboardCards } from "./financeAccountsReceivableDashboardTypes.js";
import type { FinanceOfficialRulesProjection } from "./financeOfficialEngineProjection.js";
import {
  buildFinanceArOverduePayload,
  type FinanceArOverdueFilters,
} from "./financeAccountsReceivableOverdue.js";
import type { AccountsReceivableSummary } from "./nomusAccountsReceivableSummary.js";
import type { FinanceArOverduePayload } from "./financeAccountsReceivableOverdueTypes.js";
import type { NomusArReportSyncCutoff } from "./financeNomusArReportFreshness.js";

export const OFFICIAL_AR_RULES_SOURCE = "official-accounts-receivable-rules-engine" as const;

export type OfficialAccountsReceivableBuildInput = {
  rows: FinanceArDashboardRow[];
  filters?: FinanceArDashboardFilters;
  referenceDate?: Date;
  syncCutoff?: NomusArReportSyncCutoff | null;
  horizonSourceRows?: FinanceArDashboardRow[];
  year?: number;
  month?: number;
  projection?: FinanceOfficialRulesProjection;
};

function toRulesBuildInput(input: OfficialAccountsReceivableBuildInput): FinanceAccountsReceivableRulesBuildInput {
  return {
    filters: input.filters,
    referenceDate: input.referenceDate,
    syncCutoff: input.syncCutoff,
    horizonSourceRows: input.horizonSourceRows,
    year: input.year,
    month: input.month,
    projection: input.projection,
  };
}

/** Executa o motor oficial de regras de Contas a Receber. */
export function buildOfficialAccountsReceivableRulesResult(
  input: OfficialAccountsReceivableBuildInput
): FinanceAccountsReceivableRulesResult {
  return buildFinanceAccountsReceivableRulesResult(input.rows, toRulesBuildInput(input));
}

export type OfficialArMetricsProjection = {
  metrics: FinanceAccountsReceivableMetrics;
  cards: FinanceArDashboardCards;
  engineVersion: string;
  projection: "metrics";
};

/**
 * Projeção de métricas oficiais AR — mesmos primitives do dashboard full.
 * Não monta aging, ranking, grid, horizonte nem formatação de apresentação.
 */
export function computeOfficialArMetrics(
  input: OfficialAccountsReceivableBuildInput
): OfficialArMetricsProjection {
  const result = buildOfficialAccountsReceivableRulesResult({
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

export type OfficialAccountsReceivableDashboardPayload = FinanceAccountsReceivableDashboardPayload & {
  metricsSource: typeof OFFICIAL_AR_RULES_SOURCE;
  rulesEngineVersion: string;
  metrics: FinanceAccountsReceivableMetrics;
};

/**
 * Payload da tela Contas a Receber — cards, horizonte e métricas vêm do motor oficial.
 * Demais campos (rankings, aging, criticalTitles) são apresentação do fullDashboard interno.
 */
export function buildOfficialAccountsReceivableDashboard(
  input: OfficialAccountsReceivableBuildInput
): OfficialAccountsReceivableDashboardPayload {
  const rulesResult = buildOfficialAccountsReceivableRulesResult(input);
  const dashboard = rulesResult.fullDashboard;

  return {
    ...dashboard,
    cards: rulesResult.cards,
    financialHorizon: rulesResult.horizon,
    dataSanitization: rulesResult.dataSanitization,
    metricsSource: OFFICIAL_AR_RULES_SOURCE,
    rulesEngineVersion: rulesResult.engineVersion,
    metrics: rulesResult.metrics,
  };
}

/** Recebido por settlementDate — mesma função interna do motor oficial (sem recalcular regra). */
export function sumOfficialArReceivedBySettlementInPeriod(
  rows: FinanceArDashboardRow[],
  filters: FinanceArDashboardFilters,
  referenceDate: Date,
  syncCutoff: NomusArReportSyncCutoff | null | undefined,
  periodStart: Date,
  periodEnd: Date
): number {
  return sumFinanceArReceivedBySettlementInPeriod(
    rows,
    filters,
    referenceDate,
    syncCutoff,
    periodStart,
    periodEnd
  );
}

export type OfficialArCashFlowExecutiveMetrics = Pick<
  FinanceAccountsReceivableMetrics,
  "receivedYtd" | "openUntilYearEnd" | "estimatedYearTotal" | "receivedThisMonth" | "openAmount"
>;

/** Métricas AR do resumo executivo do Fluxo de Caixa — motor oficial. */
export function resolveOfficialArCashFlowExecutiveMetrics(
  rows: FinanceArDashboardRow[],
  filters: FinanceArDashboardFilters,
  referenceDate: Date,
  syncCutoff: NomusArReportSyncCutoff | null | undefined,
  year: number
): OfficialArCashFlowExecutiveMetrics {
  const result = computeOfficialArMetrics({
    rows,
    filters,
    referenceDate,
    syncCutoff,
    year,
  });
  return {
    receivedYtd: result.metrics.receivedYtd,
    openUntilYearEnd: result.metrics.openUntilYearEnd,
    estimatedYearTotal: result.metrics.estimatedYearTotal,
    receivedThisMonth: result.metrics.receivedThisMonth,
    openAmount: result.metrics.openAmount,
  };
}

export { sumOfficialArOpenDueInPeriod, type OfficialArMetricScope };

export type OfficialNomusAccountsReceivableSummaryResponse = {
  generatedAt: string;
  source: typeof OFFICIAL_AR_RULES_SOURCE;
  rulesEngineVersion: string;
  scopeLabel: string;
  summary: AccountsReceivableSummary;
};

function resolveOfficialArLastSyncedAt(
  rows: FinanceArDashboardRow[],
  syncCutoff: NomusArReportSyncCutoff | null | undefined
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
 * Escopo: carteira gerencial com saneamento, freshness e regras de NF.
 */
export function buildOfficialNomusAccountsReceivableSummaryResponse(
  input: OfficialAccountsReceivableBuildInput
): OfficialNomusAccountsReceivableSummaryResponse {
  const referenceDate = input.referenceDate ?? new Date();
  const filters = input.filters ?? { status: "all" as const };
  const result = buildOfficialAccountsReceivableRulesResult(input);
  const today = startOfLocalDay(referenceDate);
  const in30Days = addLocalDays(today, 30);
  const scope: OfficialArMetricScope = {
    filters,
    referenceDate,
    syncCutoff: input.syncCutoff,
  };
  const overdueRows = filterOfficialArOverdueTitles(
    input.rows,
    filters,
    referenceDate,
    input.syncCutoff
  );

  return {
    generatedAt: new Date().toISOString(),
    source: OFFICIAL_AR_RULES_SOURCE,
    rulesEngineVersion: result.engineVersion,
    scopeLabel:
      "Carteira gerencial oficial — saneamento, freshness Nomus e vencidos com regra de NF",
    summary: {
      totalRecords: result.cards.totalRecords,
      openCount: result.cards.openTitlesCount,
      settledCount: result.cards.settledTitlesCount,
      totalBalanceReceivable: result.metrics.openAmount,
      totalAmountReceived: result.cards.totalReceivedAmount,
      totalAmountReceivable: result.metrics.totalReceivable,
      overdueCount: overdueRows.length,
      overdueBalance: result.metrics.overdueAmount,
      dueNext30DaysCount: countOfficialArOpenDueInPeriod(input.rows, today, in30Days, scope),
      dueNext30DaysBalance: result.metrics.dueNext30DaysAmount,
      lastSyncedAt: resolveOfficialArLastSyncedAt(input.rows, input.syncCutoff),
    },
  };
}

export type OfficialAccountsReceivableOverduePayload = FinanceArOverduePayload & {
  metricsSource: typeof OFFICIAL_AR_RULES_SOURCE;
  rulesEngineVersion: string;
  scopeLabel: string;
};

/** Atrasados gerenciais — seleção pelo motor; apresentação (aging, paginação) no helper legado. */
export function buildOfficialAccountsReceivableOverduePayload(
  rows: FinanceArDashboardRow[],
  filters: FinanceArOverdueFilters,
  referenceDate: Date = new Date(),
  syncCutoff?: NomusArReportSyncCutoff | null,
  options?: { paginate?: boolean }
): OfficialAccountsReceivableOverduePayload {
  const payload = buildFinanceArOverduePayload(rows, filters, referenceDate, syncCutoff, options);
  return {
    ...payload,
    metricsSource: OFFICIAL_AR_RULES_SOURCE,
    rulesEngineVersion: FINANCE_AR_RULES_ENGINE_VERSION,
    scopeLabel: "Atrasados gerenciais — vencidos com regra oficial de NF e saneamento",
  };
}

export { FINANCE_AR_RULES_ENGINE_VERSION };
