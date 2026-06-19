/** Tipos do payload GET /api/finance/accounts-receivable/dashboard */

import type { FinanceDataSanitization } from "./financeInternalGroupExclusions.js";
import type { AccountsReceivableOpenHorizon } from "./financeAccountsReceivableHorizon.js";
import {
  DEFAULT_FINANCE_AR_OVERDUE_UI_FILTERS,
  type FinanceArOverdueUiFilters,
} from "./financeAccountsReceivableOverdueTypes.js";

export type FinanceArDashboardFiltersApplied = {
  companyName?: string;
  personName?: string;
  personCnpj?: string;
  status: string;
  year?: number;
  month?: number;
  dueDateFrom?: Date;
  dueDateTo?: Date;
  paymentMethodName?: string;
  bankAccountName?: string;
  invoiceIssued?: string;
};

export type FinanceArDashboardCards = {
  totalRecords: number;
  /** Σ amountReceivable no universo filtrado. */
  totalAmountReceivable: number;
  /** Σ amountReceived no universo filtrado. */
  totalReceivedAmount: number;
  openTitlesCount: number;
  settledTitlesCount: number;
  totalOpenAmount: number;
  openWithInvoiceCount: number;
  openWithoutInvoiceCount: number;
  openWithInvoiceAmount: number;
  openWithoutInvoiceAmount: number;
  overdueWithInvoiceAmount: number;
  overdueWithoutInvoiceAmount: number;
  preInvoiceShareOfOpenPercent: number;
  overdueAmount: number;
  dueTodayAmount: number;
  upcomingAmount: number;
  dueNext7DaysAmount: number;
  dueNext30DaysAmount: number;
  receivedThisMonthAmount: number;
  delinquencyRate: number;
  overdueCustomersCount: number;
  lastSyncAt: string | null;
  /** Saldo vencido há mais de 30 dias (soma aging overdue31to60 + overdue61to90 + overdue90plus). */
  overdueOver30DaysAmount: number;
  /** Quantidade de títulos vencidos há mais de 30 dias. */
  overdueOver30DaysCount: number;
  /** Dias médios de atraso ponderados por saldo (apenas títulos vencidos com saldo > 0). Null quando não há títulos vencidos. */
  avgDaysOverdue: number | null;
};

export type FinanceArAgingBucket = {
  key: string;
  label: string;
  amount: number;
  count: number;
  customersCount: number;
  percentOfOpenAmount: number;
};

export type FinanceArTopDebtor = {
  personName: string | null;
  personCnpj: string | null;
  totalOpenAmount: number;
  overdueAmount: number;
  upcomingAmount: number;
  titlesCount: number;
  oldestOverdueDate: string | null;
  maxDaysOverdue: number;
  percentOfPortfolio: number;
};

export type FinanceArMonthlyDue = {
  year: number;
  month: number;
  openAmount: number;
  overdueAmount: number;
  upcomingAmount: number;
  titlesCount: number;
};

export type FinanceArPaymentSummary = {
  paymentMethodName: string;
  openAmount: number;
  overdueAmount: number;
  titlesCount: number;
  averageTicket: number;
  delinquencyRate: number;
};

export type FinanceArScheduleBucket = {
  key: string;
  label: string;
  amount: number;
  count: number;
  customersCount: number;
  topClients: Array<{
    personName: string | null;
    personCnpj: string | null;
    amount: number;
  }>;
};

export type FinanceArCustomerRanking = {
  personName: string | null;
  personCnpj: string | null;
  totalOpenAmount: number;
  overdueAmount: number;
  upcomingAmount: number;
  titlesCount: number;
  oldestOverdueDate: string | null;
  maxDaysOverdue: number;
  percentOfPortfolio: number;
  suggestedAction: string;
};

export type FinanceArCriticalTitle = {
  externalId: number;
  companyName: string | null;
  personName: string | null;
  personCnpj: string | null;
  dueDate: string | null;
  amountReceivable: number;
  amountReceived: number;
  balanceReceivable: number;
  paymentMethodName: string | null;
  bankAccountName: string | null;
  sourceInvoiceId: number | null;
  sourceInvoiceNumber: string | null;
  suspendCollection: boolean | null;
  calculatedStatus: string;
  daysOverdue: number;
};

export type FinanceArDataQualityAlerts = {
  missingDueDate: number;
  missingPersonCnpj: number;
  missingPaymentMethod: number;
  negativeBalance: number;
  receivedGreaterThanReceivable: number;
  suspendedCollectionOpen: number;
  overdueOver30Days: number;
  overdueOver60Days: number;
  overdueOver90Days: number;
};

export type FinanceArDataQualityAlertItem = {
  key: string;
  label: string;
  count: number;
  amount: number | null;
  severity: "info" | "warning" | "critical";
};

export type FinanceArDashboardPayload = {
  generatedAt: string;
  referenceDate: string;
  filtersApplied: FinanceArDashboardFiltersApplied;
  source: string;
  cards: FinanceArDashboardCards;
  agingBuckets: FinanceArAgingBucket[];
  topDebtors: FinanceArTopDebtor[];
  monthlyDueSchedule: FinanceArMonthlyDue[];
  paymentMethodSummary: FinanceArPaymentSummary[];
  scheduleBuckets: FinanceArScheduleBucket[];
  customerRanking: FinanceArCustomerRanking[];
  companySummary: Array<{
    companyName: string;
    openAmount: number;
    overdueAmount: number;
    upcomingAmount: number;
    receivedThisMonthAmount: number;
    titlesCount: number;
    customersCount: number;
    delinquencyRate: number;
  }>;
  criticalTitles: FinanceArCriticalTitle[];
  dataQualityAlerts: FinanceArDataQualityAlerts;
  dataQualitySummary: FinanceArDataQualityAlertItem[];
  dataSanitization: FinanceDataSanitization;
  financialHorizon: AccountsReceivableOpenHorizon;
};

export type FinanceArUiFilters = {
  companyName: string;
  personName: string;
  personCnpj: string;
  status: string;
  /** Ano Vencimento — campo `dueDate.year` (NomusAccountsReceivable). */
  year: string;
  /** Mês Vencimento — campo `dueDate.month` (NomusAccountsReceivable). */
  month: string;
  dueDateFrom: string;
  dueDateTo: string;
  /** NF Emitida? — `yes` com NF vinculada, `no` carteira pré-NF. */
  invoiceIssued: string;
  paymentMethodName: string;
  bankAccountName: string;
};

/** Filtros reservados para paridade com BI — não implementados nesta fase. */
export type FinanceArUiFiltersFuture = {
  /** Dia Vencimento */
  dueDay?: string;
  /** Status Baixa */
  settlementStatus?: string;
};

export const FINANCE_AR_FUTURE_FILTER_KEYS = [
  "dueDay",
  "settlementStatus",
] as const satisfies ReadonlyArray<keyof FinanceArUiFiltersFuture>;

export const FINANCE_AR_INVOICE_ISSUED_OPTIONS = [
  { value: "all", label: "Tudo" },
  { value: "yes", label: "Com NF" },
  { value: "no", label: "Sem NF" },
] as const;

export const FINANCE_AR_STATUS_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "open", label: "Em aberto" },
  { value: "overdue", label: "Atrasado" },
  { value: "dueToday", label: "Vence hoje" },
  { value: "upcoming", label: "A vencer" },
  { value: "settled", label: "Baixado" },
  { value: "suspended", label: "Cobrança suspensa" },
] as const;

export const EMPTY_FINANCE_AR_UI_FILTERS: FinanceArUiFilters = {
  companyName: "",
  personName: "",
  personCnpj: "",
  status: "all",
  year: "",
  month: "",
  dueDateFrom: "",
  dueDateTo: "",
  invoiceIssued: "all",
  paymentMethodName: "",
  bankAccountName: "",
};

/** Filtros iniciais seguros: ano corrente como período padrão de vencimento. */
export function createDefaultFinanceArUiFilters(referenceDate = new Date()): FinanceArUiFilters {
  return {
    ...EMPTY_FINANCE_AR_UI_FILTERS,
    year: String(referenceDate.getFullYear()),
  };
}

export function isDefaultFinanceArUiFilters(
  filters: FinanceArUiFilters,
  referenceDate = new Date()
): boolean {
  const defaults = createDefaultFinanceArUiFilters(referenceDate);
  return (
    filters.companyName === defaults.companyName &&
    filters.personName === defaults.personName &&
    filters.personCnpj === defaults.personCnpj &&
    filters.status === defaults.status &&
    filters.year === defaults.year &&
    filters.month === defaults.month &&
    filters.dueDateFrom === defaults.dueDateFrom &&
    filters.dueDateTo === defaults.dueDateTo &&
    filters.invoiceIssued === defaults.invoiceIssued &&
    filters.paymentMethodName === defaults.paymentMethodName &&
    filters.bankAccountName === defaults.bankAccountName
  );
}

export function buildFinanceArYearOptions(referenceYear = new Date().getFullYear()) {
  const options: Array<{ value: string; label: string }> = [{ value: "", label: "Todos" }];
  for (let y = referenceYear + 1; y >= referenceYear - 5; y -= 1) {
    options.push({ value: String(y), label: String(y) });
  }
  return options;
}

export const FINANCE_AR_MONTH_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "1", label: "Janeiro" },
  { value: "2", label: "Fevereiro" },
  { value: "3", label: "Março" },
  { value: "4", label: "Abril" },
  { value: "5", label: "Maio" },
  { value: "6", label: "Junho" },
  { value: "7", label: "Julho" },
  { value: "8", label: "Agosto" },
  { value: "9", label: "Setembro" },
  { value: "10", label: "Outubro" },
  { value: "11", label: "Novembro" },
  { value: "12", label: "Dezembro" },
] as const;

/** Se mês informado sem ano, usa o ano corrente para evitar erro 400 na API. */
export function normalizeFinanceArUiFilters(
  filters: Partial<FinanceArUiFilters> & Pick<FinanceArUiFilters, "status">
): FinanceArUiFilters {
  const merged: FinanceArUiFilters = { ...EMPTY_FINANCE_AR_UI_FILTERS, ...filters };
  const year = merged.year.trim();
  const month = merged.month.trim();
  if (month && !year) {
    return { ...merged, year: String(new Date().getFullYear()), month };
  }
  return merged;
}

export function buildFinanceArTitlesQuery(
  filters: Partial<FinanceArUiFilters> & Pick<FinanceArUiFilters, "status">,
  extras?: {
    page?: number;
    limit?: number;
    sortBy?: string;
    sortDirection?: string;
    search?: string;
    overdueOnly?: boolean;
    qualityAlert?: FinanceArDataQualityAlertKey;
    localFilter?: string;
  }
): string {
  const base = buildFinanceArDashboardQuery(filters);
  const q = new URLSearchParams(base);
  if (extras?.page) q.set("page", String(extras.page));
  if (extras?.limit) q.set("limit", String(extras.limit));
  if (extras?.sortBy) q.set("sortBy", extras.sortBy);
  if (extras?.sortDirection) q.set("sortDirection", extras.sortDirection);
  if (extras?.search?.trim()) q.set("search", extras.search.trim());
  if (extras?.overdueOnly) q.set("overdueOnly", "1");
  if (extras?.qualityAlert) q.set("qualityAlert", extras.qualityAlert);
  if (extras?.localFilter && extras.localFilter !== "all") {
    q.set("localFilter", extras.localFilter);
  }
  return q.toString();
}

/** Abas executivas principais (Objetivo 3). */
export const FINANCE_AR_EXECUTIVE_TABS = [
  { id: "titles", label: "Títulos" },
  { id: "overdue", label: "Atrasados" },
  { id: "customers", label: "Clientes" },
  { id: "aging", label: "Aging" },
  { id: "audit", label: "Auditoria" },
] as const;

export const FINANCE_AR_SECONDARY_TABS = [
  { id: "schedule", label: "Agenda" },
  { id: "payment-methods", label: "Formas de Pagamento" },
  { id: "companies", label: "Empresas" },
] as const;

export const FINANCE_AR_TABS = [
  ...FINANCE_AR_EXECUTIVE_TABS,
  ...FINANCE_AR_SECONDARY_TABS,
] as const;

export type FinanceArTabId = (typeof FINANCE_AR_TABS)[number]["id"];

export type FinanceArDataQualityAlertKey =
  | "missingPersonCnpj"
  | "missingDueDate"
  | "missingPaymentMethod"
  | "negativeBalance"
  | "receivedGreaterThanReceivable"
  | "suspendedCollectionOpen"
  | "overdueOver30Days"
  | "overdueOver60Days"
  | "overdueOver90Days";

export function buildFinanceArExportQuery(
  filters: Partial<FinanceArUiFilters> & Pick<FinanceArUiFilters, "status">
): string {
  const q = buildFinanceArDashboardQuery(filters);
  return q ? `${q}&format=csv` : "format=csv";
}

export function buildFinanceArDashboardQuery(
  filters: Partial<FinanceArUiFilters> & Pick<FinanceArUiFilters, "status">
): string {
  const normalized = normalizeFinanceArUiFilters(filters);
  const q = new URLSearchParams();
  if (normalized.companyName?.trim()) q.set("companyName", normalized.companyName.trim());
  if (normalized.personName?.trim()) q.set("personName", normalized.personName.trim());
  if (normalized.personCnpj?.trim()) q.set("personCnpj", normalized.personCnpj.trim());
  if (normalized.status !== "all") q.set("status", normalized.status);
  if (normalized.year?.trim()) q.set("year", normalized.year.trim());
  if (normalized.month?.trim()) q.set("month", normalized.month.trim());
  if (normalized.dueDateFrom?.trim()) q.set("dueDateFrom", normalized.dueDateFrom.trim());
  if (normalized.dueDateTo?.trim()) q.set("dueDateTo", normalized.dueDateTo.trim());
  if (normalized.invoiceIssued !== "all") q.set("invoiceIssued", normalized.invoiceIssued);
  if (normalized.paymentMethodName?.trim()) {
    q.set("paymentMethodName", normalized.paymentMethodName.trim());
  }
  if (normalized.bankAccountName?.trim()) {
    q.set("bankAccountName", normalized.bankAccountName.trim());
  }
  return q.toString();
}

export function buildFinanceArOverdueQuery(
  globalFilters: Partial<FinanceArUiFilters> & Pick<FinanceArUiFilters, "status">,
  overdueFilters: Partial<FinanceArOverdueUiFilters> = {}
): string {
  const base = buildFinanceArDashboardQuery(globalFilters);
  const q = new URLSearchParams(base);
  const merged = { ...DEFAULT_FINANCE_AR_OVERDUE_UI_FILTERS, ...overdueFilters };
  if (merged.agingBucket.trim()) q.set("agingBucket", merged.agingBucket.trim());
  if (merged.minDaysOverdue.trim()) q.set("minDaysOverdue", merged.minDaysOverdue.trim());
  if (merged.minOpenBalance.trim()) q.set("minOpenBalance", merged.minOpenBalance.trim());
  if (merged.minOverdueTitlesPerCustomer.trim()) {
    q.set("minOverdueTitlesPerCustomer", merged.minOverdueTitlesPerCustomer.trim());
  }
  if (merged.sortBy) q.set("sortBy", merged.sortBy);
  if (merged.sortDirection) q.set("sortDirection", merged.sortDirection);
  if (merged.page.trim()) q.set("page", merged.page.trim());
  if (merged.limit.trim()) q.set("limit", merged.limit.trim());
  return q.toString();
}

export function buildFinanceArOverdueExportQuery(
  globalFilters: Partial<FinanceArUiFilters> & Pick<FinanceArUiFilters, "status">,
  overdueFilters: Partial<FinanceArOverdueUiFilters> = {}
): string {
  return buildFinanceArOverdueQuery(globalFilters, {
    ...overdueFilters,
    limit: "5000",
    page: "1",
  });
}
