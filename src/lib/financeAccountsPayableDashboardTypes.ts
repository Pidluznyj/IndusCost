/** Tipos do payload GET /api/finance/accounts-payable/dashboard */

export const FINANCE_AP_SUPPLIER_RANKING_LIMIT = 100;
export const FINANCE_AP_COMPANY_SUMMARY_LIMIT = 50;

export type FinanceApDashboardFiltersApplied = {
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
  documentNumber?: string;
};

export type FinanceApDashboardCards = {
  totalRecords: number;
  totalPayableAmount: number;
  openTitlesCount: number;
  settledTitlesCount: number;
  totalOpenAmount: number;
  overdueAmount: number;
  upcomingAmount: number;
  paidThisMonthAmount: number;
  dueTodayAmount: number;
  dueNext7DaysAmount: number;
  dueNext30DaysAmount: number;
  overdueSuppliersCount: number;
  overduePercent: number;
  topSupplier: {
    personName: string | null;
    personCnpj: string | null;
    totalOpenAmount: number;
  } | null;
  lastSyncAt: string | null;
};

export type FinanceApAgingBucket = {
  key: string;
  label: string;
  amount: number;
  count: number;
  suppliersCount: number;
  percentOfOpenAmount: number;
};

export type FinanceApTopDebtor = {
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

export type FinanceApMonthlyDue = {
  year: number;
  month: number;
  openAmount: number;
  overdueAmount: number;
  upcomingAmount: number;
  titlesCount: number;
};

export type FinanceApPaymentSummary = {
  paymentMethodName: string;
  openAmount: number;
  overdueAmount: number;
  titlesCount: number;
  averageTicket: number;
  overduePercent: number;
};

export type FinanceApScheduleBucket = {
  key: string;
  label: string;
  amount: number;
  count: number;
  suppliersCount: number;
  topClients: Array<{
    personName: string | null;
    personCnpj: string | null;
    amount: number;
  }>;
};

export type FinanceApSupplierRanking = {
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

export type FinanceApCriticalTitle = {
  externalId: number;
  companyName: string | null;
  personName: string | null;
  personCnpj: string | null;
  dueDate: string | null;
  amountPayable: number;
  amountPaid: number;
  balancePayable: number;
  paymentMethodName: string | null;
  bankAccountName: string | null;
  sourceInvoiceId: number | null;
  documentNumber: string | null;
  suspendPayment: boolean | null;
  calculatedStatus: string;
  daysOverdue: number;
};

export type FinanceApDataQualityAlerts = {
  missingDueDate: number;
  missingPersonCnpj: number;
  missingPaymentMethod: number;
  negativeBalance: number;
  paidGreaterThanPayable: number;
  suspendedPaymentOpen: number;
  overdueOver30Days: number;
  overdueOver60Days: number;
  overdueOver90Days: number;
};

export type FinanceApDataQualityAlertItem = {
  key: string;
  label: string;
  count: number;
  amount: number | null;
  severity: "info" | "warning" | "critical";
};

export type FinanceApDashboardPayload = {
  generatedAt: string;
  referenceDate: string;
  filtersApplied: FinanceApDashboardFiltersApplied;
  source: string;
  cards: FinanceApDashboardCards;
  agingBuckets: FinanceApAgingBucket[];
  topSuppliers: FinanceApTopDebtor[];
  monthlyDueSchedule: FinanceApMonthlyDue[];
  paymentMethodSummary: FinanceApPaymentSummary[];
  scheduleBuckets: FinanceApScheduleBucket[];
  supplierRanking: FinanceApSupplierRanking[];
  companySummary: Array<{
    companyName: string;
    openAmount: number;
    overdueAmount: number;
    upcomingAmount: number;
    paidThisMonthAmount: number;
    titlesCount: number;
    suppliersCount: number;
    overduePercent: number;
  }>;
  criticalTitles: FinanceApCriticalTitle[];
  dataQualityAlerts: FinanceApDataQualityAlerts;
  dataQualitySummary: FinanceApDataQualityAlertItem[];
};

export type FinanceApUiFilters = {
  companyName: string;
  personName: string;
  personCnpj: string;
  status: string;
  /** Ano Vencimento — campo `dueDate.year` (NomusAccountsPayable). */
  year: string;
  /** Mês Vencimento — campo `dueDate.month` (NomusAccountsPayable). */
  month: string;
  dueDateFrom: string;
  dueDateTo: string;
  documentQuery: string;
  suspendPayment: string;
  paymentMethodName: string;
  bankAccountName: string;
};

/** Filtros reservados para paridade com BI — não implementados nesta fase. */
export type FinanceApUiFiltersFuture = {
  /** Dia Vencimento */
  dueDay?: string;
  /** Status Baixa */
  settlementStatus?: string;
};

export const FINANCE_AP_FUTURE_FILTER_KEYS = [
  "dueDay",
  "settlementStatus",
] as const satisfies ReadonlyArray<keyof FinanceApUiFiltersFuture>;

export const FINANCE_AP_SUSPEND_PAYMENT_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "yes", label: "Sim" },
  { value: "no", label: "Não" },
] as const;

export const FINANCE_AP_STATUS_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "open", label: "Em aberto" },
  { value: "overdue", label: "Atrasado" },
  { value: "dueToday", label: "Vence hoje" },
  { value: "upcoming", label: "A vencer" },
  { value: "settled", label: "Pago/Baixado" },
  { value: "suspended", label: "Pagamento suspenso" },
] as const;

export const EMPTY_FINANCE_AP_UI_FILTERS: FinanceApUiFilters = {
  companyName: "",
  personName: "",
  personCnpj: "",
  status: "all",
  year: "",
  month: "",
  dueDateFrom: "",
  dueDateTo: "",
  documentQuery: "",
  suspendPayment: "all",
  paymentMethodName: "",
  bankAccountName: "",
};

/** Filtros iniciais seguros: ano corrente como período padrão de vencimento. */
export function createDefaultFinanceApUiFilters(referenceDate = new Date()): FinanceApUiFilters {
  return {
    ...EMPTY_FINANCE_AP_UI_FILTERS,
    year: String(referenceDate.getFullYear()),
  };
}

export function formatFinanceApPeriodLabel(
  filters: FinanceApUiFilters,
  referenceDate = new Date()
): string {
  const year = filters.year.trim();
  const month = filters.month.trim();
  if (filters.dueDateFrom.trim() || filters.dueDateTo.trim()) {
    const from = filters.dueDateFrom.trim() || "…";
    const to = filters.dueDateTo.trim() || "…";
    return `${from} até ${to}`;
  }
  if (month && year) {
    const monthLabel =
      FINANCE_AP_MONTH_OPTIONS.find((o) => o.value === month)?.label ?? `Mês ${month}`;
    return `${monthLabel} de ${year}`;
  }
  if (year) return `Ano ${year}`;
  return "Todos os períodos";
}

export function hasPendingFinanceApFilterChanges(
  draft: FinanceApUiFilters,
  applied: FinanceApUiFilters
): boolean {
  return (
    buildFinanceApDashboardQuery(normalizeFinanceApUiFilters(draft)) !==
    buildFinanceApDashboardQuery(normalizeFinanceApUiFilters(applied))
  );
}

export function isDefaultFinanceApUiFilters(
  filters: FinanceApUiFilters,
  referenceDate = new Date()
): boolean {
  const defaults = createDefaultFinanceApUiFilters(referenceDate);
  return (
    filters.companyName === defaults.companyName &&
    filters.personName === defaults.personName &&
    filters.personCnpj === defaults.personCnpj &&
    filters.status === defaults.status &&
    filters.year === defaults.year &&
    filters.month === defaults.month &&
    filters.dueDateFrom === defaults.dueDateFrom &&
    filters.dueDateTo === defaults.dueDateTo &&
    filters.documentQuery === defaults.documentQuery &&
    filters.suspendPayment === defaults.suspendPayment &&
    filters.paymentMethodName === defaults.paymentMethodName &&
    filters.bankAccountName === defaults.bankAccountName
  );
}

export function buildFinanceApYearOptions(referenceYear = new Date().getFullYear()) {
  const options: Array<{ value: string; label: string }> = [{ value: "", label: "Todos" }];
  for (let y = referenceYear + 1; y >= referenceYear - 5; y -= 1) {
    options.push({ value: String(y), label: String(y) });
  }
  return options;
}

export const FINANCE_AP_MONTH_OPTIONS = [
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
export function normalizeFinanceApUiFilters(filters: FinanceApUiFilters): FinanceApUiFilters {
  const year = filters.year.trim();
  const month = filters.month.trim();
  if (month && !year) {
    return { ...filters, year: String(new Date().getFullYear()), month };
  }
  return filters;
}

export function buildFinanceApTitlesQuery(
  filters: FinanceApUiFilters,
  extras?: {
    page?: number;
    limit?: number;
    sortBy?: string;
    sortDirection?: string;
    search?: string;
    overdueOnly?: boolean;
    qualityAlert?: FinanceApDataQualityAlertKey;
  }
): string {
  const base = buildFinanceApDashboardQuery(filters);
  const q = new URLSearchParams(base);
  if (extras?.page) q.set("page", String(extras.page));
  if (extras?.limit) q.set("limit", String(extras.limit));
  if (extras?.sortBy) q.set("sortBy", extras.sortBy);
  if (extras?.sortDirection) q.set("sortDirection", extras.sortDirection);
  if (extras?.search?.trim()) q.set("search", extras.search.trim());
  if (extras?.overdueOnly) q.set("overdueOnly", "1");
  if (extras?.qualityAlert) q.set("qualityAlert", extras.qualityAlert);
  return q.toString();
}

export const FINANCE_AP_TABS = [
  { id: "overview", label: "Visão Geral" },
  { id: "aging", label: "Aging" },
  { id: "schedule", label: "Agenda de Pagamentos" },
  { id: "suppliers", label: "Fornecedores" },
  { id: "titles", label: "Títulos" },
  { id: "payment-methods", label: "Formas de Pagamento" },
  { id: "companies", label: "Empresas" },
] as const;

export type FinanceApTabId = (typeof FINANCE_AP_TABS)[number]["id"];

export type FinanceApDataQualityAlertKey =
  | "missingPersonCnpj"
  | "missingDueDate"
  | "missingPaymentMethod"
  | "negativeBalance"
  | "paidGreaterThanPayable"
  | "suspendedPaymentOpen"
  | "overdueOver30Days"
  | "overdueOver60Days"
  | "overdueOver90Days";

export function buildFinanceApExportQuery(filters: FinanceApUiFilters): string {
  const q = buildFinanceApDashboardQuery(filters);
  return q ? `${q}&format=csv` : "format=csv";
}

export function buildFinanceApDashboardQuery(filters: FinanceApUiFilters): string {
  const normalized = normalizeFinanceApUiFilters(filters);
  const q = new URLSearchParams();
  if (normalized.companyName.trim()) q.set("companyName", normalized.companyName.trim());
  if (normalized.personName.trim()) q.set("personName", normalized.personName.trim());
  if (normalized.personCnpj.trim()) q.set("personCnpj", normalized.personCnpj.trim());
  if (normalized.status !== "all") q.set("status", normalized.status);
  if (normalized.year.trim()) {
    q.set("year", normalized.year.trim());
  } else {
    q.set("period", "all");
  }
  if (normalized.month.trim()) q.set("month", normalized.month.trim());
  if (normalized.dueDateFrom.trim()) q.set("dueDateFrom", normalized.dueDateFrom.trim());
  if (normalized.dueDateTo.trim()) q.set("dueDateTo", normalized.dueDateTo.trim());
  if (normalized.documentQuery.trim()) q.set("documentQuery", normalized.documentQuery.trim());
  if (normalized.suspendPayment !== "all") q.set("suspendPayment", normalized.suspendPayment);
  if (normalized.paymentMethodName.trim()) {
    q.set("paymentMethodName", normalized.paymentMethodName.trim());
  }
  if (normalized.bankAccountName.trim()) q.set("bankAccountName", normalized.bankAccountName.trim());
  return q.toString();
}
