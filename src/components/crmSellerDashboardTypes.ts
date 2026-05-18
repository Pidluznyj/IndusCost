/** Tipos do GET /api/crm/seller-dashboard (Fase 1J-B). */

export type SellerDashboardFilters = {
  externalSellerId: number | null;
  responsible: string | null;
  dateFrom: string | null;
  dateTo: string | null;
};

export type SellerOption = {
  externalSellerId: number | null;
  responsible: string | null;
  ordersCount: number;
  proposalsCount: number;
};

export type SellerDashboardSummary = {
  ordersCount: number;
  ordersValue: number;
  invoicedOrdersCount: number;
  invoicedOrdersValue: number;
  notInvoicedOrdersCount: number;
  notInvoicedOrdersValue: number;
  proposalsCount: number;
  openProposalsCount: number;
  openProposalsValue: number;
  proposalsWithLinkedOrderCount: number;
  proposalsWithoutLinkedOrderCount: number;
  proposalsWithoutLinkedOrderValue: number;
  ordersWithLinkedProposalCount: number;
  ordersWithoutLinkedProposalCount: number;
};

export type SellerDashboardBySeller = {
  externalSellerId: number | null;
  responsible: string | null;
  ordersCount: number;
  ordersValue: number;
  invoicedOrdersCount: number;
  invoicedOrdersValue: number;
  notInvoicedOrdersCount: number;
  notInvoicedOrdersValue: number;
  openProposalsWithoutLinkedOrderCount: number;
  openProposalsWithoutLinkedOrderValue: number;
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

export type SellerDashboardProposalWithoutLinkedOrder = {
  proposalId: string;
  number: number;
  externalProposalId: number | null;
  externalProposalCode: string | null;
  customerId: string;
  customerName: string;
  responsible: string | null;
  externalSellerId: number | null;
  status: string;
  totalNetValue: number;
  createdAt: string | null;
  updatedAt: string | null;
  daysOpen: number;
};

export type SellerDashboardResponse = {
  generatedAt: string;
  filters: SellerDashboardFilters;
  sellerOptions: SellerOption[];
  summary: SellerDashboardSummary;
  bySeller: SellerDashboardBySeller[];
  notInvoicedOrders: SellerDashboardOrder[];
  invoicedOrders: SellerDashboardOrder[];
  openProposalsWithoutLinkedOrder: SellerDashboardProposalWithoutLinkedOrder[];
  ordersWithoutLinkedProposal: SellerDashboardOrder[];
};
