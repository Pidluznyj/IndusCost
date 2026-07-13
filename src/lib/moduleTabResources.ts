/**
 * Mapa UI de abas críticas → resourceKey (fonte única browser-safe).
 */

export const TabResourceKeys = {
  CRM_GESTAO_GERAL: "comercial.crm.tab.gestao_geral",
  CRM_GESTAO_VENDEDOR: "comercial.crm.tab.gestao_vendedor",
  CRM_CARTEIRA: "comercial.crm.tab.carteira_clientes",
  CRM_CLIENTE_360: "comercial.crm.tab.cliente_360",
  COMISSOES_FECHAMENTO: "comissoes.tab.fechamento_mes",
  COMISSOES_EXCECOES: "comissoes.tab.excecoes_cliente",
  COMISSOES_RELATORIOS: "comissoes.tab.relatorios",
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
    label: "Gestão por Vendedor",
    ownLabel: "Meu Dashboard",
  },
  {
    id: "portfolio",
    resourceKey: TabResourceKeys.CRM_CARTEIRA,
    label: "Carteira de Clientes",
  },
];

export type CommissionsLiveTabId = "monthlyClosing" | "customerExclusions" | "reports";

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
    id: "customerExclusions",
    resourceKey: TabResourceKeys.COMISSOES_EXCECOES,
    label: "Exceções por cliente",
  },
  {
    id: "reports",
    resourceKey: TabResourceKeys.COMISSOES_RELATORIOS,
    label: "Relatórios",
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
