/** Tipos do GET /api/crm/customers — carteira CRM Comercial. */

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
  primarySellerResponsible: string | null;
  primaryExternalSellerId: number | null;
  hasPurchaseHistory: boolean;
  hasOpenPortfolio: boolean;
  hasOverdueFollowUp: boolean;
};

export type CrmCustomersListResponse = {
  customers: CrmCustomerListItem[];
  pagination: { limit: number; offset: number; returned: number; hasMore: boolean };
  scope: {
    dataScope: "global" | "own";
    sellerFilterActive: boolean;
  };
};
