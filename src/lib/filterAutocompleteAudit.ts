export type FilterAutocompleteAuditStatus =
  | "fixed"
  | "already_autocomplete"
  | "keep_free_text"
  | "pending_no_endpoint"
  | "not_applicable";

export type FilterAutocompleteEntityType =
  | "customer"
  | "supplier"
  | "person"
  | "product"
  | "seller"
  | "company_internal";

export type FilterAutocompleteAuditEntry = {
  id: string;
  screen: string;
  file: string;
  field: string;
  entity: FilterAutocompleteEntityType;
  issue: string;
  recommendation: string;
  status: FilterAutocompleteAuditStatus;
};

export const FILTER_AUTOCOMPLETE_AUDIT: FilterAutocompleteAuditEntry[] = [
  {
    id: "finance-ar-customer",
    screen: "Financeiro > Contas a Receber",
    file: "src/components/finance/FinanceAccountsReceivablePage.tsx",
    field: "personName / personCnpj",
    entity: "customer",
    issue: "input texto livre sem seleção estruturada",
    recommendation: "CustomerAutocompleteFilter preenche personName + personCnpj",
    status: "fixed",
  },
  {
    id: "finance-cash-flow-customer",
    screen: "Financeiro > Fluxo de Caixa",
    file: "src/components/finance/FinanceCashFlowPage.tsx",
    field: "customerName / personCnpj",
    entity: "customer",
    issue: "input texto livre para cliente",
    recommendation: "CustomerAutocompleteFilter; empresa interna permanece select",
    status: "fixed",
  },
  {
    id: "finance-cash-flow-supplier",
    screen: "Financeiro > Fluxo de Caixa",
    file: "src/components/finance/FinanceCashFlowPage.tsx",
    field: "supplierName",
    entity: "supplier",
    issue: "sem cadastro estruturado de fornecedor",
    recommendation: "manter texto livre até endpoint de fornecedores",
    status: "keep_free_text",
  },
  {
    id: "finance-cash-flow-company",
    screen: "Financeiro > Fluxo de Caixa",
    file: "src/components/finance/FinanceCashFlowPage.tsx",
    field: "companyName",
    entity: "company_internal",
    issue: "filtro de empresa do grupo (Lazarios/Koppetel/SM)",
    recommendation: "não confundir com cliente — manter select/texto próprio",
    status: "not_applicable",
  },
  {
    id: "finance-ap-supplier",
    screen: "Financeiro > Contas a Pagar",
    file: "src/components/finance/FinanceAccountsPayablePage.tsx",
    field: "personName (fornecedor)",
    entity: "supplier",
    issue: "fornecedor Nomus sem cadastro Customer",
    recommendation: "manter texto livre; CNPJ permanece manual",
    status: "keep_free_text",
  },
  {
    id: "finance-executive-report-customer",
    screen: "Financeiro > Relatório Presidencial",
    file: "src/components/finance/executive-report/ExecutiveReportFilters.tsx",
    field: "customerType",
    entity: "customer",
    issue: "filtro por tipo de cliente, não por cliente específico",
    recommendation: "sem filtro de cliente individual — não aplicável",
    status: "not_applicable",
  },
  {
    id: "sales-orders-customer",
    screen: "Pedidos de Venda",
    file: "src/components/SalesOrdersModule.tsx",
    field: "customerId",
    entity: "customer",
    issue: "SearchableSelect com lista completa pré-carregada",
    recommendation: "CustomerAutocompleteFilter com busca server-side",
    status: "fixed",
  },
  {
    id: "sold-products-customer",
    screen: "Produtos Vendidos",
    file: "src/components/commercial/SoldProductsReportPage.tsx",
    field: "customerId / customerTaxId",
    entity: "customer",
    issue: "SearchableSelect com filter-options pré-carregado",
    recommendation: "CustomerAutocompleteFilter",
    status: "fixed",
  },
  {
    id: "sold-product-customers-inherited",
    screen: "Produtos Vendidos > Clientes compradores",
    file: "src/components/commercial/SoldProductCustomersPage.tsx",
    field: "customerId (URL)",
    entity: "customer",
    issue: "filtro herdado da página pai via URL, sem picker local",
    recommendation: "herda seleção do ranking; autocomplete na página pai",
    status: "already_autocomplete",
  },
  {
    id: "material-demand-customer",
    screen: "Pedidos de Venda > Uso de Matéria-Prima",
    file: "src/components/contextual/ProductMaterialDemandDashboard.tsx",
    field: "customerId",
    entity: "customer",
    issue: "select limitado aos clientes do facet carregado",
    recommendation: "CustomerAutocompleteFilter com customerId",
    status: "fixed",
  },
  {
    id: "material-demand-product",
    screen: "Pedidos de Venda > Uso de Matéria-Prima",
    file: "src/components/contextual/ProductMaterialDemandDashboard.tsx",
    field: "productId",
    entity: "product",
    issue: "select limitado ao facet",
    recommendation: "pendente endpoint /api/products/search",
    status: "pending_no_endpoint",
  },
  {
    id: "crm-module-search",
    screen: "CRM > Carteira",
    file: "src/components/CrmModule.tsx",
    field: "search",
    entity: "customer",
    issue: "busca ampla intencional com submit",
    recommendation: "manter busca livre na carteira; seleção específica em telas de detalhe",
    status: "keep_free_text",
  },
  {
    id: "customer-module-list",
    screen: "Cadastro > Clientes",
    file: "src/components/CustomerModule.tsx",
    field: "searchTerm",
    entity: "customer",
    issue: "listagem com debounce já integrada à API paginada",
    recommendation: "já usa GET /api/customers?search=",
    status: "already_autocomplete",
  },
  {
    id: "customer-intelligence-product",
    screen: "CRM > Cliente 360º / Inteligência",
    file: "src/components/crm/customer-intelligence/CustomerIntelligenceFilters.tsx",
    field: "productId",
    entity: "product",
    issue: "input UUID manual",
    recommendation: "pendente endpoint de busca de produto",
    status: "pending_no_endpoint",
  },
  {
    id: "customer-intelligence-responsible",
    screen: "CRM > Cliente 360º / Inteligência",
    file: "src/components/crm/customer-intelligence/CustomerIntelligenceFilters.tsx",
    field: "responsible",
    entity: "seller",
    issue: "texto livre por nome de responsável",
    recommendation: "pendente endpoint de vendedores/responsáveis",
    status: "keep_free_text",
  },
  {
    id: "projects-customer-lookup",
    screen: "Projetos > Cliente",
    file: "src/components/projects/ProjectCustomerLookupField.tsx",
    field: "customer",
    entity: "customer",
    issue: "typeahead server-side já existente",
    recommendation: "manter componente específico de projeto (simulação manual)",
    status: "already_autocomplete",
  },
];

export function filterAutocompleteAuditByStatus(
  status: FilterAutocompleteAuditStatus
): FilterAutocompleteAuditEntry[] {
  return FILTER_AUTOCOMPLETE_AUDIT.filter((e) => e.status === status);
}

export function filterAutocompleteAuditFixed(): FilterAutocompleteAuditEntry[] {
  return filterAutocompleteAuditByStatus("fixed");
}

export function filterAutocompleteAuditIds(): string[] {
  return FILTER_AUTOCOMPLETE_AUDIT.map((e) => e.id);
}

export function isInternalCompanyFilter(entry: FilterAutocompleteAuditEntry): boolean {
  return entry.entity === "company_internal";
}
