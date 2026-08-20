/**
 * Contratos do motor oficial de regras de Contas a Receber.
 * Consumidores futuros (telas, relatórios, exportações) devem usar estes tipos.
 */

import type { FinanceArDashboardSanitization } from "./financeInternalGroupExclusions.js";
import type { AccountsReceivableOpenHorizon } from "./financeAccountsReceivableHorizon.js";
import type {
  buildFinanceAccountsReceivableDashboard,
  FinanceArDashboardFilters,
  FinanceArDashboardRow,
  FinanceArTitleStatus,
} from "./financeAccountsReceivableDashboard.js";
import type { FinanceArDashboardCards } from "./financeAccountsReceivableDashboardTypes.js";
import type { NomusArReportSyncCutoff } from "./financeNomusArReportFreshness.js";

export type FinanceArEffectiveStatus = "OPEN" | "SETTLED" | "SUSPENDED" | "UNKNOWN";

export type FinanceArRulesDateRole =
  | "dueDate"
  | "settlementDate"
  | "competenceDate"
  | "operationalDueDate";

export type FinanceArRulesMetricKey =
  | "totalReceivable"
  | "receivedThisMonth"
  | "receivedYtd"
  | "openAmount"
  | "overdueAmount"
  | "dueTodayAmount"
  | "dueNext7DaysAmount"
  | "dueNext30DaysAmount"
  | "dueNext60DaysAmount"
  | "dueNext90DaysAmount"
  | "openWithInvoiceAmount"
  | "openWithoutInvoiceAmount"
  | "openUntilYearEnd"
  | "estimatedYearTotal"
  | "periodReceivedAmount"
  | "periodExpectedInflowAmount";

export type FinanceArRulesInput = {
  externalId?: number;
  companyName?: string | null;
  personId?: number | null;
  personName?: string | null;
  personCnpj?: string | null;
  description?: string | null;
  comments?: string | null;
  dueDate?: Date | null;
  competenceDate?: Date | null;
  settlementDate?: Date | null;
  amountReceivable?: number;
  amountReceived?: number;
  balanceReceivable?: number;
  paymentMethodName?: string | null;
  bankAccountName?: string | null;
  sourceInvoiceId?: number | null;
  sourceInvoiceNumber?: string | null;
  suspendCollection?: boolean | null;
  nomusStatus?: boolean | null;
  syncedAt?: Date;
};

export type NormalizedAccountsReceivableTitle = {
  id: number | null;
  dueDate: Date | null;
  /** Chave civil yyyy-mm-dd — preserva o dia sem deslocar por fuso. */
  dueDateCivilKey: string | null;
  settlementDate: Date | null;
  competenceDate: Date | null;
  /** Data operacional gerencial para aging/agenda — dia civil do vencimento. */
  operationalDueDate: Date | null;
  effectiveStatus: FinanceArEffectiveStatus;
  amountReceivable: number;
  amountReceived: number;
  openAmount: number;
  isOpen: boolean;
  isSettled: boolean;
  isSuspended: boolean;
  hasSourceInvoice: boolean;
  calculatedStatus: Exclude<FinanceArTitleStatus, "all"> | "unknown";
};

export type FinanceAccountsReceivableRulesFilters = FinanceArDashboardFilters;

export type FinanceAccountsReceivableRulesContext = {
  referenceDate: Date;
  today: Date;
  filters: FinanceAccountsReceivableRulesFilters;
  syncCutoff: NomusArReportSyncCutoff | null;
  year: number;
  month: number;
  ytdStart: Date;
  ytdEnd: Date;
  monthStart: Date;
  monthEnd: Date;
  yearEnd: Date;
  forwardFromDate: Date;
};

export type FinanceAccountsReceivableMetricDefinition = {
  key: FinanceArRulesMetricKey;
  label: string;
  description: string;
  valueField: string;
  dateField: string;
  includes: string[];
  excludes: string[];
  /** Escopo de data usado — settlementDate para recebido, dueDate para carteira aberta. */
  dateBasisNote?: string;
};

export type FinanceAccountsReceivableMetrics = {
  totalReceivable: number;
  receivedThisMonth: number;
  receivedYtd: number;
  openAmount: number;
  overdueAmount: number;
  dueTodayAmount: number;
  dueNext7DaysAmount: number;
  dueNext30DaysAmount: number;
  dueNext60DaysAmount: number;
  dueNext90DaysAmount: number;
  openWithInvoiceAmount: number;
  openWithoutInvoiceAmount: number;
  openWithInvoiceCount: number;
  openWithoutInvoiceCount: number;
  openUntilYearEnd: number;
  estimatedYearTotal: number;
  periodReceivedAmount: number;
  periodExpectedInflowAmount: number;
};

export type FinanceAccountsReceivableHorizonBucket = AccountsReceivableOpenHorizon["buckets"][number];

export type FinanceAccountsReceivableDayBucket = {
  civilDateKey: string;
  dueDate: string;
  amount: number;
  titlesCount: number;
};

export type FinanceAccountsReceivableGridRow = {
  externalId: number;
  companyName: string | null;
  personName: string | null;
  personCnpj: string | null;
  dueDate: string | null;
  settlementDate: string | null;
  amountReceivable: number;
  amountReceived: number;
  balanceReceivable: number;
  hasSourceInvoice: boolean;
  calculatedStatus: string;
  daysOverdue: number;
  paymentMethodName: string | null;
  bankAccountName: string | null;
  sourceInvoiceId: number | null;
  sourceInvoiceNumber: string | null;
  suspendCollection: boolean | null;
};

export type FinanceAccountsReceivableRulesAuditResult = {
  isFinite: boolean;
  warnings: string[];
  metricsDocumented: number;
  filteredTitlesCount: number;
  openTitlesCount: number;
  settledTitlesCount: number;
};

export type FinanceAccountsReceivableDashboardPayload = ReturnType<
  typeof buildFinanceAccountsReceivableDashboard
>;

export type FinanceAccountsReceivableRulesResult = {
  engineVersion: string;
  generatedAt: string;
  referenceDate: string;
  context: FinanceAccountsReceivableRulesContext;
  metrics: FinanceAccountsReceivableMetrics;
  /** Payload espelhando cards oficiais do dashboard AR — compatibilidade garantida. */
  cards: FinanceArDashboardCards;
  horizon: AccountsReceivableOpenHorizon;
  dayBuckets: FinanceAccountsReceivableDayBucket[];
  gridRows: FinanceAccountsReceivableGridRow[];
  dataSanitization: FinanceArDashboardSanitization;
  metricDefinitions: FinanceAccountsReceivableMetricDefinition[];
  audit: FinanceAccountsReceivableRulesAuditResult;
  /** Payload completo da tela AR — reutilizado pelo adapter sem recalcular regras. */
  fullDashboard: FinanceAccountsReceivableDashboardPayload;
  projection: import("./financeOfficialEngineProjection.js").FinanceOfficialRulesProjection;
};

export type FinanceAccountsReceivableRulesBuildInput = {
  filters?: FinanceAccountsReceivableRulesFilters;
  referenceDate?: Date;
  syncCutoff?: NomusArReportSyncCutoff | null;
  year?: number;
  month?: number;
  horizonSourceRows?: FinanceArDashboardRow[];
  /** `metrics` omite grids/horizonte/aging — mesmos primitives de cards. Default `full`. */
  projection?: import("./financeOfficialEngineProjection.js").FinanceOfficialRulesProjection;
};
