/** Tipos do GET /api/crm/seller-dashboard (Fase 3 — base: SalesOrder). */

export type SellerDashboardFilters = {
  externalSellerId: number | null;
  responsible: string | null;
  dateFrom: string | null;
  dateTo: string | null;
};

export type SellerOption = {
  displayName: string;
  normalizedName: string;
  sellerIdentityKey: string;
  externalSellerId: number | null;
  externalSellerIds: number[];
  responsible: string | null;
  ordersCount: number;
  hasOrdersWithoutNomusId?: boolean;
  mergedFragmentCount?: number;
  sourceSellerKeys?: string[];
  needsReview?: boolean;
};

export type SellerDashboardTopProduct = {
  productId: string;
  productName: string;
  sku: string;
  revenue: number;
  quantity: number;
};

export type SellerDashboardSummary = {
  ordersCount: number;
  ordersValue: number;
  invoicedOrdersCount: number;
  invoicedOrdersValue: number;
  openOrdersCount: number;
  openOrdersValue: number;
  cancelledOrdersCount: number;
  uniqueCustomersCount: number;
  ticketAverage: number;
  topProduct: SellerDashboardTopProduct | null;
  /** Qualidade de rastreabilidade — não é KPI principal de performance. */
  ordersWithoutLinkedProposalCount: number;
};

export type SellerDashboardBySeller = {
  externalSellerId: number | null;
  responsible: string | null;
  ordersCount: number;
  ordersValue: number;
  invoicedOrdersCount: number;
  invoicedOrdersValue: number;
  openOrdersCount: number;
  openOrdersValue: number;
};

export type SellerDashboardOrder = {
  salesOrderId: string;
  orderCode: string;
  externalSalesOrderId: number | null;
  customerId: string;
  customerName: string;
  responsible: string | null;
  externalSellerId: number | null;
  issueDate: string | null;
  expectedDeliveryDate?: string | null;
  totalNetValue: number;
  daysUntilExpectedDelivery?: number | null;
  daysOverdue?: number | null;
  invoiceProcessedAtText?: string | null;
  invoiceNumber?: string | null;
  invoiceSeries?: string | null;
  invoiceKey?: string | null;
  invoiceStatus?: string | null;
  isInvoiced?: boolean;
};

export type SellerDashboardResponse = {
  generatedAt: string;
  filters: SellerDashboardFilters;
  sellerOptions: SellerOption[];
  summary: SellerDashboardSummary;
  bySeller: SellerDashboardBySeller[];
  openPortfolioOrders: SellerDashboardOrder[];
  invoicedOrders: SellerDashboardOrder[];
  ordersWithoutLinkedProposal: SellerDashboardOrder[];
};
