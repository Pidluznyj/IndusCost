/** Tipos do relatório Produtos Vendidos (base: Pedido de Venda). */

export type SoldProductsDateBasis = "issueDate" | "expectedDeliveryDate" | "invoiceDate";

export type SoldProductsOrderStatusFilter = "valid" | "all" | "cancelled";

export type SoldProductsCustomerScope = "external" | "group" | "all";

export type SoldProductsCompanyFilter = "all" | "koppetel" | "lazarios" | "sm";

export type SoldProductsSortBy = "quantity" | "amount" | "orders" | "customers";

export type SoldProductsTopN = "10" | "20" | "50" | "100" | "all";

export type SoldProductsUiFilters = {
  startDate: string;
  endDate: string;
  year: string;
  month: string;
  dateBasis: SoldProductsDateBasis;
  customerName: string;
  customerTaxId: string;
  customerId: string;
  productId: string;
  productCode: string;
  productName: string;
  sellerKey: string;
  company: SoldProductsCompanyFilter;
  orderStatus: SoldProductsOrderStatusFilter;
  customerScope: SoldProductsCustomerScope;
  sortBy: SoldProductsSortBy;
  topN: SoldProductsTopN;
};

export type SoldProductsDashboardFilters = {
  startDate: Date;
  endDate: Date;
  dateBasis: SoldProductsDateBasis;
  customerName?: string;
  customerTaxId?: string;
  customerId?: string;
  productId?: string;
  productCode?: string;
  productName?: string;
  sellerExternalId?: number;
  sellerResponsible?: string;
  company: SoldProductsCompanyFilter;
  orderStatus: SoldProductsOrderStatusFilter;
  customerScope: SoldProductsCustomerScope;
  sortBy: SoldProductsSortBy;
  topN: number | null;
  detailPage: number;
  detailLimit: number;
};

export type SoldProductsTopProductRef = {
  productId: string;
  productCode: string | null;
  productName: string;
  quantitySold: number;
  amountSold: number;
};

export type SoldProductsSummary = {
  totalQuantity: number;
  totalAmount: number;
  productsCount: number;
  customersCount: number;
  ordersCount: number;
  averageUnitPrice: number | null;
  topProductByQuantity: SoldProductsTopProductRef | null;
  topProductByAmount: SoldProductsTopProductRef | null;
};

export type SoldProductsRankingRow = {
  rank: number;
  productId: string;
  productCode: string | null;
  productName: string;
  quantitySold: number;
  amountSold: number;
  averageUnitPrice: number | null;
  ordersCount: number;
  customersCount: number;
  lastSaleDate: string | null;
  quantitySharePercent: number;
  amountSharePercent: number;
};

export type SoldProductsCustomerMixRow = {
  productId: string;
  productCode: string | null;
  productName: string;
  customerId: string;
  customerName: string;
  customerTaxId: string | null;
  quantitySold: number;
  amountSold: number;
  customerSharePercent: number;
};

export type SoldProductsMonthlyEvolutionRow = {
  productId: string;
  productCode: string | null;
  productName: string;
  year: number;
  month: number;
  quantitySold: number;
  amountSold: number;
};

export type SoldProductsDetailRow = {
  orderDate: string;
  orderCode: string;
  orderId: string;
  customerName: string;
  customerTaxId: string | null;
  sellerName: string | null;
  companyLabel: string | null;
  productCode: string | null;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineAmount: number;
  orderStatus: string;
  orderStatusLabel: string;
};

/**
 * Aba NCM x Produto — uma linha por PRODUTO (produtos distintos com o mesmo
 * NCM geram linhas distintas). ncm=null → apresentado como "Sem NCM"; o
 * produto nunca some e seus números continuam nos totais.
 */
export type SoldProductsNcmProductRow = {
  ncm: string | null;
  productId: string | null;
  sku: string;
  productName: string;
  quantitySold: number;
  soldValue: number;
};

export type SoldProductsNcmSummary = {
  totalQuantity: number;
  totalSoldValue: number;
  productsCount: number;
  productsWithoutNcmCount: number;
};

export type SoldProductsDashboardPayload = {
  generatedAt: string;
  filters: SoldProductsDashboardFiltersApplied;
  summary: SoldProductsSummary;
  ranking: SoldProductsRankingRow[];
  customerMix: SoldProductsCustomerMixRow[];
  monthlyEvolution: SoldProductsMonthlyEvolutionRow[];
  ncmByProduct: SoldProductsNcmProductRow[];
  ncmSummary: SoldProductsNcmSummary;
  detailRows: SoldProductsDetailRow[];
  detailPagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type SoldProductsFilterOptionsPayload = {
  customers: Array<{ id: string; companyName: string; taxId: string | null }>;
  products: Array<{ id: string; sku: string | null; name: string }>;
  sellers: Array<{ key: string; label: string }>;
};

export type SoldProductsDashboardFiltersApplied = {
  periodLabel: string;
  dateBasis: SoldProductsDateBasis;
  dateBasisLabel: string;
  customerName?: string;
  customerTaxId?: string;
  customerId?: string;
  productId?: string;
  productCode?: string;
  productName?: string;
  sellerLabel?: string;
  company: SoldProductsCompanyFilter;
  companyLabel: string;
  orderStatus: SoldProductsOrderStatusFilter;
  orderStatusLabel: string;
  customerScope: SoldProductsCustomerScope;
  customerScopeLabel: string;
  sortBy: SoldProductsSortBy;
  sortByLabel: string;
  topN: SoldProductsTopN;
  topNLabel: string;
  startDate: string;
  endDate: string;
  year?: number;
  month?: number;
};
