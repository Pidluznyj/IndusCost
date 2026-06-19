import type { CrmCustomerListFilter, CrmCustomerListItem } from "@/src/lib/crmCustomersListTypes";

export const CRM_PORTFOLIO_FILTER_CHIPS: { value: CrmCustomerListFilter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "withoutContact30", label: "Sem contato 30d" },
  { value: "withContact30", label: "Com contato 30d" },
  { value: "overdueFollowUp", label: "Follow-up atrasado" },
  { value: "upcomingFollowUp7", label: "Próximos 7d" },
  { value: "withPurchaseHistory", label: "Com histórico" },
  { value: "withOpenPortfolio", label: "Carteira aberta" },
];

export type CustomerListStatusTag = {
  key: string;
  label: string;
  className: string;
};

export function buildCustomerListStatusTags(customer: CrmCustomerListItem): CustomerListStatusTag[] {
  const tags: CustomerListStatusTag[] = [];
  if (customer.hasOverdueFollowUp) {
    tags.push({
      key: "overdue",
      label: "Follow-up atrasado",
      className: "border-red-200 bg-red-50 text-red-900",
    });
  }
  if (customer.hasOpenPortfolio) {
    tags.push({
      key: "open-portfolio",
      label: "Carteira aberta",
      className: "border-violet-200 bg-violet-50 text-violet-900",
    });
  }
  if (customer.hasPurchaseHistory) {
    tags.push({
      key: "history",
      label: "Com histórico",
      className: "border-emerald-200 bg-emerald-50 text-emerald-900",
    });
  } else if (!customer.lastContactAt) {
    tags.push({
      key: "no-contact",
      label: "Sem contato",
      className: "border-amber-200 bg-amber-50 text-amber-900",
    });
  }
  if (customer.nextFollowUpAt) {
    tags.push({
      key: "follow-up",
      label: "Agenda",
      className: "border-sky-200 bg-sky-50 text-sky-900",
    });
  }
  return tags;
}

export type PortfolioEmptySummary = {
  totalListed: number;
  withOpenPortfolio: number;
  withOverdueFollowUp: number;
  withoutContact: number;
};

export function computePortfolioEmptySummary(
  customers: CrmCustomerListItem[]
): PortfolioEmptySummary {
  return {
    totalListed: customers.length,
    withOpenPortfolio: customers.filter((c) => c.hasOpenPortfolio).length,
    withOverdueFollowUp: customers.filter((c) => c.hasOverdueFollowUp).length,
    withoutContact: customers.filter((c) => !c.lastContactAt).length,
  };
}
