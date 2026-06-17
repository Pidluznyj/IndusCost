import type { FinanceArDashboardFilters } from "./financeAccountsReceivableDashboard.js";

export const FINANCE_AR_OVERDUE_AGING_BUCKETS = [
  { key: "overdue1to7", label: "1 a 7 dias", minDays: 1, maxDays: 7 },
  { key: "overdue8to15", label: "8 a 15 dias", minDays: 8, maxDays: 15 },
  { key: "overdue16to30", label: "16 a 30 dias", minDays: 16, maxDays: 30 },
  { key: "overdue31to60", label: "31 a 60 dias", minDays: 31, maxDays: 60 },
  { key: "overdue61to90", label: "61 a 90 dias", minDays: 61, maxDays: 90 },
  { key: "overdue90plus", label: "Acima de 90 dias", minDays: 91, maxDays: null },
] as const;

export type FinanceArOverdueAgingBucketKey =
  (typeof FINANCE_AR_OVERDUE_AGING_BUCKETS)[number]["key"];

export type FinanceArOverdueSortBy =
  | "overdueAmount"
  | "daysOverdue"
  | "customer"
  | "dueDate"
  | "titlesCount";

export type FinanceArOverdueFilters = FinanceArDashboardFilters & {
  agingBucket?: FinanceArOverdueAgingBucketKey;
  minDaysOverdue?: number;
  minOpenBalance?: number;
  minOverdueTitlesPerCustomer?: number;
  sortBy?: FinanceArOverdueSortBy;
  sortDirection?: "asc" | "desc";
  page?: number;
  limit?: number;
};

export type FinanceArOverdueSummary = {
  totalOverdueAmount: number;
  overdueTitlesCount: number;
  overdueCustomersCount: number;
  averageDaysOverdue: number | null;
  maxDaysOverdue: number | null;
  over30Amount: number;
  over60Amount: number;
  over90Amount: number;
  topOverdueCustomer: {
    name: string;
    document?: string;
    amount: number;
  } | null;
};

export type FinanceArOverdueAgingBucket = {
  bucket: string;
  key: FinanceArOverdueAgingBucketKey;
  minDays: number;
  maxDays: number | null;
  titlesCount: number;
  amount: number;
  percent: number;
};

export type FinanceArOverdueCustomerRankingRow = {
  rank: number;
  customerName: string;
  customerDocument?: string;
  titlesCount: number;
  overdueAmount: number;
  oldestDueDate: string | null;
  maxDaysOverdue: number;
  averageDaysOverdue: number | null;
  percentOfTotal: number;
};

export type FinanceArOverdueTitleRow = {
  id: string;
  externalId: number;
  customerName: string;
  customerDocument?: string;
  documentNumber?: string;
  nfeNumber?: string;
  salesOrderNumber?: string;
  dueDate: string;
  daysOverdue: number;
  amountReceivable: number;
  amountReceived: number;
  balanceReceivable: number;
  paymentMethodName?: string;
  companyName?: string;
  sellerName?: string;
  status: string;
  sourceLabel: string;
  description?: string;
};

export type FinanceArOverduePayload = {
  generatedAt: string;
  referenceDate: string;
  filters: FinanceArOverdueFilters;
  appliedFilters: Record<string, string | number | undefined>;
  summary: FinanceArOverdueSummary;
  agingBuckets: FinanceArOverdueAgingBucket[];
  customerRanking: FinanceArOverdueCustomerRankingRow[];
  overdueTitles: FinanceArOverdueTitleRow[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type FinanceArOverdueUiFilters = {
  agingBucket: string;
  minDaysOverdue: string;
  minOpenBalance: string;
  minOverdueTitlesPerCustomer: string;
  sortBy: FinanceArOverdueSortBy;
  sortDirection: "asc" | "desc";
  page: string;
  limit: string;
};

export const DEFAULT_FINANCE_AR_OVERDUE_UI_FILTERS: FinanceArOverdueUiFilters = {
  agingBucket: "",
  minDaysOverdue: "",
  minOpenBalance: "",
  minOverdueTitlesPerCustomer: "",
  sortBy: "overdueAmount",
  sortDirection: "desc",
  page: "1",
  limit: "100",
};
