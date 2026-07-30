export type SystemDataLineageStatus =
  | "ok"
  | "derived"
  | "static-ui"
  | "attention"
  | "risk"
  | "pending";

export type SystemDataLineageEntry = {
  id: string;
  module: string;
  feature: string;
  frontendRoutes: string[];
  backendEndpoints: string[];
  files: string[];
  services: string[];
  prismaModels: string[];
  rawSqlTables: string[];
  externalSources: string[];
  derivedFrom: string[];
  hardcodedAllowed: string[];
  hardcodedSuspicions: string[];
  status: SystemDataLineageStatus;
  notes: string[];
};

/** Matriz de rastreabilidade — funcionalidade → fonte de dados. */
export const SYSTEM_DATA_LINEAGE: SystemDataLineageEntry[] = [
  {
    id: "finance-ar",
    module: "Financeiro",
    feature: "Contas a Receber",
    frontendRoutes: ["/finance/accounts-receivable"],
    backendEndpoints: [
      "/api/finance/accounts-receivable/dashboard",
      "/api/finance/accounts-receivable/titles",
      "/api/finance/accounts-receivable/export",
    ],
    files: [
      "src/components/finance/FinanceAccountsReceivablePage.tsx",
      "src/lib/financeAccountsReceivableManagement.ts",
      "src/lib/financeAccountsReceivableDashboard.ts",
      "src/lib/financeAccountsReceivableRoutes.ts",
    ],
    services: [
      "loadFinanceArManagementRowsFromPrisma",
      "buildFinanceArDashboard",
      "buildNomusArReportSyncCutoff",
    ],
    prismaModels: ["NomusAccountsReceivable"],
    rawSqlTables: [],
    externalSources: ["Nomus API via nomusAccountsReceivableSyncRunner"],
    derivedFrom: [],
    hardcodedAllowed: [
      "Labels de status (overdue, open, paid)",
      "financeInternalGroupExclusions — CNPJs do grupo Lazarios/Koppetel/SM",
    ],
    hardcodedSuspicions: [],
    status: "ok",
    notes: [
      "Títulos carregados de NomusAccountsReceivable sincronizado; filtros por personName/personCnpj são parâmetros de query, não dados fixos.",
    ],
  },
  {
    id: "finance-ar-overdue",
    module: "Financeiro",
    feature: "Contas a Receber — Atrasados",
    frontendRoutes: ["/finance/accounts-receivable/overdue"],
    backendEndpoints: [
      "/api/finance/accounts-receivable/overdue",
      "/api/finance/accounts-receivable/overdue/export.xlsx",
    ],
    files: [
      "src/components/finance/FinanceAccountsReceivableOverdueTab.tsx",
      "src/lib/financeAccountsReceivableOverdue.ts",
      "src/lib/financeAccountsReceivableOverdueRoutes.ts",
    ],
    services: ["buildFinanceArOverduePayload"],
    prismaModels: ["NomusAccountsReceivable"],
    rawSqlTables: [],
    externalSources: ["Nomus AR sync"],
    derivedFrom: ["financeAccountsReceivableManagement"],
    hardcodedAllowed: ["Regras de aging bucket (faixas de dias)"],
    hardcodedSuspicions: [],
    status: "derived",
    notes: ["Deriva da mesma base AR oficial com filtros de vencimento."],
  },
  {
    id: "finance-ap",
    module: "Financeiro",
    feature: "Contas a Pagar",
    frontendRoutes: ["/finance/accounts-payable"],
    backendEndpoints: [
      "/api/finance/accounts-payable/dashboard",
      "/api/finance/accounts-payable/titles",
      "/api/finance/accounts-payable/export",
    ],
    files: [
      "src/components/finance/FinanceAccountsPayablePage.tsx",
      "src/lib/financeAccountsPayableDashboard.ts",
      "src/lib/financeAccountsPayableRoutes.ts",
    ],
    services: ["loadFinanceApManagementRowsFromPrisma", "buildFinanceApDashboard"],
    prismaModels: ["NomusAccountsPayable"],
    rawSqlTables: [],
    externalSources: ["Nomus API via nomusAccountsReceivableSyncRunner"],
    derivedFrom: [],
    hardcodedAllowed: ["financeInternalGroupExclusions para intercompany AP"],
    hardcodedSuspicions: [],
    status: "ok",
    notes: [],
  },
  {
    id: "finance-cash-flow",
    module: "Financeiro",
    feature: "Fluxo de Caixa",
    frontendRoutes: ["/finance/cash-flow"],
    backendEndpoints: [
      "/api/finance/cash-flow/dashboard",
      "/api/finance/cash-flow/audit",
      "/api/finance/cash-flow/export",
    ],
    files: [
      "src/components/finance/FinanceCashFlowPage.tsx",
      "src/lib/financeCashFlowDashboard.ts",
      "src/lib/financeCashFlowDataset.ts",
      "src/lib/financeCashFlowRoutes.ts",
    ],
    services: [
      "buildFinanceCashFlowDashboard",
      "buildFinanceCashFlowDataset",
      "buildCashFlowArApReconciliationReport",
    ],
    prismaModels: ["NomusAccountsReceivable", "NomusAccountsPayable"],
    rawSqlTables: [],
    externalSources: ["Nomus AR/AP sync"],
    derivedFrom: [
      "financeAccountsReceivableManagement",
      "financeAccountsPayableOperational",
    ],
    hardcodedAllowed: ["Labels de abas e blocos de risco documentados"],
    hardcodedSuspicions: [],
    status: "derived",
    notes: ["Consolida AR+AP oficiais; não inventa títulos."],
  },
  {
    id: "finance-billing",
    module: "Financeiro",
    feature: "Faturamento",
    frontendRoutes: ["/finance/billing"],
    backendEndpoints: [
      "/api/finance/billing/dashboard",
      "/api/finance/billing/nfes",
      "/api/finance/billing/export",
    ],
    files: [
      "src/components/finance/FinanceBillingPage.tsx",
      "src/lib/financeBillingDashboard.ts",
      "src/lib/financeBillingNfeDashboard.ts",
    ],
    services: ["buildFinanceBillingDashboard", "buildFinanceBillingNfeDashboard"],
    prismaModels: ["NomusNfe", "SalesOrder"],
    rawSqlTables: [],
    externalSources: ["Nomus NF-e sync", "SalesOrder.nomusRawResponse.nfes"],
    derivedFrom: [],
    hardcodedAllowed: ["nomusNfeClassification — CNPJs do grupo para classificação"],
    hardcodedSuspicions: [],
    status: "ok",
    notes: [],
  },
  {
    id: "finance-executive-report",
    module: "Financeiro",
    feature: "Relatório Presidencial",
    frontendRoutes: ["/finance/executive-report"],
    backendEndpoints: ["/api/finance/executive-report"],
    files: [
      "src/components/finance/FinanceExecutiveReportPage.tsx",
      "src/lib/financeExecutiveReport.ts",
      "src/lib/financeExecutiveReportRoutes.ts",
    ],
    services: ["buildFinanceExecutiveReportPayload"],
    prismaModels: [
      "NomusAccountsReceivable",
      "NomusAccountsPayable",
      "SalesOrder",
      "NomusNfe",
    ],
    rawSqlTables: [],
    externalSources: ["Composição de módulos financeiros e comerciais"],
    derivedFrom: [
      "financeBillingDashboard",
      "financeAccountsReceivableManagement",
      "financeAccountsPayableDashboard",
      "salesOrdersDashboardMetrics",
      "financeCashFlowExecutiveSummary",
    ],
    hardcodedAllowed: [
      "FINANCE_EXECUTIVE_REPORT_*_OPTIONS — labels de filtro UI",
      "TARGET_GROWTH_FACTOR em salesOrderDashboardRules",
    ],
    hardcodedSuspicions: [],
    status: "derived",
    notes: ["Não possui filtro por cliente individual; customerType é enum de segmento."],
  },
  {
    id: "sales-orders",
    module: "Comercial",
    feature: "Pedidos de Venda",
    frontendRoutes: ["/sales-orders", "/sales-orders/:id"],
    backendEndpoints: ["/api/sales-orders", "/api/sales-orders/:id"],
    files: ["src/components/SalesOrdersModule.tsx", "server.ts"],
    services: ["salesOrderHasInvoicing", "buildSalesOrderListSummary"],
    prismaModels: ["SalesOrder", "SalesOrderItem", "Customer", "Product"],
    rawSqlTables: [],
    externalSources: ["Nomus sync sales-orders"],
    derivedFrom: [],
    hardcodedAllowed: ["STATUS_LABELS — enum de status do pedido"],
    hardcodedSuspicions: [],
    status: "ok",
    notes: [],
  },
  {
    id: "sold-products",
    module: "Comercial",
    feature: "Produtos Vendidos",
    frontendRoutes: ["/commercial/sold-products"],
    backendEndpoints: [
      "/api/commercial/sold-products",
      "/api/commercial/sold-products/export.xlsx",
      "/api/commercial/sold-products/filter-options",
    ],
    files: [
      "src/components/commercial/SoldProductsReportPage.tsx",
      "src/lib/salesProductRanking.ts",
      "src/lib/salesProductRankingRoutes.ts",
    ],
    services: ["buildSoldProductsDashboardPayload"],
    prismaModels: ["SalesOrder", "SalesOrderItem", "Product", "Customer"],
    rawSqlTables: ["SalesOrder (salesOrderInvoicingSql)"],
    externalSources: ["SalesOrder.nomusRawResponse.nfes"],
    derivedFrom: [],
    hardcodedAllowed: ["groupCompanyCustomer — exclusão de CNPJs do grupo"],
    hardcodedSuspicions: [],
    status: "ok",
    notes: [],
  },
  {
    id: "sold-product-customers",
    module: "Comercial",
    feature: "Clientes compradores do produto",
    frontendRoutes: ["/commercial/sold-products/:productId/customers"],
    backendEndpoints: [
      "/api/commercial/sold-products/:productId/customers",
      "/api/commercial/sold-products/:productId/customers/export.csv",
    ],
    files: [
      "src/components/commercial/SoldProductCustomersPage.tsx",
      "src/lib/soldProductCustomers.ts",
    ],
    services: ["buildSoldProductCustomersPayload"],
    prismaModels: ["SalesOrder", "SalesOrderItem", "Product", "Customer"],
    rawSqlTables: [],
    externalSources: [],
    derivedFrom: ["salesProductRanking line contexts"],
    hardcodedAllowed: [],
    hardcodedSuspicions: [],
    status: "derived",
    notes: ["Filtro de cliente herdado da página Produtos Vendidos via URL."],
  },
  {
    id: "material-demand",
    module: "Comercial",
    feature: "Uso de Matéria-Prima",
    frontendRoutes: ["/sales-orders/material-demand", "/products/material-demand"],
    backendEndpoints: [
      "/api/sales-orders/material-demand/summary",
      "/api/sales-orders/material-demand/planned-vs-realized",
    ],
    files: [
      "src/components/contextual/ProductMaterialDemandDashboard.tsx",
      "server.ts",
      "src/lib/materialDemandPlannedRealized.ts",
    ],
    services: [
      "buildMaterialDemandDataset",
      "buildMaterialDemandPlannedVsRealizedDataset",
      "buildOpenBookRawMaterialExplosionPerUnit",
    ],
    prismaModels: ["SalesOrder", "SalesOrderItem", "Product", "ProductBOM"],
    rawSqlTables: [],
    externalSources: [],
    derivedFrom: ["ProductBOM / open book explosion"],
    hardcodedAllowed: [],
    hardcodedSuspicions: [],
    status: "derived",
    notes: ["Previsto de SalesOrder; realizado via NF em nomusRawResponse."],
  },
  {
    id: "sales-funnel",
    module: "Comercial",
    feature: "Funil de Vendas / Dashboard comercial",
    frontendRoutes: ["/dashboard"],
    backendEndpoints: ["/api/dashboard/executive"],
    files: [
      "src/lib/salesFunnelDashboardRules.ts",
      "src/lib/salesOrderDashboardRules.ts",
    ],
    services: ["buildSalesFunnelDashboard"],
    prismaModels: ["SalesOrder"],
    rawSqlTables: [],
    externalSources: [],
    derivedFrom: [],
    hardcodedAllowed: ["TARGET_GROWTH_FACTOR = 1.2 — meta documentada (+20%)"],
    hardcodedSuspicions: [],
    status: "attention",
    notes: ["Meta percentual fixa; revisar se deve vir de configuração futura."],
  },
  {
    id: "crm-commercial",
    module: "CRM",
    feature: "CRM Comercial / Carteira",
    frontendRoutes: ["/crm"],
    backendEndpoints: ["/api/crm/customers", "/api/crm/management-dashboard"],
    files: ["src/components/CrmModule.tsx", "src/lib/crmCommercialIntelligence.ts"],
    services: [
      "buildCrmCommercialIntelligenceResponse",
      "buildCrmManagementDashboardResponse",
    ],
    prismaModels: ["Customer", "SalesOrder", "CommercialActivity", "CrmCustomerProfile"],
    rawSqlTables: ["SalesOrder (crm SQL helpers)"],
    externalSources: [],
    derivedFrom: [],
    hardcodedAllowed: ["Busca livre intencional na carteira"],
    hardcodedSuspicions: [],
    status: "ok",
    notes: [],
  },
  {
    id: "customer-intelligence",
    module: "CRM",
    feature: "Cliente 360º / Inteligência do Cliente",
    frontendRoutes: ["/crm/customers/:customerId/intelligence"],
    backendEndpoints: ["/api/crm/customers/:customerId/intelligence"],
    files: [
      "src/components/crm/CustomerIntelligencePage.tsx",
      "src/lib/customerIntelligence.ts",
      "src/lib/customerIntelligenceRoutes.ts",
    ],
    services: ["buildCustomerIntelligenceResponse"],
    prismaModels: [
      "Customer",
      "SalesOrder",
      "SalesOrderItem",
      "Product",
      "CommercialActivity",
      "NomusAccountsReceivable",
    ],
    rawSqlTables: [],
    externalSources: [],
    derivedFrom: [
      "customerCommercialSalesOrderView",
      "financeAccountsReceivableManagement",
    ],
    hardcodedAllowed: ["Regras ABC documentadas em customerCommercialShared"],
    hardcodedSuspicions: [],
    status: "ok",
    notes: ["Cliente vem de route param :customerId."],
  },
  {
    id: "customer-registry",
    module: "Clientes",
    feature: "Cadastro de Clientes",
    frontendRoutes: ["/customers"],
    backendEndpoints: ["/api/customers", "/api/customers/search"],
    files: ["src/components/CustomerModule.tsx", "src/lib/customerListQuery.ts"],
    services: ["buildCustomerSearchWhere"],
    prismaModels: ["Customer"],
    rawSqlTables: [],
    externalSources: ["Nomus customers sync"],
    derivedFrom: [],
    hardcodedAllowed: [],
    hardcodedSuspicions: [],
    status: "ok",
    notes: [],
  },
  {
    id: "projects",
    module: "Projetos",
    feature: "Simulações e custos de projeto",
    frontendRoutes: ["/projects", "/projects/:id"],
    backendEndpoints: ["/api/projects", "/api/projects/lookup/customers"],
    files: [
      "src/components/ProjectsModule.tsx",
      "src/lib/projectsRoutes.ts",
      "src/lib/projectsCalculations.ts",
    ],
    services: ["buildProjectEngineeringCostRollup"],
    prismaModels: ["Project", "Product", "ProductBOM"],
    rawSqlTables: [],
    externalSources: [],
    derivedFrom: ["Product official BOM / cost analysis"],
    hardcodedAllowed: ["Cliente simulado manual no ProjectCustomerLookupField"],
    hardcodedSuspicions: [],
    status: "derived",
    notes: [],
  },
  {
    id: "nomus-sync",
    module: "Nomus",
    feature: "Sync integração Nomus",
    frontendRoutes: ["/settings/nomus-sync"],
    backendEndpoints: [
      "/api/settings/nomus-sync/daily-run",
      "/api/settings/nomus-sync/accounts-receivable-run",
      "/api/settings/nomus-sync/accounts-payable-run",
      "/api/settings/nomus-sync/nfes-run",
    ],
    files: [
      "src/lib/nomusDailySyncRunner.ts",
      "src/lib/nomusAccountsReceivableSyncRunner.ts",
      "src/lib/nomusAccountsPayableSyncRunner.ts",
      "src/lib/nomusNfesSyncRunner.ts",
    ],
    services: ["runNomusDailySync"],
    prismaModels: [
      "IntegrationRun",
      "Customer",
      "Product",
      "SalesOrder",
      "NomusAccountsReceivable",
      "NomusAccountsPayable",
      "NomusNfe",
    ],
    rawSqlTables: [],
    externalSources: ["Nomus REST/API"],
    derivedFrom: [],
    hardcodedAllowed: ["NOMUS_SYNC_TARGETS"],
    hardcodedSuspicions: [],
    status: "ok",
    notes: [],
  },
  {
    id: "finance-exports",
    module: "Financeiro",
    feature: "Exportações financeiras",
    frontendRoutes: ["botões export em AR/AP/Cash Flow"],
    backendEndpoints: [
      "/api/finance/accounts-receivable/export",
      "/api/finance/accounts-payable/export",
      "/api/finance/cash-flow/export",
    ],
    files: [
      "src/lib/financeAccountsReceivableExport.ts",
      "src/lib/financeAccountsPayableExport.ts",
      "src/lib/financeCashFlowExport.ts",
    ],
    services: ["buildFinanceArExportCsv"],
    prismaModels: ["NomusAccountsReceivable", "NomusAccountsPayable"],
    rawSqlTables: [],
    externalSources: [],
    derivedFrom: ["Datasets dos dashboards respectivos"],
    hardcodedAllowed: ["Cabeçalhos CSV"],
    hardcodedSuspicions: [],
    status: "derived",
    notes: ["Export usa filtros aplicados."],
  },
  {
    id: "finance-calendar",
    module: "Financeiro",
    feature: "Calendário financeiro",
    frontendRoutes: ["/finance/cash-flow (aba calendário)"],
    backendEndpoints: ["/api/finance/cash-flow/dashboard"],
    files: [
      "src/lib/financeCashFlowCalendar.ts",
      "src/components/finance/cash-flow/FinanceCashFlowCalendar.tsx",
    ],
    services: ["buildFinanceCashFlowCalendar"],
    prismaModels: ["NomusAccountsReceivable", "NomusAccountsPayable"],
    rawSqlTables: [],
    externalSources: [],
    derivedFrom: ["financeCashFlowDashboard"],
    hardcodedAllowed: [],
    hardcodedSuspicions: [],
    status: "derived",
    notes: [],
  },
];

export function getSystemDataLineageEntry(id: string): SystemDataLineageEntry | undefined {
  return SYSTEM_DATA_LINEAGE.find((e) => e.id === id);
}

export function summarizeSystemDataLineage(
  entries: SystemDataLineageEntry[] = SYSTEM_DATA_LINEAGE
): {
  total: number;
  byStatus: Record<SystemDataLineageStatus, number>;
  pendingIds: string[];
  riskIds: string[];
} {
  const byStatus: Record<SystemDataLineageStatus, number> = {
    ok: 0,
    derived: 0,
    "static-ui": 0,
    attention: 0,
    risk: 0,
    pending: 0,
  };
  const pendingIds: string[] = [];
  const riskIds: string[] = [];
  for (const e of entries) {
    byStatus[e.status] += 1;
    if (e.status === "pending") pendingIds.push(e.id);
    if (e.status === "risk") riskIds.push(e.id);
  }
  return { total: entries.length, byStatus, pendingIds, riskIds };
}

export const CRITICAL_LINEAGE_IDS = [
  "finance-ar",
  "finance-ap",
  "finance-cash-flow",
  "finance-executive-report",
  "customer-intelligence",
  "sold-products",
  "sold-product-customers",
  "sales-orders",
  "material-demand",
] as const;

export function assertCriticalLineageCoverage(
  entries: SystemDataLineageEntry[] = SYSTEM_DATA_LINEAGE
): { ok: boolean; missing: string[] } {
  const ids = new Set(entries.map((e) => e.id));
  const missing = CRITICAL_LINEAGE_IDS.filter((id) => !ids.has(id));
  return { ok: missing.length === 0, missing: [...missing] };
}
