/** Tipos — Clientes compradores de um produto vendido. */

import type { SoldProductsDashboardFiltersApplied } from "./salesProductRankingTypes.js";

export type SoldProductCustomersFiltersApplied = SoldProductsDashboardFiltersApplied & {
  minQuantity?: number;
  minRevenue?: number;
  minDaysSinceLastPurchase?: number;
  maxDaysSinceLastPurchase?: number;
  state?: string;
  region?: string;
  activityFilter: SoldProductCustomersActivityFilter;
  onlyWithoutOverdue: boolean;
  customerSortBy: SoldProductCustomersSortBy;
  customerSortDirection: SoldProductCustomersSortDirection;
  customerTopN: number | null;
};

export type SoldProductCustomersSortBy =
  | "customerName"
  | "totalRevenue"
  | "quantity"
  | "lastPurchaseDate"
  | "averageUnitPrice"
  | "daysSinceLastPurchase";

export type SoldProductCustomersSortDirection = "asc" | "desc";

export type SoldProductCustomersActivityFilter = "all" | "active" | "inactive";

export type SoldProductCustomersQueryFilters = {
  minQuantity?: number;
  minRevenue?: number;
  minDaysSinceLastPurchase?: number;
  maxDaysSinceLastPurchase?: number;
  state?: string;
  region?: string;
  activityFilter: SoldProductCustomersActivityFilter;
  onlyWithoutOverdue: boolean;
  sortBy: SoldProductCustomersSortBy;
  sortDirection: SoldProductCustomersSortDirection;
  topN: number | null;
};

export type SoldProductCustomerProductRef = {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
};

export type SoldProductCustomersSummary = {
  customersCount: number;
  totalQuantity: number;
  totalRevenue: number;
  averageUnitPrice: number | null;
  minUnitPrice: number | null;
  maxUnitPrice: number | null;
  lastSaleDate: string | null;
  inactiveCustomersCount: number;
  recurringCustomersCount: number;
};

export type SoldProductCustomerRow = {
  customerId: string;
  customerCode: string | null;
  customerName: string;
  customerCnpj: string | null;
  city: string | null;
  state: string | null;
  region: string | null;
  commercialOwner: string | null;
  ordersCount: number;
  quantity: number;
  totalRevenue: number;
  averageUnitPrice: number | null;
  minUnitPrice: number | null;
  maxUnitPrice: number | null;
  lastUnitPrice: number | null;
  firstPurchaseDate: string | null;
  lastPurchaseDate: string | null;
  daysSinceLastPurchase: number | null;
  averageDaysBetweenPurchases: number | null;
  averageDaysBetweenPurchasesLabel: string;
  shareOfProductRevenue: number;
  shareOfCustomerRevenue: number;
  openPortfolioAmount: number | null;
  overdueAmount: number | null;
  commercialHealth: string;
  suggestedAction: string;
};

export type SoldProductCustomersPayload = {
  generatedAt: string;
  product: SoldProductCustomerProductRef;
  filters: SoldProductCustomersFiltersApplied;
  summary: SoldProductCustomersSummary;
  customers: SoldProductCustomerRow[];
  dataQuality: {
    warnings: string[];
    sources: string[];
  };
};
