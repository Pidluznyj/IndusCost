/**
 * Auditoria técnica — Etapa 1: Inteligência do Cliente / Central 360º do Cliente.
 *
 * Mapa e contrato de arquitetura derivado do código existente (popup "Visão comercial
 * do cliente"). Não altera cálculos nem implementa rota/endpoint final.
 *
 * Referências validadas em 2026-06-17:
 * - `src/components/customers/CustomerCommercial360.tsx` (modal atual)
 * - `GET /api/customers/:id/commercial-360` em `server.ts`
 * - `src/lib/customerCommercialSalesOrderView.ts` (motor comercial ativo)
 * - `docs/commercial/SALES_ORDER_AS_COMMERCIAL_SOURCE.md`
 */

export type CustomerIntelligenceAuditFileRef = {
  path: string;
  role: string;
};

export type CustomerIntelligenceDataSource = {
  id: string;
  label: string;
  /** Prisma model, HTTP endpoint ou módulo de lib. */
  origin: string;
  usedBy: "modal" | "crm_cockpit" | "both" | "future";
  /** Onde roda o processamento principal. */
  computeLayer: "frontend" | "backend" | "mixed";
  notes?: string;
};

export type CustomerIntelligenceReusableFunction = {
  id: string;
  module: string;
  exportName: string;
  purpose: string;
  usedByModal: boolean;
  recommendedFor360: boolean;
};

export type CustomerIntelligenceMissingData = {
  id: string;
  requirement: string;
  currentState: "absent" | "partial" | "separate_module";
  suggestedSource?: string;
  uiTreatment: "nao_informado" | "warning" | "derive_from_existing";
};

export type CustomerIntelligenceProposedRoute = {
  id: string;
  path: string;
  preferred: boolean;
  entryPoints: string[];
  notes?: string;
};

export type CustomerIntelligenceProposedEndpoint = {
  method: "GET";
  path: string;
  permissions: string[];
  aggregates: string[];
  /** Endpoints existentes a compor ou delegar (BFF). */
  composesExisting: string[];
};

export type CustomerIntelligenceProposedTab = {
  id: string;
  label: string;
  summary: string;
  primarySources: string[];
  existingUiToReuse?: string[];
};

export type CustomerIntelligenceBusinessRule = {
  id: string;
  rule: string;
  enforcedIn: string[];
  modalCompliant: boolean | "partial";
  notes?: string;
};

export type CustomerIntelligenceRisk = {
  id: string;
  severity: "low" | "medium" | "high";
  description: string;
  mitigation?: string;
};

/** Popup/modal e arquivos que o compõem ou abrem. */
export const currentModalFiles: CustomerIntelligenceAuditFileRef[] = [
  {
    path: "src/components/customers/CustomerCommercial360.tsx",
    role: "Componente principal do modal «Visão comercial do cliente» — UI, filtros client-side, KPIs, histórico.",
  },
  {
    path: "src/components/CustomerModule.tsx",
    role: "Abre o modal via state `commercial360CustomerId`; botão «Visão comercial do cliente» na listagem.",
  },
  {
    path: "server.ts",
    role: "Handler `GET /api/customers/:id/commercial-360` — carrega Customer, SalesOrder + itens, ABC portfólio.",
  },
  {
    path: "src/lib/customerCommercialSalesOrderView.ts",
    role: "Motor comercial ativo (saúde, recompra, tendência, cross-sell, status válidos).",
  },
  {
    path: "src/lib/customerCommercialShared.ts",
    role: "Tipos ABC Pareto e `buildPortfolioAbcForCustomer` (via reexport em SalesOrderView).",
  },
  {
    path: "docs/commercial/SALES_ORDER_AS_COMMERCIAL_SOURCE.md",
    role: "Documentação oficial: SalesOrder = base comercial; Proposal = pré-venda auxiliar.",
  },
];

/** Feature relacionada mas distinta — consulta CNPJ / inteligência cadastral externa. */
export const relatedButSeparateFiles: CustomerIntelligenceAuditFileRef[] = [
  {
    path: "src/components/customers/CustomerCnpjIntelligencePanel.tsx",
    role: "Painel «Consulta CNPJ» — lookup externo, risco cadastral; não substitui o 360 comercial.",
  },
  {
    path: "src/components/CrmModule.tsx",
    role: "CRM Comercial — cockpit com `GET /api/crm/customers/:id/commercial-intelligence` e atividades.",
  },
];

/** Fontes de dados consumidas hoje pelo popup ou adjacentes reutilizáveis. */
export const currentDataSources: CustomerIntelligenceDataSource[] = [
  {
    id: "sales_order",
    label: "Pedidos de Venda (SalesOrder + SalesOrderItem + Product)",
    origin: "prisma.SalesOrder",
    usedBy: "both",
    computeLayer: "mixed",
    notes:
      "Fonte comercial principal. Modal: `commercial-360`. Match por customerId ou CNPJ (taxId). Itens incluem Product.",
  },
  {
    id: "customer",
    label: "Cadastro de Cliente (Customer)",
    origin: "prisma.Customer",
    usedBy: "both",
    computeLayer: "backend",
    notes: "companyName, tradeName, taxId, endereço, segment, accountOwner, createdAt, status.",
  },
  {
    id: "portfolio_abc_global",
    label: "ABC portfólio global (groupBy receita por customerId)",
    origin: "server.ts + buildPortfolioAbcFromSalesOrders",
    usedBy: "modal",
    computeLayer: "backend",
    notes:
      "Calculado no endpoint commercial-360 sobre todos os clientes (status NOT IN CANCELLED/ERROR). Não re-filtra pelo modal.",
  },
  {
    id: "nomus_invoicing_flag",
    label: "Flag hasInvoicing (nomusRawResponse)",
    origin: "salesOrderHasInvoicing(nomusRawResponse)",
    usedBy: "modal",
    computeLayer: "backend",
    notes: "Proxy de faturamento processado no Nomus; NF-e fiscal canônica é camada separada.",
  },
  {
    id: "proposal_negotiation",
    label: "Propostas em negociação (auxiliar)",
    origin: "prisma.Proposal",
    usedBy: "crm_cockpit",
    computeLayer: "backend",
    notes: "Usado em commercial-intelligence (DRAFT/ANALYSIS/SENT). Modal 360 não consome propostas.",
  },
  {
    id: "commercial_activity",
    label: "Atividades comerciais CRM (CommercialActivity)",
    origin: "prisma.CommercialActivity",
    usedBy: "crm_cockpit",
    computeLayer: "backend",
    notes:
      "GET /api/customers/:customerId/commercial-activities — contatos, follow-up, nextActionAt. Não exibido no modal 360.",
  },
  {
    id: "crm_profile",
    label: "Perfil de relacionamento (CrmCustomerProfile)",
    origin: "prisma.CrmCustomerProfile",
    usedBy: "crm_cockpit",
    computeLayer: "backend",
    notes: "GET /api/crm/customers/:customerId/profile — preferências e temperatura comercial.",
  },
  {
    id: "ar_canonical",
    label: "Contas a Receber gerencial canônico (NomusAccountsReceivable)",
    origin: "loadFinanceArManagementRowsFromPrisma / financeAccountsReceivableManagement.ts",
    usedBy: "future",
    computeLayer: "backend",
    notes:
      "Vínculo por personCnpj ↔ Customer.taxId. Base saneada AR; não integrada ao modal 360 hoje.",
  },
  {
    id: "nfe_fiscal",
    label: "NF-e / faturamento fiscal",
    origin: "nomusNfe* / financeBillingAuditRules",
    usedBy: "future",
    computeLayer: "backend",
    notes: "Para faturamento fiscal quando necessário; distinto de hasInvoicing em pedido.",
  },
];

/** Funções/libs reutilizáveis para a futura tela 360. */
export const reusableFunctions: CustomerIntelligenceReusableFunction[] = [
  {
    id: "phase2_intel",
    module: "src/lib/customerCommercialSalesOrderView.ts",
    exportName: "computeCommercialPhase2FromSalesOrders",
    purpose: "Saúde comercial, segmento, recompra, tendência 180d, alertas estratégicos, next actions.",
    usedByModal: true,
    recommendedFor360: true,
  },
  {
    id: "cross_sell_mix",
    module: "src/lib/customerCommercialSalesOrderView.ts",
    exportName: "enrichCrossSellFromSalesOrderMix",
    purpose: "Sugestões de cross-sell a partir do mix de SKUs.",
    usedByModal: true,
    recommendedFor360: true,
  },
  {
    id: "abc_portfolio",
    module: "src/lib/customerCommercialSalesOrderView.ts",
    exportName: "buildPortfolioAbcFromSalesOrders",
    purpose: "Curva ABC e ranking de receita no portfólio.",
    usedByModal: true,
    recommendedFor360: true,
  },
  {
    id: "metrics_filter",
    module: "src/lib/customerCommercialSalesOrderView.ts",
    exportName: "isCommercialMetricsSalesOrder",
    purpose: "Exclui CANCELLED e ERROR dos indicadores comerciais principais.",
    usedByModal: true,
    recommendedFor360: true,
  },
  {
    id: "open_portfolio",
    module: "src/lib/customerCommercialSalesOrderView.ts",
    exportName: "isCommercialOpenSalesOrder",
    purpose: "Carteira em aberto (pedido válido sem faturamento processado).",
    usedByModal: true,
    recommendedFor360: true,
  },
  {
    id: "customer_match",
    module: "src/lib/customerCommercialSalesOrderView.ts",
    exportName: "salesOrderMatchesCustomer",
    purpose: "Match pedido ↔ cliente por id ou documento normalizado.",
    usedByModal: true,
    recommendedFor360: true,
  },
  {
    id: "crm_commercial_intel",
    module: "src/lib/crmCommercialIntelligence.ts",
    exportName: "buildCrmCommercialIntelligenceResponse",
    purpose: "Sinais CRM, pedidos sem follow-up, propostas em negociação (cockpit).",
    usedByModal: false,
    recommendedFor360: true,
  },
  {
    id: "customer_indicators",
    module: "src/lib/customerIndicators.ts",
    exportName: "buildCustomerIndicatorsPayload",
    purpose: "Agregações UF/segmento/carteira no dashboard de clientes.",
    usedByModal: false,
    recommendedFor360: true,
  },
  {
    id: "ar_management",
    module: "src/lib/financeAccountsReceivableManagement.ts",
    exportName: "loadFinanceArManagementRowsFromPrisma",
    purpose: "Base AR canônica para carteira em aberto financeira e inadimplência.",
    usedByModal: false,
    recommendedFor360: true,
  },
  {
    id: "internal_group_filter",
    module: "src/lib/financeInternalGroupExclusions.ts",
    exportName: "isEconomicGroupCnpj",
    purpose: "Filtro cliente interno / grupo econômico (reutilizar padrão financeiro).",
    usedByModal: false,
    recommendedFor360: true,
  },
  {
    id: "commercial_activity_api",
    module: "src/lib/commercialActivityApi.ts",
    exportName: "mapCommercialActivityForApi",
    purpose: "Mapeamento de atividades CRM para API/UI.",
    usedByModal: false,
    recommendedFor360: true,
  },
];

/** Lacunas em relação ao objetivo final da Central 360º. */
export const missingData: CustomerIntelligenceMissingData[] = [
  {
    id: "seasonality",
    requirement: "Meses em que mais compra / sazonalidade",
    currentState: "absent",
    suggestedSource: "Agregar issueDate de SalesOrder válidos por mês",
    uiTreatment: "derive_from_existing",
  },
  {
    id: "revenue_by_year",
    requirement: "Receita por ano e quantidade de pedidos por ano",
    currentState: "partial",
    suggestedSource: "SalesOrder válidos — modal calcula KPIs filtrados mas sem série anual dedicada",
    uiTreatment: "derive_from_existing",
  },
  {
    id: "first_last_purchase",
    requirement: "Data da primeira e última compra explícitas no cabeçalho",
    currentState: "partial",
    suggestedSource: "min/max issueDate em pedidos válidos",
    uiTreatment: "derive_from_existing",
  },
  {
    id: "abandoned_products",
    requirement: "Produtos comprados vs produtos abandonados",
    currentState: "partial",
    suggestedSource: "Mix histórico SalesOrderItem — regra de abandono a definir (ex.: sem compra em N meses)",
    uiTreatment: "warning",
  },
  {
    id: "ar_open_overdue",
    requirement: "Carteira em aberto financeira (AR) e inadimplência",
    currentState: "absent",
    suggestedSource: "NomusAccountsReceivable filtrado por personCnpj = Customer.taxId",
    uiTreatment: "nao_informado",
  },
  {
    id: "crm_contact_history",
    requirement: "Histórico de contatos CRM no mesmo painel",
    currentState: "separate_module",
    suggestedSource: "CommercialActivity via /api/customers/:id/commercial-activities",
    uiTreatment: "derive_from_existing",
  },
  {
    id: "account_owner",
    requirement: "Responsável comercial cadastral (accountOwner)",
    currentState: "partial",
    suggestedSource: "Customer.accountOwner existe; modal usa responsible do último pedido",
    uiTreatment: "nao_informado",
  },
  {
    id: "economic_group_toggle",
    requirement: "Filtro cliente interno / grupo econômico",
    currentState: "absent",
    suggestedSource: "financeInternalGroupExclusions + nomusNfeClassification CNPJs",
    uiTreatment: "warning",
  },
  {
    id: "nfe_fiscal_detail",
    requirement: "Faturamento fiscal detalhado (NF-e)",
    currentState: "separate_module",
    suggestedSource: "Módulo NF-e / nomusNfeBillingEligibility",
    uiTreatment: "nao_informado",
  },
  {
    id: "persisted_health_score",
    requirement: "Health score persistido",
    currentState: "absent",
    suggestedSource: "docs/database-field-roadmap.md — calculado em runtime hoje",
    uiTreatment: "derive_from_existing",
  },
];

/** Rotas frontend propostas (Etapa 2+). */
export const proposedRoutes: CustomerIntelligenceProposedRoute[] = [
  {
    id: "crm_primary",
    path: "/crm/customers/:customerId/intelligence",
    preferred: true,
    entryPoints: [
      "CRM Comercial (CrmModule) — link «Inteligência do Cliente» no cockpit",
      "Listagem de clientes (CustomerModule) — ação além do ícone de resumo rápido",
    ],
    notes: "Alinha com namespace `/api/crm/customers/*` já existente.",
  },
  {
    id: "customers_compat",
    path: "/customers/:customerId/intelligence",
    preferred: false,
    entryPoints: ["Redirect ou alias compatível com padrão `/customers` e `/customers/indicators`"],
    notes: "Alternativa para deep-link a partir do módulo Clientes sem prefixo CRM.",
  },
];

/** Endpoint backend proposto (Etapa 2+). */
export const proposedEndpoint: CustomerIntelligenceProposedEndpoint = {
  method: "GET",
  path: "/api/crm/customers/:customerId/intelligence",
  permissions: [
    "crm.customer_cockpit.view",
    "customers.commercial360.view",
    "customers.view",
    "finance.accountsReceivable.view",
  ],
  aggregates: [
    "customer_summary",
    "commercial_kpis",
    "sales_order_history",
    "portfolio_abc",
    "product_mix",
    "seasonality",
    "crm_activities",
    "crm_profile",
    "ar_summary",
    "signals_and_opportunities",
  ],
  composesExisting: [
    "GET /api/customers/:id/commercial-360",
    "GET /api/crm/customers/:customerId/commercial-intelligence",
    "GET /api/customers/:customerId/commercial-activities",
    "GET /api/crm/customers/:customerId/profile",
    "Finance AR: loadFinanceArManagementRowsFromPrisma (filtro personCnpj)",
  ],
};

/** Abas propostas para a tela completa. */
export const proposedTabs: CustomerIntelligenceProposedTab[] = [
  {
    id: "overview",
    label: "Visão geral",
    summary: "Quem é o cliente, datas-chave, responsável, saúde comercial, KPIs principais.",
    primarySources: ["Customer", "SalesOrder", "computeCommercialPhase2FromSalesOrders"],
    existingUiToReuse: ["CustomerCommercial360 — bloco phase2 e KPIs"],
  },
  {
    id: "commercial",
    label: "Comercial",
    summary: "Histórico de pedidos, filtros, ABC, tendência, recompra, mix de produtos.",
    primarySources: ["SalesOrder", "portfolio_abc", "customerCommercialSalesOrderView"],
    existingUiToReuse: ["CustomerCommercial360 — filtros, tabela histórico, mix"],
  },
  {
    id: "financial",
    label: "Financeiro",
    summary: "Carteira AR em aberto, vencidos, inadimplência — base canônica NomusAccountsReceivable.",
    primarySources: ["NomusAccountsReceivable", "financeAccountsReceivableManagement"],
  },
  {
    id: "crm",
    label: "CRM",
    summary: "Contatos, follow-up, próximas ações, perfil de relacionamento.",
    primarySources: ["CommercialActivity", "CrmCustomerProfile", "crmCommercialIntelligence"],
    existingUiToReuse: ["CrmModule — painéis de atividade e inteligência"],
  },
  {
    id: "products",
    label: "Produtos",
    summary: "Produtos comprados, concentração, oportunidades de cross-sell e abandono.",
    primarySources: ["SalesOrderItem", "enrichCrossSellFromSalesOrderMix"],
  },
  {
    id: "operations",
    label: "Operacional",
    summary: "Entregas, status de pedidos abertos, integração Nomus (fase futura).",
    primarySources: ["SalesOrder", "nomusRawResponse"],
  },
];

/** Regras de negócio acordadas para a Central 360º. */
export const businessRules: CustomerIntelligenceBusinessRule[] = [
  {
    id: "sales_order_primary",
    rule: "Visão comercial usa Pedidos de Venda (SalesOrder) como fonte principal.",
    enforcedIn: [
      "customerCommercialSalesOrderView.ts",
      "server.ts GET /api/customers/:id/commercial-360",
      "docs/commercial/SALES_ORDER_AS_COMMERCIAL_SOURCE.md",
    ],
    modalCompliant: true,
  },
  {
    id: "proposal_not_revenue",
    rule: "Propostas não devem ser fonte principal para receita comercial ou ABC.",
    enforcedIn: ["crmCommercialIntelligence.ts (bloco auxiliar)", "customerCommercialProposalLegacy.ts (@deprecated)"],
    modalCompliant: true,
    notes: "Modal 360 não usa propostas; cockpit CRM lista negociação aberta separadamente.",
  },
  {
    id: "exclude_cancelled_error",
    rule: "Pedidos CANCELLED e ERROR não entram nos indicadores comerciais principais.",
    enforcedIn: ["isCommercialMetricsSalesOrder", "server.ts groupBy ABC where notIn CANCELLED/ERROR"],
    modalCompliant: true,
  },
  {
    id: "ar_canonical",
    rule: "Financeiro usa Contas a Receber oficial/canônico (base gerencial AR).",
    enforcedIn: ["financeAccountsReceivableManagement.ts"],
    modalCompliant: false,
    notes: "Modal usa «carteira aberta» comercial (pedidos sem faturamento), não AR Nomus.",
  },
  {
    id: "nfe_when_needed",
    rule: "Faturamento fiscal usa NF-e quando necessário.",
    enforcedIn: ["nomusNfeBillingEligibility", "financeBillingAuditRules"],
    modalCompliant: "partial",
    notes: "Modal usa proxy hasInvoicing no pedido.",
  },
  {
    id: "economic_group_filterable",
    rule: "Cliente interno/grupo econômico deve ser filtrável.",
    enforcedIn: ["financeInternalGroupExclusions.ts", "salesProductRanking"],
    modalCompliant: false,
  },
  {
    id: "abc_on_filtered",
    rule: "ABC deve ser calculado sobre carteira filtrada.",
    enforcedIn: ["buildPortfolioAbcFromSalesOrders"],
    modalCompliant: "partial",
    notes:
      "Hoje ABC vem do backend global (todos clientes, sem filtros do modal). KPIs filtrados recalculam receita localmente.",
  },
  {
    id: "repurchase_sufficient_history",
    rule: "Recompra só deve ser calculada com histórico suficiente (≥2 pedidos válidos).",
    enforcedIn: ["computeCommercialPhase2FromSalesOrders — RepurchaseWindowStatus INSUFICIENTE"],
    modalCompliant: true,
  },
  {
    id: "missing_not_zero",
    rule: "Dados inexistentes devem aparecer como «não informado» ou warning, nunca zero falso.",
    enforcedIn: ["computeCommercialPhase2FromSalesOrders", "CustomerCommercial360 KPIs"],
    modalCompliant: "partial",
    notes: "Alguns KPIs usam 0 quando count=0; revisar na tela completa.",
  },
  {
    id: "no_hardcode",
    rule: "Não usar hardcode por cliente/CNPJ/valor.",
    enforcedIn: ["Código auditado — regra de produto"],
    modalCompliant: true,
  },
  {
    id: "keep_modal_summary",
    rule: "Popup «Visão comercial do cliente» permanece como resumo rápido na listagem.",
    enforcedIn: ["customerIntelligenceAudit.ts — decisão de arquitetura Etapa 1"],
    modalCompliant: true,
  },
  {
    id: "full_screen_tabs",
    rule: "Tela completa «Inteligência do Cliente» terá abas (comercial, financeiro, CRM, etc.).",
    enforcedIn: ["proposedTabs"],
    modalCompliant: false,
    notes: "Modal atual é single-page sem abas.",
  },
];

/** Riscos técnicos e de produto identificados na auditoria. */
export const risks: CustomerIntelligenceRisk[] = [
  {
    id: "dual_api",
    severity: "medium",
    description:
      "Dois endpoints paralelos: commercial-360 (modal) e commercial-intelligence (CRM). Risco de divergência de sinais.",
    mitigation: "Endpoint unificado `/intelligence` deve compor ambos ou deprecar gradualmente.",
  },
  {
    id: "abc_global_vs_filter",
    severity: "medium",
    description: "ABC/ranking calculados no portfólio global, enquanto KPIs do modal respeitam filtros locais.",
    mitigation: "Recalcular ABC sobre subset filtrado no backend ou documentar exceção na UI.",
  },
  {
    id: "ar_not_linked",
    severity: "high",
    description: "Inadimplência e AR aberto não vinculados ao modal; match personCnpj ↔ taxId precisa normalização.",
    mitigation: "Reutilizar normalizeCustomerDocument e base AR canônica com testes de match.",
  },
  {
    id: "open_portfolio_semantics",
    severity: "medium",
    description: "«Carteira aberta» comercial (pedido sem NF) ≠ saldo AR financeiro.",
    mitigation: "Separar labels e abas; não somar os dois como mesmo KPI.",
  },
  {
    id: "crm_not_in_modal",
    severity: "low",
    description: "Histórico CRM e próximas ações existem no CrmModule mas não no popup.",
    mitigation: "Aba CRM na tela completa consumindo endpoints já existentes.",
  },
];

/** Contrato exportado — mapa completo para testes e documentação em código. */
export const CUSTOMER_INTELLIGENCE_AUDIT_MAP = {
  auditVersion: "1.0.0",
  auditDate: "2026-06-17",
  stage: "etapa_1_auditoria",
  screenName: "Inteligência do Cliente",
  screenAlias: "Central 360º do Cliente",
  currentModalTitle: "Visão comercial do cliente",
  currentModalEndpoint: "GET /api/customers/:id/commercial-360",
  commercialPrimarySource: "SalesOrder",
  financialPrimarySource: "NomusAccountsReceivable (AR canônico gerencial)",
  proposalRole: "auxiliary_pre_sales_only",
  keepModalAsQuickSummary: true,
  fullScreenHasTabs: true,
  currentModalFiles,
  relatedButSeparateFiles,
  currentDataSources,
  reusableFunctions,
  missingData,
  proposedRoutes,
  proposedEndpoint,
  proposedTabs,
  businessRules,
  risks,
} as const;

export type CustomerIntelligenceAuditMap = typeof CUSTOMER_INTELLIGENCE_AUDIT_MAP;
