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
  FINANCE_AP_RULES_ENGINE_VERSION,
  type FinanceAccountsPayableDashboardPayload,
  type FinanceAccountsPayableMetrics,
  type FinanceAccountsPayableRulesBuildInput,
  type FinanceAccountsPayableRulesResult,
} from "./financeAccountsPayableRulesEngine.js";
import type { NomusApReportSyncCutoff } from "./financeNomusApReportFreshness.js";

export const OFFICIAL_AP_RULES_SOURCE = "official-accounts-payable-rules-engine" as const;

export type OfficialAccountsPayableBuildInput = {
  rows: FinanceApDashboardRow[];
  filters?: FinanceApDashboardFilters;
  referenceDate?: Date;
  syncCutoff?: NomusApReportSyncCutoff | null;
  year?: number;
  month?: number;
};

function toRulesBuildInput(input: OfficialAccountsPayableBuildInput): FinanceAccountsPayableRulesBuildInput {
  return {
    filters: input.filters,
    referenceDate: input.referenceDate,
    syncCutoff: input.syncCutoff,
    year: input.year,
    month: input.month,
  };
}

/** Executa o motor oficial de regras de Contas a Pagar. */
export function buildOfficialAccountsPayableRulesResult(
  input: OfficialAccountsPayableBuildInput
): FinanceAccountsPayableRulesResult {
  return buildFinanceAccountsPayableRulesResult(input.rows, toRulesBuildInput(input));
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
  const result = buildOfficialAccountsPayableRulesResult({
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

export { FINANCE_AP_RULES_ENGINE_VERSION };
