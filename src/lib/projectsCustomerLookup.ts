import type { Customer } from "@prisma/client";
import { buildCustomerSearchWhere } from "@/src/lib/customerListQuery.js";

export const PROJECTS_CUSTOMER_LOOKUP_LIMIT = 20;

export type ProjectCustomerLookupSource = "customer";

export type ProjectCustomerLookupItem = {
  id: string;
  name: string;
  document: string | null;
  source: ProjectCustomerLookupSource;
};

export function formatCustomerDisplayName(customer: Pick<Customer, "companyName" | "tradeName">): string {
  const company = customer.companyName?.trim() ?? "";
  const trade = customer.tradeName?.trim();
  if (trade && trade !== company) return `${company} (${trade})`;
  return company;
}

export function serializeCustomerLookupItem(
  customer: Pick<Customer, "id" | "companyName" | "tradeName" | "taxId">
): ProjectCustomerLookupItem {
  return {
    id: customer.id,
    name: formatCustomerDisplayName(customer),
    document: customer.taxId?.trim() || null,
    source: "customer",
  };
}

export function buildProjectsCustomerLookupWhere(query: string) {
  return buildCustomerSearchWhere(query);
}

/** Cliente digitado manualmente — apenas snapshot no Project, sem cadastro oficial. */
export function buildSimulationCustomerPayload(name: string): {
  customerName: string;
  customerDocument: null;
} {
  return {
    customerName: name.trim(),
    customerDocument: null,
  };
}

/** Cliente existente selecionado — snapshot textual no Project. */
export function buildExistingCustomerPayload(item: ProjectCustomerLookupItem): {
  customerName: string;
  customerDocument: string | null;
} {
  return {
    customerName: item.name.trim(),
    customerDocument: item.document,
  };
}
