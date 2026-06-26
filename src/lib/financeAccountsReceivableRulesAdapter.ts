/**
 * Adapter fino — transforma o motor oficial de AR para DTOs existentes.
 * Sem regra de negócio: apenas mapeamento, renomeação e compatibilidade de payload.
 */
import {
  sumFinanceArReceivedBySettlementInPeriod,
  type FinanceArDashboardFilters,
  type FinanceArDashboardRow,
} from "./financeAccountsReceivableDashboard.js";
import {
  buildFinanceAccountsReceivableRulesResult,
  FINANCE_AR_RULES_ENGINE_VERSION,
  type FinanceAccountsReceivableDashboardPayload,
  type FinanceAccountsReceivableMetrics,
  type FinanceAccountsReceivableRulesBuildInput,
  type FinanceAccountsReceivableRulesResult,
} from "./financeAccountsReceivableRulesEngine.js";
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
};

function toRulesBuildInput(input: OfficialAccountsReceivableBuildInput): FinanceAccountsReceivableRulesBuildInput {
  return {
    filters: input.filters,
    referenceDate: input.referenceDate,
    syncCutoff: input.syncCutoff,
    horizonSourceRows: input.horizonSourceRows,
    year: input.year,
    month: input.month,
  };
}

/** Executa o motor oficial de regras de Contas a Receber. */
export function buildOfficialAccountsReceivableRulesResult(
  input: OfficialAccountsReceivableBuildInput
): FinanceAccountsReceivableRulesResult {
  return buildFinanceAccountsReceivableRulesResult(input.rows, toRulesBuildInput(input));
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
  const result = buildOfficialAccountsReceivableRulesResult({
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

export { FINANCE_AR_RULES_ENGINE_VERSION };
