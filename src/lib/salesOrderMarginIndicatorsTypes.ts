import type { SalesOrderMarginStatusFilter } from "./salesOrderManagementMargin.js";
import type {
  SalesOrderMarginStatus,
  SalesOrderMarginSummaryPayload,
  SalesOrderMarginCoveragePayload,
} from "./salesOrderMarginTypes.js";

export type SalesOrderMarginIndicatorFilters = {
  year: number;
  month?: number;
  startDate?: Date;
  endDate?: Date;
  customerId?: string;
  responsible?: string;
  productId?: string;
  companyIssuer?: string;
  status?: string;
  itemMarginStatus?: SalesOrderMarginStatus;
  marginStatus?: SalesOrderMarginStatusFilter;
};

export type SalesOrderMarginIndicatorSummary = SalesOrderMarginCoveragePayload & {
  /** Σ SalesOrder.totalNetValue — paridade com GET /api/sales-orders */
  totalSoldAmount: number;
  /** Pedidos no filtro — paridade com paginação e card Pedidos filtrados */
  filteredTotalItems: number;
  filteredAverageTicket: number;
  netRevenue: number;
  totalCost: number;
  marginValue: number;
  marginPercent: number | null;
  markup: number | null;
  ordersCount: number;
  itemsCount: number;
  itemsWithoutCost: number;
  itemsWithoutProduct: number;
  itemsWithNegativeMargin: number;
};

export type SalesOrderMarginIndicatorCustomerRow = {
  customerId: string | null;
  customerName: string;
  netRevenue: number;
  totalCost: number;
  marginValue: number;
  marginPercent: number | null;
  ordersCount: number;
  itemsWithoutCost: number;
  status: SalesOrderMarginSummaryPayload["status"];
  statusLabel: string;
};

export type SalesOrderMarginIndicatorSellerRow = {
  sellerName: string;
  netRevenue: number;
  totalCost: number;
  marginValue: number;
  marginPercent: number | null;
  ordersCount: number;
  customersCount: number;
  itemsWithoutCost: number;
};

export type SalesOrderMarginIndicatorProductRow = {
  productKey: string;
  productId: string | null;
  productName: string;
  sku: string;
  quantitySold: number;
  netRevenue: number;
  totalCost: number;
  marginValue: number;
  marginPercent: number | null;
  ordersCount: number;
  customersCount: number;
  status: SalesOrderMarginSummaryPayload["status"];
  statusLabel: string;
};

export type SalesOrderMarginIndicatorAlertItem = {
  orderId: string;
  orderCode: string;
  itemId: string;
  customerName: string;
  sellerName: string | null;
  productName: string;
  sku: string;
  netRevenue: number;
  marginValue: number | null;
  marginPercent: number | null;
  status: SalesOrderMarginStatus;
  statusLabel: string;
};

export type SalesOrderMarginIndicatorLowMarginRow = {
  key: string;
  name: string;
  netRevenue: number;
  marginPercent: number | null;
  marginValue: number;
};

export type SalesOrderMarginIndicatorAlerts = {
  negativeMarginItems: SalesOrderMarginIndicatorAlertItem[];
  missingCostItems: SalesOrderMarginIndicatorAlertItem[];
  missingProductItems: SalesOrderMarginIndicatorAlertItem[];
  lowMarginCustomers: SalesOrderMarginIndicatorLowMarginRow[];
  lowMarginProducts: SalesOrderMarginIndicatorLowMarginRow[];
};

export type SalesOrderMarginIndicatorsPayload = {
  filters: {
    year: number;
    month?: number;
    startDate?: string;
    endDate?: string;
    customerId?: string;
    responsible?: string;
    productId?: string;
    companyIssuer?: string;
    status?: string;
    itemMarginStatus?: SalesOrderMarginStatus;
    marginStatus?: SalesOrderMarginStatusFilter;
  };
  scopeNote: string;
  summary: SalesOrderMarginIndicatorSummary;
  byCustomer: SalesOrderMarginIndicatorCustomerRow[];
  bySeller: SalesOrderMarginIndicatorSellerRow[];
  byProduct: SalesOrderMarginIndicatorProductRow[];
  alerts: SalesOrderMarginIndicatorAlerts;
};
