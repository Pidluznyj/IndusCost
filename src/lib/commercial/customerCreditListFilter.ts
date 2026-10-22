/**
 * Recorte da grade de Clientes pela decisão oficial já calculada.
 * Não relê título e não autoriza venda.
 */

export const CUSTOMER_CREDIT_LIST_FILTERS = ["blocked", "review", "released", "unread"] as const;

export type CustomerCreditListFilter = (typeof CUSTOMER_CREDIT_LIST_FILTERS)[number];

const FILTER_LABEL: Record<CustomerCreditListFilter, string> = {
  blocked: "Bloqueado",
  review: "Em análise",
  released: "Liberado",
  unread: "Sem leitura",
};

export const CUSTOMER_CREDIT_LIST_FILTER_ALL_LABEL = "Todas as situações";

export function parseCustomerCreditListFilter(raw: unknown): CustomerCreditListFilter | "" {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return (CUSTOMER_CREDIT_LIST_FILTERS as readonly string[]).includes(value)
    ? (value as CustomerCreditListFilter)
    : "";
}

export function customerCreditListFilterLabel(filter: CustomerCreditListFilter | ""): string {
  return filter ? FILTER_LABEL[filter] : CUSTOMER_CREDIT_LIST_FILTER_ALL_LABEL;
}

export function portfolioDecisionMatchesCreditFilter(
  customerStatus: string | null | undefined,
  filter: CustomerCreditListFilter | ""
): boolean {
  if (!filter) return true;
  if (filter === "blocked") return customerStatus === "BLOQUEADO" || customerStatus === "BLOQUEIO_CRITICO";
  if (filter === "review") return customerStatus === "EM_ANALISE";
  if (filter === "unread") return customerStatus === "LEITURA_INDISPONIVEL";
  return customerStatus === "LIBERADO";
}
