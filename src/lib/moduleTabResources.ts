/**
 * Mapa UI de abas críticas → resourceKey (fonte única browser-safe).
 */

export const TabResourceKeys = {
  CRM_GESTAO_GERAL: "comercial.crm.tab.gestao_geral",
  CRM_GESTAO_VENDEDOR: "comercial.crm.tab.gestao_vendedor",
  CRM_CARTEIRA: "comercial.crm.tab.carteira_clientes",
  CRM_CLIENTE_360: "comercial.crm.tab.cliente_360",
  COMISSOES_FECHAMENTO: "comissoes.tab.fechamento_mes",
  COMISSOES_FECHAMENTOS: "comissoes.tab.fechamentos",
  COMISSOES_EXCECOES: "comissoes.tab.excecoes_cliente",
  COMISSOES_PROVISAO_PEDIDO: "comissoes.tab.provisao_pedido",
  COMISSOES_RELATORIOS: "comissoes.tab.relatorios",
  COMISSOES_REPROCESSAR: "comissoes.tab.reprocessar",
  COMISSOES_DASHBOARD: "comissoes.tab.dashboard",
  COMISSOES_PREVISTAS: "comissoes.tab.previstas",
  COMISSOES_CONFIRMADAS: "comissoes.tab.confirmadas",
  COMISSOES_LIBERACAO: "comissoes.tab.liberacao",
  COMISSOES_PAGAMENTOS: "comissoes.tab.pagamentos",
  COMISSOES_PESSOAS: "comissoes.tab.pessoas",
  COMISSOES_REGRAS: "comissoes.tab.regras",
  COMISSOES_AUDITORIA: "comissoes.tab.auditoria",
  COMISSOES_CONFIG: "comissoes.tab.configuracoes",
  SUPRIMENTOS_CATALOGO: "suprimentos.tab.catalogo",
  MI_HOME: "suprimentos.inteligencia_mercado.tab.home",
  MI_360: "suprimentos.inteligencia_mercado.tab.materia_prima_360",
  MI_FORNECEDORES: "suprimentos.inteligencia_mercado.tab.fornecedores",
  MI_ALERTAS: "suprimentos.inteligencia_mercado.tab.alertas",
  MI_CONFIG: "suprimentos.inteligencia_mercado.tab.configuracoes",
} as const;

export type CrmUiTabId = "general" | "seller" | "portfolio";

export const CRM_UI_TABS: ReadonlyArray<{
  id: CrmUiTabId;
  resourceKey: string;
  label: string;
  ownLabel?: string;
}> = [
  {
    id: "general",
    resourceKey: TabResourceKeys.CRM_GESTAO_GERAL,
    label: "Gestão Geral",
  },
  {
    id: "seller",
    resourceKey: TabResourceKeys.CRM_GESTAO_VENDEDOR,
    label: "Gestão por Responsável",
    ownLabel: "Meu Dashboard",
  },
  {
    id: "portfolio",
    resourceKey: TabResourceKeys.CRM_CARTEIRA,
    label: "Carteira de Clientes",
  },
];

export type CommissionsLiveTabId =
  | "monthlyClosing"
  | "closings"
  | "customerExclusions"
  | "orderProvision"
  | "reports"
  | "reprocess";

export const COMMISSIONS_LIVE_UI_TABS: ReadonlyArray<{
  id: CommissionsLiveTabId;
  resourceKey: string;
  label: string;
}> = [
  {
    id: "monthlyClosing",
    resourceKey: TabResourceKeys.COMISSOES_FECHAMENTO,
    label: "Fechamento do mês",
  },
  {
    id: "closings",
    resourceKey: TabResourceKeys.COMISSOES_FECHAMENTOS,
    label: "Fechamentos",
  },
  {
    id: "customerExclusions",
    resourceKey: TabResourceKeys.COMISSOES_EXCECOES,
    label: "Exceções por cliente",
  },
  {
    id: "orderProvision",
    resourceKey: TabResourceKeys.COMISSOES_PROVISAO_PEDIDO,
    label: "Provisão por pedido",
  },
  {
    id: "reports",
    resourceKey: TabResourceKeys.COMISSOES_RELATORIOS,
    label: "Relatórios",
  },
  {
    id: "reprocess",
    resourceKey: TabResourceKeys.COMISSOES_REPROCESSAR,
    label: "Reprocessar",
  },
];

export const COMMISSIONS_CATALOG_TAB_RESOURCE_BY_LEGACY: Record<string, string> = {
  dashboard: TabResourceKeys.COMISSOES_DASHBOARD,
  forecast: TabResourceKeys.COMISSOES_PREVISTAS,
  confirmed: TabResourceKeys.COMISSOES_CONFIRMADAS,
  releases: TabResourceKeys.COMISSOES_LIBERACAO,
  payments: TabResourceKeys.COMISSOES_PAGAMENTOS,
  persons: TabResourceKeys.COMISSOES_PESSOAS,
  rules: TabResourceKeys.COMISSOES_REGRAS,
  audit: TabResourceKeys.COMISSOES_AUDITORIA,
  settings: TabResourceKeys.COMISSOES_CONFIG,
};

export type MaterialsUiSectionId = "catalog" | "marketIntelligence";

export const MATERIALS_UI_SECTIONS: ReadonlyArray<{
  id: MaterialsUiSectionId;
  resourceKey: string;
  label: string;
}> = [
  {
    id: "catalog",
    resourceKey: TabResourceKeys.SUPRIMENTOS_CATALOGO,
    label: "Matérias-primas",
  },
  {
    id: "marketIntelligence",
    resourceKey: TabResourceKeys.MI_HOME,
    label: "Inteligência de Mercado",
  },
];

export const MARKET_INTELLIGENCE_SECTION_KEYS = {
  home: TabResourceKeys.MI_HOME,
  material360: TabResourceKeys.MI_360,
  suppliers: TabResourceKeys.MI_FORNECEDORES,
  alerts: TabResourceKeys.MI_ALERTAS,
  settings: TabResourceKeys.MI_CONFIG,
} as const;

/** Abas do modal de produto → resourceKey canônico (Prompt 13). */
export const PRODUCT_TAB_RESOURCE_KEYS: Record<
  "info" | "bom" | "routing" | "tree" | "cost" | "composition" | "history",
  string
> = {
  info: "engineering.products.tab.info",
  bom: "engineering.products.tab.bom",
  routing: "engineering.products.tab.routing",
  tree: "engineering.products.tab.tree",
  cost: "engineering.products.tab.cost",
  composition: "engineering.products.tab.composition",
  history: "engineering.products.tab.info",
};

export const PRODUCT_UI_TABS: ReadonlyArray<{
  id: "info" | "bom" | "routing" | "tree" | "cost" | "composition" | "history";
  resourceKey: string;
  label: string;
}> = [
  { id: "info", resourceKey: PRODUCT_TAB_RESOURCE_KEYS.info, label: "Info" },
  { id: "bom", resourceKey: PRODUCT_TAB_RESOURCE_KEYS.bom, label: "BOM" },
  { id: "routing", resourceKey: PRODUCT_TAB_RESOURCE_KEYS.routing, label: "Roteiro" },
  { id: "tree", resourceKey: PRODUCT_TAB_RESOURCE_KEYS.tree, label: "Árvore" },
  { id: "cost", resourceKey: PRODUCT_TAB_RESOURCE_KEYS.cost, label: "Custo" },
  {
    id: "composition",
    resourceKey: PRODUCT_TAB_RESOURCE_KEYS.composition,
    label: "Composição",
  },
  { id: "history", resourceKey: PRODUCT_TAB_RESOURCE_KEYS.history, label: "Histórico" },
];

/** Estoque — abas com resourceKey fino ou herança do módulo. */
export type InventoryUiTabId =
  | "overview"
  | "items"
  | "warehouses"
  | "balances"
  | "movements"
  | "counts"
  | "reservations"
  | "audit";

export const INVENTORY_UI_TABS: ReadonlyArray<{
  id: InventoryUiTabId;
  resourceKey: string;
  label: string;
}> = [
  { id: "overview", resourceKey: "operations.inventory", label: "Visão Geral" },
  { id: "items", resourceKey: "operations.inventory.items", label: "Itens" },
  {
    id: "warehouses",
    resourceKey: "operations.inventory.warehouses",
    label: "Almoxarifados",
  },
  { id: "balances", resourceKey: "operations.inventory", label: "Saldos" },
  { id: "implantation", resourceKey: "operations.inventory.movements", label: "Implantação" },
  {
    id: "movements",
    resourceKey: "operations.inventory.movements",
    label: "Movimentações",
  },
  {
    id: "counts",
    resourceKey: "operations.inventory.counts",
    label: "Conferência Física",
  },
  { id: "reservations", resourceKey: "operations.inventory", label: "Reservas" },
  { id: "audit", resourceKey: "operations.inventory", label: "Auditoria" },
];

/** Configurações — hub sections → contrato admin.settings.*. */
export type SettingsHubUiSectionId =
  | "globals"
  | "branding"
  | "operational"
  | "nomusSync"
  | "priceTables"
  | "security"
  | "integrations"
  | "system";

export const SETTINGS_HUB_UI_SECTIONS: ReadonlyArray<{
  id: SettingsHubUiSectionId;
  resourceKey: string;
  label: string;
}> = [
  {
    id: "globals",
    resourceKey: "admin.settings.global_params",
    label: "Gerais / Parâmetros Globais",
  },
  {
    id: "branding",
    resourceKey: "admin.settings.branding",
    label: "Identidade Visual",
  },
  {
    id: "operational",
    resourceKey: "admin.settings.operational",
    label: "Estrutura Operacional",
  },
  {
    id: "nomusSync",
    resourceKey: "admin.settings.nomus_sync",
    label: "Logs Nomus",
  },
  {
    id: "priceTables",
    resourceKey: "admin.settings.price_tables",
    label: "Tabelas de Preço",
  },
  {
    id: "security",
    resourceKey: "admin.settings.security",
    label: "Usuários e Permissões",
  },
  {
    id: "integrations",
    resourceKey: "admin.settings",
    label: "Integrações",
  },
  { id: "system", resourceKey: "admin.settings", label: "Sistema" },
];

