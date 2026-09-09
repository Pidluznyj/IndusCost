/** Tipos do GET /api/crm/customers — carteira CRM Comercial. */

import type {
  CrmCustomersListSourceInfo,
  CrmPortfolioStatus,
} from "@/src/lib/crmCustomersListOfficialOrders";

export const CRM_CUSTOMER_LIST_FILTERS = [
  "all",
  "withContact30",
  "withoutContact30",
  "overdueFollowUp",
  "upcomingFollowUp7",
  "withPurchaseHistory",
  "withOpenPortfolio",
] as const;

export type CrmCustomerListFilter = (typeof CRM_CUSTOMER_LIST_FILTERS)[number];

export type CrmCustomerListLeadingProduct = {
  productId: string | null;
  productName: string | null;
  sku: string | null;
  revenue: number;
  quantity: number;
};

export type CrmCustomerListItem = {
  id: string;
  displayName: string;
  tradeName: string | null;
  taxId: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  address: string | null;
  lastContactAt: string | null;
  nextFollowUpAt: string | null;
  contactCount: number;
  /** Responsável Comercial do Cliente (eixo de carteira). Nunca vendedor Nomus do pedido. */
  primarySellerResponsible: string | null;
  primaryExternalSellerId: number | null;
  commercialOwnerName: string | null;
  commercialOwnerExternalId: number | null;
  hasCommercialOwner: boolean;
  hasPurchaseHistory: boolean;
  hasOpenPortfolio: boolean;
  hasOverdueFollowUp: boolean;
  portfolioStatus: CrmPortfolioStatus;
  lastOrderAt: string | null;
  lastOrderCode: string | null;
  daysSinceLastOrder: number | null;
  ordersCount: number;
  historicalPurchaseValue: number;
  periodPurchaseValue: number;
  periodOrdersCount: number;
  leadingProduct: CrmCustomerListLeadingProduct | null;
  /** Auditoria: vendedor Nomus do último pedido (não define carteira). */
  lastOrderNomusSellerName: string | null;
  lastOrderExternalSellerId: number | null;
  hasOrderWithoutNomusSeller: boolean;
  hasOwnerSellerDivergence: boolean;
};

export type CrmCustomersListTotals = {
  /**
   * Universo completo de clientes no filtro — `customer.count` com o MESMO
   * `where` da página. Nunca é a contagem do array paginado.
   */
  totalCustomersInScope: number;
  customersWithoutCommercialOwner: number;
  customersWithoutPurchase: number;
  customersWithOrderWithoutNomusSeller: number;
  customersWithOwnerSellerDivergence: number;
  /**
   * True quando o universo excedeu o teto de agregação e os quatro sub-totais
   * de qualidade cobrem apenas parte dele. A UI precisa avisar, em vez de
   * apresentar número subestimado como se fosse o total.
   */
  qualityTotalsTruncated: boolean;
};

export type CrmCustomersListResponse = {
  customers: CrmCustomerListItem[];
  pagination: { limit: number; offset: number; returned: number; hasMore: boolean };
  scope: {
    dataScope: "global" | "own";
    sellerFilterActive: boolean;
    /** Filtro de carteira = responsável comercial (não vendedor Nomus). */
    portfolioAxis: "RESPONSAVEL_COMERCIAL_CLIENTE";
  };
  period: { dateFrom: string; dateTo: string };
  totals: CrmCustomersListTotals;
  sourceInfo: CrmCustomersListSourceInfo;
};
