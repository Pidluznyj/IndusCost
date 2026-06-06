/** Tipos do payload GET /api/finance/accounts-receivable/dashboard */

export type FinanceArDashboardFiltersApplied = {
  companyName?: string;
  personName?: string;
  personCnpj?: string;
  status: string;
  dueDateFrom?: Date;
  dueDateTo?: Date;
  paymentMethodName?: string;
  bankAccountName?: string;
};

export type FinanceArDashboardCards = {
  totalRecords: number;
  openTitlesCount: number;
  settledTitlesCount: number;
  totalOpenAmount: number;
  overdueAmount: number;
  dueTodayAmount: number;
  upcomingAmount: number;
  dueNext7DaysAmount: number;
  dueNext30DaysAmount: number;
  receivedThisMonthAmount: number;
  delinquencyRate: number;
  overdueCustomersCount: number;
  lastSyncAt: string | null;
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
  missingSourceInvoice: number;
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
};

export type FinanceArUiFilters = {
  companyName: string;
  personName: string;
  personCnpj: string;
  status: string;
  dueDateFrom: string;
  dueDateTo: string;
  paymentMethodName: string;
  bankAccountName: string;
};

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
  dueDateFrom: "",
  dueDateTo: "",
  paymentMethodName: "",
  bankAccountName: "",
};

export function buildFinanceArTitlesQuery(
  filters: FinanceArUiFilters,
  extras?: {
    page?: number;
    limit?: number;
    sortBy?: string;
    sortDirection?: string;
    search?: string;
    overdueOnly?: boolean;
    qualityAlert?: FinanceArDataQualityAlertKey;
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
  return q.toString();
}

export const FINANCE_AR_TABS = [
  { id: "overview", label: "Visão Geral" },
  { id: "aging", label: "Aging" },
  { id: "schedule", label: "Agenda" },
  { id: "customers", label: "Clientes" },
  { id: "titles", label: "Títulos" },
  { id: "payment-methods", label: "Formas de Pagamento" },
  { id: "companies", label: "Empresas" },
] as const;

export type FinanceArTabId = (typeof FINANCE_AR_TABS)[number]["id"];

export type FinanceArDataQualityAlertKey =
  | "missingPersonCnpj"
  | "missingDueDate"
  | "missingPaymentMethod"
  | "negativeBalance"
  | "receivedGreaterThanReceivable"
  | "suspendedCollectionOpen"
  | "missingSourceInvoice"
  | "overdueOver30Days"
  | "overdueOver60Days"
  | "overdueOver90Days";

export function buildFinanceArExportQuery(filters: FinanceArUiFilters): string {
  const q = buildFinanceArDashboardQuery(filters);
  return q ? `${q}&format=csv` : "format=csv";
}

export function buildFinanceArDashboardQuery(filters: FinanceArUiFilters): string {
  const q = new URLSearchParams();
  if (filters.companyName.trim()) q.set("companyName", filters.companyName.trim());
  if (filters.personName.trim()) q.set("personName", filters.personName.trim());
  if (filters.personCnpj.trim()) q.set("personCnpj", filters.personCnpj.trim());
  if (filters.status !== "all") q.set("status", filters.status);
  if (filters.dueDateFrom.trim()) q.set("dueDateFrom", filters.dueDateFrom.trim());
  if (filters.dueDateTo.trim()) q.set("dueDateTo", filters.dueDateTo.trim());
  if (filters.paymentMethodName.trim()) q.set("paymentMethodName", filters.paymentMethodName.trim());
  if (filters.bankAccountName.trim()) q.set("bankAccountName", filters.bankAccountName.trim());
  return q.toString();
}
