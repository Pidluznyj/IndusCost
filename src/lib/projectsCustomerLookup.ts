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
  customerId: null;
  customerName: string;
  customerDocument: null;
} {
  return {
    customerId: null,
    customerName: name.trim(),
    customerDocument: null,
  };
}

/**
 * Cliente existente selecionado — envia o id do cadastro oficial. O servidor valida o id e
 * grava o snapshot (nome/documento) a partir do cadastro, não do texto enviado.
 */
export function buildExistingCustomerPayload(item: ProjectCustomerLookupItem): {
  customerId: string;
  customerName: string;
  customerDocument: string | null;
} {
  return {
    customerId: item.id,
    customerName: item.name.trim(),
    customerDocument: item.document,
  };
}
