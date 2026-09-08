/**
 * Contratos do motor oficial de regras de Contas a Pagar.
 */

import type { FinanceApDashboardSanitization } from "./financeInternalGroupExclusions.js";
import type { FinanceHorizonSummary } from "./financeHorizonAggregation.js";
import type {
  buildFinanceAccountsPayableDashboard,
  FinanceApDashboardFilters,
  FinanceApDashboardRow,
} from "./financeAccountsPayableDashboard.js";
import type {
  FinanceApDashboardCards,
  FinanceApPurchaseOrderScheduleAudit,
} from "./financeAccountsPayableDashboardTypes.js";
import type { NomusApReportSyncCutoff } from "./financeNomusApReportFreshness.js";

export type FinanceApRulesMetricKey =
  | "totalPayable"
  | "paidThisMonth"
  | "paidYtd"
  | "openAmount"
  | "overdueAmount"
  | "dueTodayAmount"
  | "dueNext7DaysAmount"
  | "dueNext30DaysAmount"
  | "dueNext60DaysAmount"
  | "dueNext90DaysAmount"
  | "scheduledOpenAmount"
  | "overdueOpenBeforeBase"
  | "dueTodayOpenInYear"
  | "openUntilYearEnd"
  | "openRemainingObligation"
  | "estimatedYearTotal"
  | "periodPaidAmount"
  | "periodExpectedOutflowAmount"
  | "paidInAppliedPeriod";

export type FinanceAccountsPayableRulesFilters = FinanceApDashboardFilters;

export type FinanceAccountsPayableRulesContext = {
  referenceDate: Date;
  today: Date;
  filters: FinanceAccountsPayableRulesFilters;
  syncCutoff: NomusApReportSyncCutoff | null;
  year: number;
  month: number;
  ytdStart: Date;
  ytdEnd: Date;
  monthStart: Date;
  monthEnd: Date;
  yearEnd: Date;
  forwardFromDate: Date;
  realizedPeriodKind: "month" | "ytd";
  realizedPeriodStart: Date;
  realizedPeriodEnd: Date;
};

export type FinanceAccountsPayableMetricDefinition = {
  key: FinanceApRulesMetricKey;
  label: string;
  description: string;
  valueField: string;
  dateField: string;
  includes: string[];
  excludes: string[];
  dateBasisNote?: string;
};

export type FinanceAccountsPayableMetrics = {
  totalPayable: number;
  paidThisMonth: number;
  paidYtd: number;
  openAmount: number;
  overdueAmount: number;
  dueTodayAmount: number;
  dueNext7DaysAmount: number;
  dueNext30DaysAmount: number;
  dueNext60DaysAmount: number;
  dueNext90DaysAmount: number;
  scheduledOpenAmount: number;
  /**
   * AP_OVERDUE_OPEN — saldo aberto (motor oficial) com vencimento operacional
   * ANTERIOR à data-base, dentro do ano selecionado. Continua alocado na
   * dueDate original (eixo corporativo AP); nunca é deslocado para hoje.
   */
  overdueOpenBeforeBase: number;
  /** AP_DUE_TODAY_OPEN — saldo aberto com vencimento operacional na data-base (dentro do ano). */
  dueTodayOpenInYear: number;
  /**
   * AP_DUE_REMAINING_TO_YEAR_END — "A vencer até 31/12": saldo aberto com
   * vencimento operacional da data-base (inclusive) até 31/12. NÃO inclui
   * vencidos antes da data-base.
   */
  openUntilYearEnd: number;
  /**
   * AP_OPEN_REMAINING_OBLIGATION — "Total ainda a pagar":
   * overdueOpenBeforeBase + openUntilYearEnd (vencido + hoje + a vencer).
   * Obrigação de caixa ainda existente no ano.
   */
  openRemainingObligation: number;
  /** AP_ESTIMATED_YEAR_TOTAL — paidYtd + openRemainingObligation. */
  estimatedYearTotal: number;
  periodPaidAmount: number;
  periodExpectedOutflowAmount: number;
  /**
   * Pago do recorte temporal aplicado, pela data efetiva canônica.
   * Mês explícito → aquele mês; senão YTD oficial. Não usa dueDate.
   */
  paidInAppliedPeriod: number;
  paidInAppliedPeriodKind: "month" | "ytd";
};

export type FinanceAccountsPayableDayBucket = {
  civilDateKey: string;
  dueDate: string;
  amount: number;
  titlesCount: number;
};

export type FinanceAccountsPayableGridRow = {
  externalId: number;
  companyName: string | null;
  personName: string | null;
  personCnpj: string | null;
  dueDate: string | null;
  operationalDueDate: string | null;
  paymentDate: string | null;
  /**
   * Data de liquidação bruta do Nomus (campo separado de `paymentDate`, que
   * o Nomus raramente preenche) — necessária para a regra dos N dias
   * (`resolveFinanceApEffectivePaymentDate`) enxergar a baixa real quando
   * `paymentDate` está ausente.
   */
  settlementDate: string | null;
  amountPayable: number;
  amountPaid: number;
  balancePayable: number;
  calculatedStatus: string;
  daysOverdue: number;
  paymentMethodName: string | null;
  bankAccountName: string | null;
  documentNumber: string | null;
  suspendPayment: boolean | null;
  isRescheduled: boolean;
};

export type FinanceAccountsPayableRulesAuditResult = {
  isFinite: boolean;
  warnings: string[];
  metricsDocumented: number;
  filteredTitlesCount: number;
  openTitlesCount: number;
  settledTitlesCount: number;
};

export type FinanceAccountsPayableDashboardPayload = ReturnType<
  typeof buildFinanceAccountsPayableDashboard
>;

export type FinanceAccountsPayableRulesResult = {
  engineVersion: string;
  generatedAt: string;
  referenceDate: string;
  context: FinanceAccountsPayableRulesContext;
  metrics: FinanceAccountsPayableMetrics;
  cards: FinanceApDashboardCards;
  horizon: FinanceHorizonSummary;
  purchaseOrderScheduleAudit: FinanceApPurchaseOrderScheduleAudit;
  dayBuckets: FinanceAccountsPayableDayBucket[];
  gridRows: FinanceAccountsPayableGridRow[];
  dataSanitization: FinanceApDashboardSanitization;
  metricDefinitions: FinanceAccountsPayableMetricDefinition[];
  audit: FinanceAccountsPayableRulesAuditResult;
  fullDashboard: FinanceAccountsPayableDashboardPayload;
  projection: import("./financeOfficialEngineProjection.js").FinanceOfficialRulesProjection;
};

export type FinanceAccountsPayableRulesBuildInput = {
  filters?: FinanceAccountsPayableRulesFilters;
  referenceDate?: Date;
  syncCutoff?: NomusApReportSyncCutoff | null;
  year?: number;
  month?: number;
  /** `metrics` omite grids/horizonte/aging — mesmos primitives de cards. Default `full`. */
  projection?: import("./financeOfficialEngineProjection.js").FinanceOfficialRulesProjection;
};
