/**
 * Contratos do motor oficial de regras de Contas a Pagar.
 */

import type { FinanceDataSanitization } from "./financeInternalGroupExclusions.js";
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
  | "openUntilYearEnd"
  | "estimatedYearTotal"
  | "periodPaidAmount"
  | "periodExpectedOutflowAmount";

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
  openUntilYearEnd: number;
  estimatedYearTotal: number;
  periodPaidAmount: number;
  periodExpectedOutflowAmount: number;
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
  dataSanitization: FinanceDataSanitization;
  metricDefinitions: FinanceAccountsPayableMetricDefinition[];
  audit: FinanceAccountsPayableRulesAuditResult;
  fullDashboard: FinanceAccountsPayableDashboardPayload;
};

export type FinanceAccountsPayableRulesBuildInput = {
  filters?: FinanceAccountsPayableRulesFilters;
  referenceDate?: Date;
  syncCutoff?: NomusApReportSyncCutoff | null;
  year?: number;
  month?: number;
};
