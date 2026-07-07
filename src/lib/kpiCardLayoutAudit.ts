/**
 * Auditoria de layout de cards KPI — varredura do frontend IndusCost.
 * Referência para testes e manutenção do padrão indus-kpi-grid.
 */

export type KpiLayoutAuditStatus = "fixed" | "ok" | "monitor";

export type KpiLayoutAuditEntry = {
  id: string;
  screen: string;
  component: string;
  file: string;
  issue: string;
  status: KpiLayoutAuditStatus;
  fix: string;
};

/** Telas obrigatórias da varredura e status após padronização. */
export const KPI_CARD_LAYOUT_AUDIT: KpiLayoutAuditEntry[] = [
  {
    id: "sold-product-customers",
    screen: "Produtos Vendidos → Clientes compradores",
    component: "SoldProductCustomersPage",
    file: "src/components/commercial/SoldProductCustomersPage.tsx",
    issue: "8 cards em linha única (xl:grid-cols-8)",
    status: "fixed",
    fix: "ExecutiveSummarySection + SummaryKpiGrid + FinanceBiKpiCard",
  },
  {
    id: "sold-products-report",
    screen: "Pedidos de Venda → Produtos Vendidos",
    component: "SoldProductsReportPage",
    file: "src/components/commercial/SoldProductsReportPage.tsx",
    issue: "KPIs com valores longos sem title",
    status: "fixed",
    fix: "ExecutiveSummarySection + SummaryKpiGrid + amountFormat nos cards",
  },
  {
    id: "sales-orders",
    screen: "Pedidos de Venda",
    component: "SalesOrdersModule",
    file: "src/components/SalesOrdersModule.tsx",
    issue: "Grid fixo 4 colunas; moeda sem compactação",
    status: "fixed",
    fix: "indus-kpi-grid + amountFormat currency",
  },
  {
    id: "finance-ar",
    screen: "Financeiro → Contas a Receber",
    component: "FinanceAccountsReceivablePage",
    file: "src/components/finance/FinanceAccountsReceivablePage.tsx",
    issue: "8 KPIs em grid fixo 4 colunas",
    status: "fixed",
    fix: "indus-kpi-grid + amountFormat currency",
  },
  {
    id: "finance-ap",
    screen: "Financeiro → Contas a Pagar",
    component: "FinanceAccountsPayablePage",
    file: "src/components/finance/FinanceAccountsPayablePage.tsx",
    issue: "8 KPIs em grid fixo 4 colunas",
    status: "fixed",
    fix: "indus-kpi-grid + amountFormat currency",
  },
  {
    id: "finance-ar-overdue",
    screen: "Contas a Receber → Atrasados",
    component: "FinanceAccountsReceivableOverdueTab",
    file: "src/components/finance/FinanceAccountsReceivableOverdueTab.tsx",
    issue: "8 KPIs; moeda sem title",
    status: "fixed",
    fix: "indus-kpi-grid + amountFormat",
  },
  {
    id: "finance-billing",
    screen: "Financeiro → Faturamento",
    component: "FinanceBillingPage",
    file: "src/components/finance/FinanceBillingPage.tsx",
    issue: "FinanceBillingKpiGroup com grid fixo",
    status: "fixed",
    fix: "indus-kpi-grid no grupo de KPIs",
  },
  {
    id: "finance-cash-flow-ytd",
    screen: "Financeiro → Fluxo de Caixa",
    component: "FinanceCashFlowYtdSummary",
    file: "src/components/finance/cash-flow/FinanceCashFlowYtdSummary.tsx",
    issue: "6 cards em linha (xl:grid-cols-6)",
    status: "fixed",
    fix: "indus-kpi-grid",
  },
  {
    id: "finance-executive-report",
    screen: "Financeiro → Relatório Presidencial",
    component: "ExecutiveKpiGrid",
    file: "src/components/finance/executive-report/ExecutiveKpiGrid.tsx",
    issue: "Grid fixo repeat(N, 1fr) sem minmax",
    status: "fixed",
    fix: "auto-fit minmax + ellipsis no valor",
  },
  {
    id: "customer-intelligence",
    screen: "CRM → Inteligência do Cliente",
    component: "CustomerIntelligenceKpiGrid",
    file: "src/components/crm/customer-intelligence/CustomerIntelligenceKpiGrid.tsx",
    issue: "minmax(10.5rem) estreito demais",
    status: "fixed",
    fix: "ExecutiveSummarySection + SummaryKpiGrid + MetricCard",
  },
  {
    id: "dashboard-main",
    screen: "Dashboard principal",
    component: "DashboardModule",
    file: "src/components/DashboardModule.tsx",
    issue: "4 KPIs fixos — risco baixo",
    status: "ok",
    fix: "Grid lg:grid-cols-4 aceitável (≤4 cards)",
  },
  {
    id: "reports-module",
    screen: "Relatórios",
    component: "ReportsModule",
    file: "src/components/ReportsModule.tsx",
    issue: "xl:grid-cols-6 em resumo comercial",
    status: "fixed",
    fix: "indus-kpi-grid onde aplicável",
  },
  {
    id: "customer-commercial-360",
    screen: "Clientes → Visão Comercial",
    component: "CustomerCommercial360",
    file: "src/components/customers/CustomerCommercial360.tsx",
    issue: "lg:grid-cols-5 comprime cards",
    status: "fixed",
    fix: "ExecutiveSummarySection + SummaryKpiGrid + FinanceBiKpiCard",
  },
  {
    id: "finance-horizon",
    screen: "Financeiro → Horizonte AR/AP",
    component: "FinanceHorizonSection",
    file: "src/components/finance/shared/FinanceHorizonSection.tsx",
    issue: "2xl:grid-cols-6",
    status: "fixed",
    fix: "indus-kpi-grid",
  },
  {
    id: "executive-filters",
    screen: "Relatório Presidencial → Filtros",
    component: "ExecutiveReportFilters",
    file: "src/components/finance/executive-report/ExecutiveReportFilters.tsx",
    issue: "xl:grid-cols-8 em filtros (não KPI)",
    status: "monitor",
    fix: "Campos de filtro — não alterado (não é KPI)",
  },
  {
    id: "sync-panels",
    screen: "Sync Nomus AR/AP",
    component: "FinanceAccountsReceivableSyncPanel",
    file: "src/components/finance/FinanceAccountsReceivableSyncPanel.tsx",
    issue: "lg:grid-cols-8 em metadados técnicos",
    status: "monitor",
    fix: "Painel técnico — fora do escopo KPI executivo",
  },
];

export const KPI_LAYOUT_FORBIDDEN_PATTERNS = [
  "xl:grid-cols-8",
  "grid-cols-8",
  "xl:grid-cols-7",
  "grid-cols-7",
] as const;

export function getKpiLayoutAuditFixedEntries(): KpiLayoutAuditEntry[] {
  return KPI_CARD_LAYOUT_AUDIT.filter((e) => e.status === "fixed");
}

export function getKpiLayoutAuditById(id: string): KpiLayoutAuditEntry | undefined {
  return KPI_CARD_LAYOUT_AUDIT.find((e) => e.id === id);
}
