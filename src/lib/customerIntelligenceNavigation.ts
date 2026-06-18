/**
 * Rotas e navegação — Inteligência do Cliente (frontend).
 */

export const CUSTOMER_INTELLIGENCE_SCREEN_TITLE = "Inteligência do Cliente";

export const CUSTOMER_INTELLIGENCE_ROUTE_PRIMARY = "/crm/customers/:customerId/intelligence";

export const CUSTOMER_INTELLIGENCE_ROUTE_COMPAT = "/customers/:customerId/intelligence";

export function buildCustomerIntelligencePath(customerId: string): string {
  return `/crm/customers/${encodeURIComponent(customerId)}/intelligence`;
}

export function buildCustomerIntelligenceCompatPath(customerId: string): string {
  return `/customers/${encodeURIComponent(customerId)}/intelligence`;
}

export function buildCustomerIntelligenceApiPath(
  customerId: string,
  query?: string
): string {
  const base = `/api/crm/customers/${encodeURIComponent(customerId)}/intelligence`;
  if (!query || query === "") return base;
  return `${base}?${query.startsWith("?") ? query.slice(1) : query}`;
}

export const CUSTOMER_INTELLIGENCE_TAB_IDS = [
  "overview",
  "purchases",
  "products",
  "repurchase",
  "financial",
  "crm",
  "profile",
  "opportunities",
] as const;

export type CustomerIntelligenceTabId = (typeof CUSTOMER_INTELLIGENCE_TAB_IDS)[number];

export const CUSTOMER_INTELLIGENCE_TAB_LABELS: Record<CustomerIntelligenceTabId, string> = {
  overview: "Visão Geral",
  purchases: "Compras",
  products: "Produtos",
  repurchase: "Recompra",
  financial: "Financeiro",
  crm: "CRM",
  profile: "Cadastro",
  opportunities: "Oportunidades",
};

export const REPURCHASE_STATUS_LABEL_PT: Record<string, string> = {
  INSUFICIENTE: "Histórico insuficiente",
  DENTRO_JANELA: "Dentro da janela",
  PROXIMA: "Próxima recompra",
  ATRASADO: "Recompra em atraso",
};

export const FINANCIAL_STATUS_LABEL_PT: Record<
  import("./customerIntelligenceTypes.js").CustomerIntelligenceFinancialStatus,
  string
> = {
  unlinked: "Financeiro não vinculado",
  healthy: "Financeiro regular",
  open: "Carteira em aberto",
  overdue: "Inadimplente",
  no_titles: "Sem títulos AR",
};

export const HEALTH_CLASSIFICATION_LABEL_PT: Record<
  import("./customerIntelligenceTypes.js").CustomerIntelligenceHealthClassification,
  string
> = {
  excelente: "Excelente",
  saudavel: "Saudável",
  atencao: "Atenção",
  risco: "Risco",
  inativo: "Inativo",
  historico_insuficiente: "Histórico insuficiente",
};

export const COMMERCIAL_CLASSIFICATION_LABEL_PT: Record<
  import("./customerIntelligenceTypes.js").CustomerIntelligenceCommercialClassification,
  string
> = {
  cliente_estrategico: "Cliente estratégico",
  cliente_recorrente: "Cliente recorrente",
  oportunidade: "Oportunidade",
  reativacao: "Reativação",
  risco_financeiro: "Risco financeiro",
  baixo_potencial: "Baixo potencial",
  historico_insuficiente: "Histórico insuficiente",
};
