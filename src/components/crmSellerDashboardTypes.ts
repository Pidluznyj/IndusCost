/** Tipos do GET /api/crm/seller-dashboard (aba Gestão por Vendedor).
 * Eixo oficial: Responsável Comercial do Cliente — não vendedor Nomus/comissionável.
 */

export type SellerDashboardFilters = {
  /** Filtro de Responsável da carteira (CrmCustomerCommercialOwner). */
  externalSellerId: number | null;
  responsible: string | null;
  sellerIdentityKey?: string | null;
  /** Filtro de Vendedor do pedido (SalesOrder Nomus). */
  orderSellerExternalId?: number | null;
  orderSellerResponsible?: string | null;
  orderSellerIdentityKey?: string | null;
  dateFrom: string | null;
  dateTo: string | null;
};

export type SellerDashboardSourceInfo = {
  eixo: "RESPONSAVEL_COMERCIAL_CLIENTE";
  pedidosFonte: "SalesOrder";
  itensFonte: "SalesOrderItem";
  vendedorPedidoFonte: "Nomus/SalesOrder seller field";
  comissionamentoAfetado: false;
  metricsSource?: string;
  rulesEngineVersion?: string;
  period?: { dateFrom: string | null; dateTo: string | null };
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

export type SellerDashboardTopRow = {
  key: string;
  label: string;
  orders: number;
  value: number;
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
  metricsSource?: string;
  /** Aliases oficiais (mesmo valor dos campos legados acima). */
  totalOrders?: number;
  totalOrderValue?: number;
  openPortfolioOrders?: number;
  openPortfolioValue?: number;
  invoicedOrders?: number;
  invoicedValue?: number;
  canceledOrders?: number;
  averageTicket?: number;
  customersWithOrders?: number;
  ordersWithoutNomusSeller?: number;
  ordersWithDifferentNomusSeller?: number;
};

export type SellerDashboardBySeller = {
  displayName?: string;
  sellerIdentityKey?: string;
  externalSellerId: number | null;
  externalSellerIds?: number[];
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
  /** Auditoria: vendedor Nomus do pedido (não define carteira). */
  nomusSellerName?: string | null;
  commercialOwnerName?: string | null;
  ownerDiffersFromNomusSeller?: boolean;
};

export type SellerDashboardFollowUpCandidate = {
  salesOrderId: string;
  orderCode: string;
  customerId: string;
  customerName: string;
  issueDate: string | null;
  totalNetValue: number;
  daysWithoutFollowUp: number;
};

export type SellerDashboardResponse = {
  generatedAt: string;
  filters: SellerDashboardFilters;
  /** Responsável comercial selecionado (eixo de carteira). */
  selectedCommercialOwner: {
    label: string | null;
    sellerIdentityKey: string | null;
    externalSellerId: number | null;
    customerCount: number;
  };
  period: { dateFrom: string | null; dateTo: string | null };
  /** Opções do filtro Responsável da carteira. */
  sellerOptions: SellerOption[];
  /** Opções do filtro Vendedor do pedido (Nomus/SalesOrder). */
  orderSellerOptions: SellerOption[];
  summary: SellerDashboardSummary;
  /** Aliases top-level pedidos (mesmos do summary). */
  totalOrders: number;
  totalOrderValue: number;
  openPortfolioOrderCount: number;
  openPortfolioValue: number;
  invoicedOrderCount: number;
  invoicedValue: number;
  canceledOrders: number;
  averageTicket: number;
  customersWithOrders: number;
  leadingProduct: SellerDashboardTopProduct | null;
  topCustomers: SellerDashboardTopRow[];
  recentOrders: SellerDashboardOrder[];
  followUpCandidates: SellerDashboardFollowUpCandidate[];
  ordersWithoutNomusSeller: number;
  ordersWithDifferentNomusSeller: number;
  bySeller: SellerDashboardBySeller[];
  openPortfolioOrders: SellerDashboardOrder[];
  invoicedOrders: SellerDashboardOrder[];
  ordersWithoutLinkedProposal: SellerDashboardOrder[];
  sourceInfo: SellerDashboardSourceInfo;
  emptyStateReason: "NO_CUSTOMERS_FOR_COMMERCIAL_OWNER" | null;
};
