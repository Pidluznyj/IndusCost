/**
 * Cliente de permissões para UI (browser-safe).
 * Segurança real fica no backend; aqui só experiência visual a partir de /api/auth/me.
 */

import {
  COMMISSIONS_LIVE_UI_TABS,
  CRM_UI_TABS,
  MATERIALS_UI_SECTIONS,
} from "@/src/lib/moduleTabResources.js";
import type { AuthUser } from "@/src/lib/appAuthClient.js";

export type PermissionAction = "view" | "execute" | "manage";

export type PermissionFlags = {
  canView: boolean;
  canExecute: boolean;
  canManage: boolean;
};

export type FrontendPermissionResource = {
  key: string;
  label: string;
  type: "MENU" | "SUBMENU" | "TAB" | "ACTION";
  parentKey: string | null;
  legacyAliasKeys: readonly string[];
};

/** Chaves canônicas — espelham o catálogo relacional (sem importar Prisma/server). */
export const ResourceKeys = {
  DASHBOARD: "dashboard",
  FINANCEIRO: "financeiro",
  FINANCEIRO_CONCILIACAO_CARTEIRA: "financeiro.conciliacao_carteira",
  FINANCEIRO_CONCILIACAO_TAB_CONCILIACAO:
    "financeiro.conciliacao_carteira.tab.conciliacao",
  FINANCEIRO_CONCILIACAO_TAB_INTELIGENCIA:
    "financeiro.conciliacao_carteira.tab.inteligencia",
  FINANCEIRO_CONCILIACAO_TAB_AUDITORIA_PEDIDO_CAIXA:
    "financeiro.conciliacao_carteira.tab.auditoria_pedido_caixa",
  FINANCEIRO_CONCILIACAO_TAB_STATUS_PEDIDOS:
    "financeiro.conciliacao_carteira.tab.status_pedidos",
  FINANCEIRO_CONTAS_PAGAR: "financeiro.contas_pagar",
  FINANCEIRO_CONTAS_RECEBER: "financeiro.contas_receber",
  COMERCIAL: "comercial",
  COMERCIAL_PEDIDOS_VENDA: "comercial.pedidos_venda",
  COMERCIAL_FLUXO_PEDIDOS: "comercial.fluxo_pedidos",
  COMERCIAL_DOCUMENTOS_SAIDA: "comercial.documentos_saida",
  COMERCIAL_CRM: "comercial.crm",
  COMERCIAL_CRM_TAB_GESTAO_GERAL: "comercial.crm.tab.gestao_geral",
  COMERCIAL_CRM_TAB_GESTAO_VENDEDOR: "comercial.crm.tab.gestao_vendedor",
  COMERCIAL_CRM_TAB_CARTEIRA_CLIENTES: "comercial.crm.tab.carteira_clientes",
  COMERCIAL_CRM_TAB_CLIENTE_360: "comercial.crm.tab.cliente_360",
  COMISSOES: "comissoes",
  COMISSOES_TAB_FECHAMENTO_MES: "comissoes.tab.fechamento_mes",
  COMISSOES_TAB_FECHAMENTOS: "comissoes.tab.fechamentos",
  COMISSOES_TAB_EXCECOES_CLIENTE: "comissoes.tab.excecoes_cliente",
  COMISSOES_TAB_PROVISAO_PEDIDO: "comissoes.tab.provisao_pedido",
  COMISSOES_TAB_RELATORIOS: "comissoes.tab.relatorios",
  COMISSOES_TAB_REPROCESSAR: "comissoes.tab.reprocessar",
  COMISSOES_TAB_DASHBOARD: "comissoes.tab.dashboard",
  COMISSOES_TAB_PREVISTAS: "comissoes.tab.previstas",
  COMISSOES_TAB_CONFIRMADAS: "comissoes.tab.confirmadas",
  COMISSOES_TAB_LIBERACAO: "comissoes.tab.liberacao",
  COMISSOES_TAB_PAGAMENTOS: "comissoes.tab.pagamentos",
  COMISSOES_TAB_PESSOAS: "comissoes.tab.pessoas",
  COMISSOES_TAB_REGRAS: "comissoes.tab.regras",
  COMISSOES_TAB_AUDITORIA: "comissoes.tab.auditoria",
  COMISSOES_TAB_CONFIGURACOES: "comissoes.tab.configuracoes",
  SUPRIMENTOS: "suprimentos",
  SUPRIMENTOS_TAB_CATALOGO: "suprimentos.tab.catalogo",
  SUPRIMENTOS_INTELIGENCIA_MERCADO: "suprimentos.inteligencia_mercado",
  SUPRIMENTOS_MI_TAB_HOME: "suprimentos.inteligencia_mercado.tab.home",
  SUPRIMENTOS_MI_TAB_MATERIA_PRIMA_360: "suprimentos.inteligencia_mercado.tab.materia_prima_360",
  SUPRIMENTOS_MI_TAB_FORNECEDORES: "suprimentos.inteligencia_mercado.tab.fornecedores",
  SUPRIMENTOS_MI_TAB_ALERTAS: "suprimentos.inteligencia_mercado.tab.alertas",
  SUPRIMENTOS_MI_TAB_CONFIGURACOES: "suprimentos.inteligencia_mercado.tab.configuracoes",
  ADMIN: "admin",
  ADMIN_USUARIOS: "admin.usuarios",
  ADMIN_PERMISSOES: "admin.permissoes",
  ADMIN_PERMISSOES_ACTION_MANAGE: "admin.permissoes.action.manage",
  CONFIGURACOES: "configuracoes",
  /** Canônico EN — custos indiretos (contrato finance.opex). */
  FINANCE_OPEX: "finance.opex",
  FINANCE_TAXES: "finance.taxes",
  FINANCE_REPORTS: "finance.reports",
  FINANCE_SUPPLIERS: "finance.suppliers",
  /** Central de Tesouraria (contrato finance.treasury). */
  FINANCE_TREASURY: "finance.treasury",
  /** Prompt 13 — canônicos (contrato) com aliases legados no FE. */
  COMERCIAL_CLIENTES: "commercial.customers",
  COMERCIAL_PROPOSTAS: "commercial.proposals",
  COMERCIAL_PROPOSTAS_INDICADORES: "commercial.proposals.indicators",
  COMERCIAL_TABELA_COMERCIAL: "commercial.price_table",
  COMERCIAL_FORMACAO_PRECO: "commercial.pricing",
  COMERCIAL_SATISFACAO: "commercial.satisfaction",
  COMERCIAL_SATISFACAO_RESPOSTAS: "commercial.satisfaction.responses",
  ENGENHARIA: "engineering",
  ENGENHARIA_PRODUTOS: "engineering.products",
  ENGENHARIA_PRODUTOS_TAB_INFO: "engineering.products.tab.info",
  ENGENHARIA_PRODUTOS_TAB_BOM: "engineering.products.tab.bom",
  ENGENHARIA_PRODUTOS_TAB_ROUTING: "engineering.products.tab.routing",
  ENGENHARIA_PRODUTOS_TAB_TREE: "engineering.products.tab.tree",
  ENGENHARIA_PRODUTOS_TAB_COST: "engineering.products.tab.cost",
  ENGENHARIA_PRODUTOS_TAB_COMPOSITION: "engineering.products.tab.composition",
  ENGENHARIA_SIMULADOR_INJECAO: "engineering.transformation_simulator",
  ENGENHARIA_SIMULACOES: "engineering.simulations",
  ENGENHARIA_PROJETOS: "engineering.projects",
  /** Prompt 15 — Operações / Administração (contrato canônico). */
  OPERACOES: "operations",
  OPERACOES_ESTOQUE: "operations.inventory",
  OPERACOES_ESTOQUE_ITENS: "operations.inventory.items",
  OPERACOES_ESTOQUE_ALMOXARIFADOS: "operations.inventory.warehouses",
  OPERACOES_ESTOQUE_MOVIMENTACOES: "operations.inventory.movements",
  OPERACOES_ESTOQUE_CONFERENCIAS: "operations.inventory.counts",
  OPERACOES_COMPRAS: "operations.purchases",
  OPERACOES_SC_COMPRAS: "operations.supply_chain.purchases",
  OPERACOES_SC_ESTOQUE: "operations.supply_chain.inventory",
  OPERACOES_SC_RECEBIMENTOS: "operations.supply_chain.receiving",
  OPERACOES_MAQUINAS: "operations.machines",
  OPERACOES_PERFORMANCE: "operations.performance",
  OPERACOES_ORDENS_PRODUCAO: "operations.production_orders",
  OPERACOES_MANUTENCAO: "operations.maintenance",
  OPERACOES_FROTA: "operations.fleet",
  ADMIN_PESSOAS: "admin.employees",
  ADMIN_PESSOAS_DASHBOARD: "admin.employees.dashboard",
  ADMIN_PESSOAS_PERSONAL_DATA: "admin.employees.personal_data",
  ADMIN_PESSOAS_ADMINISTRATIVE_DATA: "admin.employees.administrative_data",
  ADMIN_PESSOAS_SENSITIVE_DATA: "admin.employees.sensitive_data",
  ADMIN_PESSOAS_LINKS: "admin.employees.links",
  ADMIN_PESSOAS_USER_LINK: "admin.employees.user_link",
  ADMIN_PESSOAS_EPI: "admin.employees.epi",
  ADMIN_PESSOAS_CAREER: "admin.employees.career",
  ADMIN_PESSOAS_COMPENSATION_EVENTS: "admin.employees.compensation_events",
  ADMIN_PESSOAS_COMPENSATION_VALUES: "admin.employees.compensation_values",
  ADMIN_PESSOAS_BENEFITS: "admin.employees.benefits",
  ADMIN_PESSOAS_DOCUMENTS: "admin.employees.documents",
  ADMIN_PESSOAS_ABSENCES: "admin.employees.absences",
  ADMIN_PESSOAS_HISTORY: "admin.employees.history",
  ADMIN_PESSOAS_NOTES: "admin.employees.notes",
  ADMIN_PESSOAS_NOTES_RESTRICTED: "admin.employees.notes_restricted",
  ADMIN_PESSOAS_TEAM: "admin.employees.team",
  ADMIN_GUIA: "admin.guide",
  ADMIN_SETTINGS: "admin.settings",
  ADMIN_METAS: "admin.goals",
} as const;

export type PortfolioReconciliationUiTabId =
  | "conciliation"
  | "intelligence"
  | "order-to-cash-audit"
  | "order-status-pedidos";

export const PORTFOLIO_RECONCILIATION_UI_TABS: ReadonlyArray<{
  id: PortfolioReconciliationUiTabId;
  resourceKey: string;
  label: string;
}> = [
  {
    id: "conciliation",
    resourceKey: ResourceKeys.FINANCEIRO_CONCILIACAO_TAB_CONCILIACAO,
    label: "Conciliação",
  },
  {
    id: "intelligence",
    resourceKey: ResourceKeys.FINANCEIRO_CONCILIACAO_TAB_INTELIGENCIA,
    label: "Inteligência da Carteira",
  },
  {
    id: "order-status-pedidos",
    resourceKey: ResourceKeys.FINANCEIRO_CONCILIACAO_TAB_STATUS_PEDIDOS,
    label: "Status Pedidos",
  },
  {
    id: "order-to-cash-audit",
    resourceKey: ResourceKeys.FINANCEIRO_CONCILIACAO_TAB_AUDITORIA_PEDIDO_CAIXA,
    label: "Auditoria Pedido → Caixa",
  },
] as const;

/**
 * Whitelist de abas que devem aparecer NA NAVEGAÇÃO VISUAL do módulo
 * Financeiro > Conciliação de Carteira (2026-07 em diante).
 *
 * A tela foi simplificada para exibir apenas:
 *   1. Status Pedidos (visão consolidada por pedido)
 *   2. Auditoria Pedido → Caixa (visão detalhada item/evidência)
 *
 * As abas "Conciliação" e "Inteligência da Carteira" foram OCULTADAS da UI,
 * mas seguem em `PORTFOLIO_RECONCILIATION_UI_TABS` porque:
 *   - suas rotas de permissão (FINANCEIRO_CONCILIACAO_TAB_*) continuam
 *     ativas para seeds/audits/backwards-compat;
 *   - services/endpoints/models permanecem em uso interno por
 *     Auditoria 360º, cards de resumo, scripts de rebuild, etc.
 *
 * Ordem da tupla = ordem de exibição na barra de abas.
 */
export const PORTFOLIO_RECONCILIATION_VISIBLE_TAB_IDS = [
  "order-status-pedidos",
  "order-to-cash-audit",
] as const satisfies ReadonlyArray<PortfolioReconciliationUiTabId>;

export type PortfolioReconciliationVisibleTabId =
  (typeof PORTFOLIO_RECONCILIATION_VISIBLE_TAB_IDS)[number];

/**
 * `true` se o id de aba (vindo de estado antigo, query param, localStorage,
 * deep-link, etc.) ainda está visível na UI atual. Caso `false`, o consumidor
 * deve cair no fallback = primeira aba visível permitida (Status Pedidos).
 */
export function isPortfolioReconciliationVisibleTabId(
  id: string | null | undefined
): id is PortfolioReconciliationVisibleTabId {
  if (!id) return false;
  return (PORTFOLIO_RECONCILIATION_VISIBLE_TAB_IDS as readonly string[]).includes(id);
}

const ALL: PermissionFlags = { canView: true, canExecute: true, canManage: true };
const NONE: PermissionFlags = { canView: false, canExecute: false, canManage: false };

/** Catálogo mínimo usado pela UI (hierarquia + aliases legados). */
export const FRONTEND_PERMISSION_RESOURCES: readonly FrontendPermissionResource[] = [
  {
    key: ResourceKeys.DASHBOARD,
    label: "Dashboard",
    type: "MENU",
    parentKey: null,
    legacyAliasKeys: ["dashboard.view"],
  },
  {
    key: ResourceKeys.FINANCEIRO,
    label: "Financeiro",
    type: "MENU",
    parentKey: null,
    legacyAliasKeys: [
      "finance.view",
      "reports.view",
      "settings.nomus.view",
      "settings.view",
    ],
  },
  {
    key: ResourceKeys.FINANCEIRO_CONCILIACAO_CARTEIRA,
    label: "Conciliação de Carteira",
    type: "SUBMENU",
    parentKey: ResourceKeys.FINANCEIRO,
    legacyAliasKeys: [
      "finance.portfolioReconciliation.view",
      "finance.portfolioReconciliation.conciliation.view",
      "finance.portfolioReconciliation.intelligence.view",
      "finance.portfolioReconciliation.orderToCashAudit.view",
      "finance.portfolioReconciliation.orderStatusPedidos.view",
    ],
  },
  {
    key: ResourceKeys.FINANCEIRO_CONTAS_PAGAR,
    label: "Contas a Pagar",
    type: "SUBMENU",
    parentKey: ResourceKeys.FINANCEIRO,
    legacyAliasKeys: ["finance.accountsPayable.view"],
  },
  {
    key: ResourceKeys.FINANCEIRO_CONTAS_RECEBER,
    label: "Contas a Receber",
    type: "SUBMENU",
    parentKey: ResourceKeys.FINANCEIRO,
    legacyAliasKeys: ["finance.accountsReceivable.view"],
  },
  {
    key: ResourceKeys.FINANCEIRO_CONCILIACAO_TAB_CONCILIACAO,
    label: "Aba Conciliação",
    type: "TAB",
    parentKey: ResourceKeys.FINANCEIRO_CONCILIACAO_CARTEIRA,
    legacyAliasKeys: ["finance.portfolioReconciliation.conciliation.view"],
  },
  {
    key: ResourceKeys.FINANCEIRO_CONCILIACAO_TAB_INTELIGENCIA,
    label: "Aba Inteligência",
    type: "TAB",
    parentKey: ResourceKeys.FINANCEIRO_CONCILIACAO_CARTEIRA,
    legacyAliasKeys: ["finance.portfolioReconciliation.intelligence.view"],
  },
  {
    key: ResourceKeys.FINANCEIRO_CONCILIACAO_TAB_AUDITORIA_PEDIDO_CAIXA,
    label: "Aba Auditoria Pedido → Caixa",
    type: "TAB",
    parentKey: ResourceKeys.FINANCEIRO_CONCILIACAO_CARTEIRA,
    legacyAliasKeys: ["finance.portfolioReconciliation.orderToCashAudit.view"],
  },
  {
    key: ResourceKeys.FINANCEIRO_CONCILIACAO_TAB_STATUS_PEDIDOS,
    label: "Aba Status Pedidos",
    type: "TAB",
    parentKey: ResourceKeys.FINANCEIRO_CONCILIACAO_CARTEIRA,
    legacyAliasKeys: ["finance.portfolioReconciliation.orderStatusPedidos.view"],
  },
  {
    key: ResourceKeys.COMERCIAL,
    label: "Comercial",
    type: "MENU",
    parentKey: null,
    // Shell do grupo (1:1 com commercial.view) — não compartilhe sales_orders.view.
    legacyAliasKeys: ["commercial.view"],
  },
  {
    key: ResourceKeys.COMERCIAL_PEDIDOS_VENDA,
    label: "Pedidos de Venda",
    type: "SUBMENU",
    parentKey: ResourceKeys.COMERCIAL,
    legacyAliasKeys: ["sales_orders.view"],
  },
  {
    key: ResourceKeys.COMERCIAL_FLUXO_PEDIDOS,
    label: "Fluxo de Pedidos",
    type: "SUBMENU",
    parentKey: ResourceKeys.COMERCIAL,
    legacyAliasKeys: ["sales_orders.flow.view"],
  },
  {
    key: ResourceKeys.COMERCIAL_CRM,
    label: "CRM",
    type: "SUBMENU",
    parentKey: ResourceKeys.COMERCIAL,
    legacyAliasKeys: ["crm.view"],
  },
  {
    key: ResourceKeys.COMERCIAL_CRM_TAB_GESTAO_GERAL,
    label: "Gestão Geral",
    type: "TAB",
    parentKey: ResourceKeys.COMERCIAL_CRM,
    legacyAliasKeys: ["crm.general.view"],
  },
  {
    key: ResourceKeys.COMERCIAL_CRM_TAB_GESTAO_VENDEDOR,
    label: "Gestão por Responsável",
    type: "TAB",
    parentKey: ResourceKeys.COMERCIAL_CRM,
    legacyAliasKeys: ["crm.seller.view"],
  },
  {
    key: ResourceKeys.COMERCIAL_CRM_TAB_CARTEIRA_CLIENTES,
    label: "Carteira de Clientes",
    type: "TAB",
    parentKey: ResourceKeys.COMERCIAL_CRM,
    legacyAliasKeys: ["crm.customer_cockpit.view"],
  },
  {
    key: ResourceKeys.COMERCIAL_CRM_TAB_CLIENTE_360,
    label: "Cliente 360",
    type: "TAB",
    parentKey: ResourceKeys.COMERCIAL_CRM,
    legacyAliasKeys: [
      "customers.commercial360.view",
      "customers.view",
    ],
  },
  {
    key: ResourceKeys.COMERCIAL_SATISFACAO,
    label: "Satisfação",
    type: "SUBMENU",
    parentKey: ResourceKeys.COMERCIAL,
    legacyAliasKeys: ["commercial.satisfaction.view"],
  },
  {
    key: ResourceKeys.COMERCIAL_SATISFACAO_RESPOSTAS,
    label: "Satisfação — respostas",
    type: "TAB",
    parentKey: ResourceKeys.COMERCIAL_SATISFACAO,
    legacyAliasKeys: ["commercial.satisfaction.responses.view"],
  },
  {
    key: ResourceKeys.COMISSOES,
    label: "Comissões",
    type: "SUBMENU",
    parentKey: ResourceKeys.COMERCIAL,
    legacyAliasKeys: ["commissions.view"],
  },
  {
    key: ResourceKeys.COMISSOES_TAB_FECHAMENTO_MES,
    label: "Fechamento do mês",
    type: "TAB",
    parentKey: ResourceKeys.COMISSOES,
    legacyAliasKeys: [
      "commissions.payments.view",
      "commissions.dashboard.view",
      "commissions.release.view",
      "commissions.view",
    ],
  },
  {
    key: ResourceKeys.COMISSOES_TAB_FECHAMENTOS,
    label: "Fechamentos",
    type: "TAB",
    parentKey: ResourceKeys.COMISSOES,
    legacyAliasKeys: [
      "commissions.dashboard.view",
      "commissions.payments.view",
      "commissions.audit.view",
      "commissions.view",
    ],
  },
  {
    key: ResourceKeys.COMISSOES_TAB_EXCECOES_CLIENTE,
    label: "Exceções por cliente",
    type: "TAB",
    parentKey: ResourceKeys.COMISSOES,
    legacyAliasKeys: ["commissions.rules.view", "commissions.view"],
  },
  {
    key: ResourceKeys.COMISSOES_TAB_PROVISAO_PEDIDO,
    label: "Provisão por pedido",
    type: "TAB",
    parentKey: ResourceKeys.COMISSOES,
    legacyAliasKeys: ["commissions.dashboard.view", "commissions.view"],
  },
  {
    key: ResourceKeys.COMISSOES_TAB_RELATORIOS,
    label: "Relatórios",
    type: "TAB",
    parentKey: ResourceKeys.COMISSOES,
    legacyAliasKeys: ["commissions.dashboard.view", "commissions.audit.view", "commissions.view"],
  },
  {
    key: ResourceKeys.COMISSOES_TAB_REPROCESSAR,
    label: "Reprocessar",
    type: "TAB",
    parentKey: ResourceKeys.COMISSOES,
    legacyAliasKeys: [
      "commissions.rules.view",
      "commissions.payments.manage",
      "commissions.rules.manage",
      "commissions.audit.view",
      "commissions.view",
    ],
  },
  {
    key: ResourceKeys.COMISSOES_TAB_DASHBOARD,
    label: "Dashboard",
    type: "TAB",
    parentKey: ResourceKeys.COMISSOES,
    legacyAliasKeys: ["commissions.dashboard.view", "commissions.view"],
  },
  {
    key: ResourceKeys.COMISSOES_TAB_PREVISTAS,
    label: "Previstas",
    type: "TAB",
    parentKey: ResourceKeys.COMISSOES,
    legacyAliasKeys: ["commissions.forecast.view", "commissions.view"],
  },
  {
    key: ResourceKeys.COMISSOES_TAB_CONFIRMADAS,
    label: "Confirmadas",
    type: "TAB",
    parentKey: ResourceKeys.COMISSOES,
    legacyAliasKeys: ["commissions.confirmed.view", "commissions.view"],
  },
  {
    key: ResourceKeys.COMISSOES_TAB_LIBERACAO,
    label: "Liberação por Recebimento",
    type: "TAB",
    parentKey: ResourceKeys.COMISSOES,
    legacyAliasKeys: ["commissions.release.view", "commissions.view"],
  },
  {
    key: ResourceKeys.COMISSOES_TAB_PAGAMENTOS,
    label: "Pagamentos",
    type: "TAB",
    parentKey: ResourceKeys.COMISSOES,
    legacyAliasKeys: ["commissions.payments.view", "commissions.view"],
  },
  {
    key: ResourceKeys.COMISSOES_TAB_PESSOAS,
    label: "Pessoas Comissionadas",
    type: "TAB",
    parentKey: ResourceKeys.COMISSOES,
    legacyAliasKeys: ["commissions.people.view", "commissions.view"],
  },
  {
    key: ResourceKeys.COMISSOES_TAB_REGRAS,
    label: "Regras",
    type: "TAB",
    parentKey: ResourceKeys.COMISSOES,
    legacyAliasKeys: ["commissions.rules.view", "commissions.view"],
  },
  {
    key: ResourceKeys.COMISSOES_TAB_AUDITORIA,
    label: "Auditoria",
    type: "TAB",
    parentKey: ResourceKeys.COMISSOES,
    legacyAliasKeys: ["commissions.audit.view", "commissions.view"],
  },
  {
    key: ResourceKeys.COMISSOES_TAB_CONFIGURACOES,
    label: "Configurações",
    type: "TAB",
    parentKey: ResourceKeys.COMISSOES,
    legacyAliasKeys: ["commissions.settings.view", "commissions.view"],
  },
  {
    key: ResourceKeys.SUPRIMENTOS,
    label: "Suprimentos",
    type: "MENU",
    parentKey: null,
    legacyAliasKeys: ["materials.view"],
  },
  {
    key: ResourceKeys.SUPRIMENTOS_TAB_CATALOGO,
    label: "Matérias-primas",
    type: "TAB",
    parentKey: ResourceKeys.SUPRIMENTOS,
    legacyAliasKeys: ["materials.view"],
  },
  {
    key: ResourceKeys.SUPRIMENTOS_INTELIGENCIA_MERCADO,
    label: "Inteligência de Mercado",
    type: "SUBMENU",
    parentKey: ResourceKeys.SUPRIMENTOS,
    legacyAliasKeys: [
      "materials.view",
      "materials.market_quote.approve",
      "materials.market_quote.manual_exchange",
    ],
  },
  {
    key: ResourceKeys.SUPRIMENTOS_MI_TAB_HOME,
    label: "Home Inteligência",
    type: "TAB",
    parentKey: ResourceKeys.SUPRIMENTOS_INTELIGENCIA_MERCADO,
    legacyAliasKeys: ["materials.view"],
  },
  {
    key: ResourceKeys.SUPRIMENTOS_MI_TAB_MATERIA_PRIMA_360,
    label: "Matéria-prima 360",
    type: "TAB",
    parentKey: ResourceKeys.SUPRIMENTOS_INTELIGENCIA_MERCADO,
    legacyAliasKeys: ["materials.view"],
  },
  {
    key: ResourceKeys.SUPRIMENTOS_MI_TAB_FORNECEDORES,
    label: "Fornecedores / cotações",
    type: "TAB",
    parentKey: ResourceKeys.SUPRIMENTOS_INTELIGENCIA_MERCADO,
    legacyAliasKeys: ["materials.view"],
  },
  {
    key: ResourceKeys.SUPRIMENTOS_MI_TAB_ALERTAS,
    label: "Alertas",
    type: "TAB",
    parentKey: ResourceKeys.SUPRIMENTOS_INTELIGENCIA_MERCADO,
    legacyAliasKeys: ["materials.view"],
  },
  {
    key: ResourceKeys.SUPRIMENTOS_MI_TAB_CONFIGURACOES,
    label: "Configurações",
    type: "TAB",
    parentKey: ResourceKeys.SUPRIMENTOS_INTELIGENCIA_MERCADO,
    legacyAliasKeys: [
      "materials.edit",
      "materials.view",
      "materials.market_quote.approve",
      "materials.market_quote.manual_exchange",
    ],
  },
  {
    key: ResourceKeys.ADMIN,
    label: "Administração",
    type: "MENU",
    parentKey: null,
    legacyAliasKeys: ["users.manage", "accessProfiles.view"],
  },
  {
    key: ResourceKeys.ADMIN_USUARIOS,
    label: "Usuários",
    type: "SUBMENU",
    parentKey: ResourceKeys.ADMIN,
    legacyAliasKeys: ["users.manage"],
  },
  {
    key: ResourceKeys.ADMIN_PERMISSOES,
    label: "Permissões",
    type: "SUBMENU",
    parentKey: ResourceKeys.ADMIN,
    legacyAliasKeys: ["accessProfiles.view"],
  },
  {
    key: ResourceKeys.ADMIN_PERMISSOES_ACTION_MANAGE,
    label: "Gerir permissões",
    type: "ACTION",
    parentKey: ResourceKeys.ADMIN_PERMISSOES,
    legacyAliasKeys: ["accessProfiles.manage"],
  },
  {
    key: ResourceKeys.CONFIGURACOES,
    label: "Configurações (legado)",
    type: "MENU",
    parentKey: null,
    legacyAliasKeys: ["settings.view", "users.manage"],
  },
  {
    key: ResourceKeys.FINANCE_OPEX,
    label: "Custos Indiretos",
    type: "SUBMENU",
    parentKey: ResourceKeys.FINANCEIRO,
    legacyAliasKeys: ["opex.view", "costs.view", "opex.edit"],
  },
  {
    key: ResourceKeys.FINANCE_TAXES,
    label: "Tributos",
    type: "SUBMENU",
    parentKey: ResourceKeys.FINANCEIRO,
    legacyAliasKeys: ["taxes.view", "taxes.edit"],
  },
  {
    key: ResourceKeys.FINANCE_REPORTS,
    label: "Relatórios",
    type: "SUBMENU",
    parentKey: ResourceKeys.FINANCEIRO,
    legacyAliasKeys: ["reports.view"],
  },
  {
    key: ResourceKeys.FINANCE_SUPPLIERS,
    label: "Fornecedores",
    type: "SUBMENU",
    parentKey: ResourceKeys.FINANCEIRO,
    legacyAliasKeys: ["finance.suppliers.view", "finance.view", "finance.suppliers.manage"],
  },
  {
    key: ResourceKeys.FINANCE_TREASURY,
    label: "Central de Tesouraria",
    type: "SUBMENU",
    parentKey: ResourceKeys.FINANCEIRO,
    legacyAliasKeys: ["finance.treasury.view"],
  },
  {
    key: ResourceKeys.COMERCIAL_CLIENTES,
    label: "Clientes",
    type: "SUBMENU",
    parentKey: ResourceKeys.COMERCIAL,
    legacyAliasKeys: ["customers.view"],
  },
  {
    key: ResourceKeys.COMERCIAL_PROPOSTAS,
    label: "Propostas",
    type: "SUBMENU",
    parentKey: ResourceKeys.COMERCIAL,
    legacyAliasKeys: ["proposals.view"],
  },
  {
    key: ResourceKeys.COMERCIAL_PROPOSTAS_INDICADORES,
    label: "Propostas — Indicadores",
    type: "TAB",
    parentKey: ResourceKeys.COMERCIAL_PROPOSTAS,
    legacyAliasKeys: ["proposals.indicators.view"],
  },
  {
    key: ResourceKeys.COMERCIAL_TABELA_COMERCIAL,
    label: "Tabela comercial",
    type: "SUBMENU",
    parentKey: ResourceKeys.COMERCIAL,
    legacyAliasKeys: ["price_table.view"],
  },
  {
    key: ResourceKeys.COMERCIAL_FORMACAO_PRECO,
    label: "Formação de Preço",
    type: "SUBMENU",
    parentKey: ResourceKeys.COMERCIAL,
    legacyAliasKeys: ["pricing.view"],
  },
  {
    key: ResourceKeys.ENGENHARIA,
    label: "Engenharia",
    type: "MENU",
    parentKey: null,
    legacyAliasKeys: ["products.view", "materials.view", "simulations.view", "projects.view"],
  },
  {
    key: ResourceKeys.ENGENHARIA_PRODUTOS,
    label: "Produtos",
    type: "SUBMENU",
    parentKey: ResourceKeys.ENGENHARIA,
    legacyAliasKeys: ["products.view"],
  },
  {
    key: ResourceKeys.ENGENHARIA_PRODUTOS_TAB_INFO,
    label: "Produto — Info",
    type: "TAB",
    parentKey: ResourceKeys.ENGENHARIA_PRODUTOS,
    legacyAliasKeys: ["products.tab.info"],
  },
  {
    key: ResourceKeys.ENGENHARIA_PRODUTOS_TAB_BOM,
    label: "Produto — BOM",
    type: "TAB",
    parentKey: ResourceKeys.ENGENHARIA_PRODUTOS,
    legacyAliasKeys: ["products.tab.bom"],
  },
  {
    key: ResourceKeys.ENGENHARIA_PRODUTOS_TAB_ROUTING,
    label: "Produto — Roteiro",
    type: "TAB",
    parentKey: ResourceKeys.ENGENHARIA_PRODUTOS,
    legacyAliasKeys: ["products.tab.routing"],
  },
  {
    key: ResourceKeys.ENGENHARIA_PRODUTOS_TAB_TREE,
    label: "Produto — Árvore",
    type: "TAB",
    parentKey: ResourceKeys.ENGENHARIA_PRODUTOS,
    legacyAliasKeys: ["products.tab.tree"],
  },
  {
    key: ResourceKeys.ENGENHARIA_PRODUTOS_TAB_COST,
    label: "Produto — Custo",
    type: "TAB",
    parentKey: ResourceKeys.ENGENHARIA_PRODUTOS,
    legacyAliasKeys: ["products.tab.cost"],
  },
  {
    key: ResourceKeys.ENGENHARIA_PRODUTOS_TAB_COMPOSITION,
    label: "Produto — Composição",
    type: "TAB",
    parentKey: ResourceKeys.ENGENHARIA_PRODUTOS,
    legacyAliasKeys: ["products.tab.composition"],
  },
  {
    key: ResourceKeys.ENGENHARIA_SIMULADOR_INJECAO,
    label: "Simulador de Custo de Injeção",
    type: "SUBMENU",
    parentKey: ResourceKeys.ENGENHARIA,
    legacyAliasKeys: ["products.view", "simulations.view"],
  },
  {
    key: ResourceKeys.ENGENHARIA_SIMULACOES,
    label: "Simulações",
    type: "SUBMENU",
    parentKey: ResourceKeys.ENGENHARIA,
    legacyAliasKeys: ["simulations.view"],
  },
  {
    key: ResourceKeys.ENGENHARIA_PROJETOS,
    label: "Projetos",
    type: "SUBMENU",
    parentKey: ResourceKeys.ENGENHARIA,
    legacyAliasKeys: ["projects.view"],
  },
  {
    key: ResourceKeys.OPERACOES,
    label: "Operações",
    type: "MENU",
    parentKey: null,
    legacyAliasKeys: [
      "inventory.view",
      "purchases.view",
      "machines.view",
      "maintenance.view",
      "fleet.view",
    ],
  },
  {
    key: ResourceKeys.OPERACOES_ESTOQUE,
    label: "Estoque / Almoxarifado",
    type: "SUBMENU",
    parentKey: ResourceKeys.OPERACOES,
    legacyAliasKeys: ["inventory.view"],
  },
  {
    key: ResourceKeys.OPERACOES_ESTOQUE_ITENS,
    label: "Estoque — Itens",
    type: "TAB",
    parentKey: ResourceKeys.OPERACOES_ESTOQUE,
    legacyAliasKeys: ["inventory.view", "inventory.item.manage"],
  },
  {
    key: ResourceKeys.OPERACOES_ESTOQUE_ALMOXARIFADOS,
    label: "Estoque — Almoxarifados",
    type: "TAB",
    parentKey: ResourceKeys.OPERACOES_ESTOQUE,
    legacyAliasKeys: ["inventory.view", "inventory.warehouse.manage"],
  },
  {
    key: ResourceKeys.OPERACOES_ESTOQUE_MOVIMENTACOES,
    label: "Estoque — Movimentações",
    type: "TAB",
    parentKey: ResourceKeys.OPERACOES_ESTOQUE,
    legacyAliasKeys: ["inventory.view", "inventory.movement.create"],
  },
  {
    key: ResourceKeys.OPERACOES_ESTOQUE_CONFERENCIAS,
    label: "Estoque — Conferência",
    type: "TAB",
    parentKey: ResourceKeys.OPERACOES_ESTOQUE,
    legacyAliasKeys: ["inventory.view", "inventory.count.manage"],
  },
  {
    key: ResourceKeys.OPERACOES_COMPRAS,
    label: "Compras",
    type: "SUBMENU",
    parentKey: ResourceKeys.OPERACOES,
    legacyAliasKeys: ["purchases.view"],
  },
  {
    key: ResourceKeys.OPERACOES_SC_COMPRAS,
    label: "Compras SC",
    type: "SUBMENU",
    parentKey: ResourceKeys.OPERACOES,
    legacyAliasKeys: ["operations.supply_chain.purchases.view"],
  },
  {
    key: ResourceKeys.OPERACOES_SC_ESTOQUE,
    label: "Estoque SC",
    type: "SUBMENU",
    parentKey: ResourceKeys.OPERACOES,
    legacyAliasKeys: ["operations.supply_chain.inventory.view"],
  },
  {
    key: ResourceKeys.OPERACOES_SC_RECEBIMENTOS,
    label: "Recebimentos",
    type: "SUBMENU",
    parentKey: ResourceKeys.OPERACOES,
    legacyAliasKeys: ["operations.supply_chain.receiving.view"],
  },
  {
    key: ResourceKeys.OPERACOES_MAQUINAS,
    label: "Máquinas",
    type: "SUBMENU",
    parentKey: ResourceKeys.OPERACOES,
    legacyAliasKeys: ["machines.view"],
  },
  {
    key: ResourceKeys.OPERACOES_PERFORMANCE,
    label: "Performance",
    type: "SUBMENU",
    parentKey: ResourceKeys.OPERACOES,
    legacyAliasKeys: [
      "operations.component-performance.view",
      "operations.component-performance.edit",
      "products.view",
    ],
  },
  {
    key: ResourceKeys.OPERACOES_ORDENS_PRODUCAO,
    label: "Ordens de Produção",
    type: "SUBMENU",
    parentKey: ResourceKeys.OPERACOES,
    legacyAliasKeys: ["operations.production-orders.view"],
  },
  {
    key: ResourceKeys.OPERACOES_MANUTENCAO,
    label: "Manutenção Predial",
    type: "SUBMENU",
    parentKey: ResourceKeys.OPERACOES,
    legacyAliasKeys: ["maintenance.view"],
  },
  {
    key: ResourceKeys.OPERACOES_FROTA,
    label: "Gestão de Frota",
    type: "SUBMENU",
    parentKey: ResourceKeys.OPERACOES,
    legacyAliasKeys: ["fleet.view", "fleet.manage"],
  },
  {
    key: ResourceKeys.ADMIN_PESSOAS,
    label: "Pessoas / RH",
    type: "SUBMENU",
    parentKey: ResourceKeys.ADMIN,
    legacyAliasKeys: [
      "employees.view",
      "employees.edit",
      "employees.profile.view",
      "employees.team.view",
      "employees.team.descendants.view",
    ],
  },
  {
    key: ResourceKeys.ADMIN_PESSOAS_DASHBOARD,
    label: "RH — Dashboard",
    type: "SUBMENU",
    parentKey: ResourceKeys.ADMIN_PESSOAS,
    legacyAliasKeys: ["employees.dashboard.view", "employees.edit"],
  },
  {
    key: ResourceKeys.ADMIN_PESSOAS_PERSONAL_DATA,
    label: "RH — Dados pessoais",
    type: "TAB",
    parentKey: ResourceKeys.ADMIN_PESSOAS,
    legacyAliasKeys: [
      "employees.personal_data.view",
      "people.pii.view",
      "employees.edit",
    ],
  },
  {
    key: ResourceKeys.ADMIN_PESSOAS_ADMINISTRATIVE_DATA,
    label: "RH — Dados administrativos",
    type: "TAB",
    parentKey: ResourceKeys.ADMIN_PESSOAS,
    legacyAliasKeys: ["employees.administrative_data.view", "employees.edit"],
  },
  {
    key: ResourceKeys.ADMIN_PESSOAS_SENSITIVE_DATA,
    label: "RH — Dados sensíveis",
    type: "TAB",
    parentKey: ResourceKeys.ADMIN_PESSOAS,
    legacyAliasKeys: [
      "employees.sensitive_data.view",
      "employees.edit",
      "employees.compensation.values.view",
    ],
  },
  {
    key: ResourceKeys.ADMIN_PESSOAS_LINKS,
    label: "RH — Vínculos",
    type: "TAB",
    parentKey: ResourceKeys.ADMIN_PESSOAS,
    legacyAliasKeys: [
      "employees.links.view",
      "employees.view",
      "employees.edit",
      "people.search",
      "employees.links.manage",
      "people.link.manage",
    ],
  },
  {
    key: ResourceKeys.ADMIN_PESSOAS_USER_LINK,
    label: "RH — Vínculo com usuário",
    type: "ACTION",
    parentKey: ResourceKeys.ADMIN_PESSOAS,
    legacyAliasKeys: [
      "employees.user_link.manage",
      "employees.edit",
      "users.manage",
    ],
  },
  {
    key: ResourceKeys.ADMIN_PESSOAS_EPI,
    label: "RH — EPI",
    type: "TAB",
    parentKey: ResourceKeys.ADMIN_PESSOAS,
    legacyAliasKeys: ["employees.epi.manage", "employees.edit", "employees.epi.view"],
  },
  {
    key: ResourceKeys.ADMIN_PESSOAS_CAREER,
    label: "RH — Carreira",
    type: "TAB",
    parentKey: ResourceKeys.ADMIN_PESSOAS,
    legacyAliasKeys: ["employees.career.view", "employees.view", "employees.edit"],
  },
  {
    key: ResourceKeys.ADMIN_PESSOAS_COMPENSATION_EVENTS,
    label: "RH — Eventos de remuneração",
    type: "TAB",
    parentKey: ResourceKeys.ADMIN_PESSOAS,
    legacyAliasKeys: [
      "employees.compensation.events.view",
      "employees.view",
      "employees.edit",
      "employees.sensitive_data.view",
    ],
  },
  {
    key: ResourceKeys.ADMIN_PESSOAS_COMPENSATION_VALUES,
    label: "RH — Valores de remuneração",
    type: "TAB",
    parentKey: ResourceKeys.ADMIN_PESSOAS,
    legacyAliasKeys: [
      "employees.compensation.values.view",
      "employees.sensitive_data.view",
      "employees.edit",
    ],
  },
  {
    key: ResourceKeys.ADMIN_PESSOAS_BENEFITS,
    label: "RH — Benefícios",
    type: "TAB",
    parentKey: ResourceKeys.ADMIN_PESSOAS,
    legacyAliasKeys: ["employees.benefits.view", "employees.view", "employees.edit"],
  },
  {
    key: ResourceKeys.ADMIN_PESSOAS_DOCUMENTS,
    label: "RH — Documentos",
    type: "TAB",
    parentKey: ResourceKeys.ADMIN_PESSOAS,
    legacyAliasKeys: ["employees.documents.view", "employees.view", "employees.edit"],
  },
  {
    key: ResourceKeys.ADMIN_PESSOAS_ABSENCES,
    label: "RH — Férias e afastamentos",
    type: "TAB",
    parentKey: ResourceKeys.ADMIN_PESSOAS,
    legacyAliasKeys: ["employees.absences.view", "employees.view", "employees.edit"],
  },
  {
    key: ResourceKeys.ADMIN_PESSOAS_HISTORY,
    label: "RH — Histórico funcional",
    type: "TAB",
    parentKey: ResourceKeys.ADMIN_PESSOAS,
    legacyAliasKeys: ["employees.history.view", "employees.view", "employees.edit"],
  },
  {
    key: ResourceKeys.ADMIN_PESSOAS_NOTES,
    label: "RH — Observações",
    type: "TAB",
    parentKey: ResourceKeys.ADMIN_PESSOAS,
    legacyAliasKeys: ["employees.notes.view", "employees.view", "employees.edit"],
  },
  {
    key: ResourceKeys.ADMIN_PESSOAS_NOTES_RESTRICTED,
    label: "RH — Observações restritas",
    type: "TAB",
    parentKey: ResourceKeys.ADMIN_PESSOAS,
    legacyAliasKeys: [
      "employees.notes.restricted.view",
      "employees.administrative_data.view",
      "employees.edit",
    ],
  },
  {
    key: ResourceKeys.ADMIN_PESSOAS_TEAM,
    label: "RH — Escopo de equipe",
    type: "ACTION",
    parentKey: ResourceKeys.ADMIN_PESSOAS,
    legacyAliasKeys: ["employees.team.view", "employees.team.descendants.view"],
  },
  {
    key: ResourceKeys.ADMIN_GUIA,
    label: "Guia do Sistema",
    type: "SUBMENU",
    parentKey: ResourceKeys.ADMIN,
    legacyAliasKeys: ["guide.view"],
  },
  {
    key: ResourceKeys.ADMIN_SETTINGS,
    label: "Configurações (contrato)",
    type: "SUBMENU",
    parentKey: ResourceKeys.ADMIN,
    legacyAliasKeys: ["settings.view", "users.manage"],
  },
] as const;

const byKey = new Map(FRONTEND_PERMISSION_RESOURCES.map((r) => [r.key, r]));

function isManageAlias(key: string): boolean {
  return (
    key === "users.manage" ||
    key === "accessProfiles.manage" ||
    /\.(manage|admin)$/.test(key)
  );
}

function isExecuteAlias(key: string): boolean {
  return /\.(execute|export|sync|create|apply)$/.test(key);
}

function mergeFlags(base: PermissionFlags, overlay: Partial<PermissionFlags>): PermissionFlags {
  return {
    canView: overlay.canView ?? base.canView,
    canExecute: overlay.canExecute ?? base.canExecute,
    canManage: overlay.canManage ?? base.canManage,
  };
}

/**
 * Flags brutas por recurso (P07).
 *
 * Fonte de verdade da UI = `effectivePermissions` / `permissions` (bag).
 * Bag vazia ⇒ NONE (sem overlay de papel). SUPER_ADMIN ⇒ ALL.
 * Recurso desconhecido ⇒ NONE (canAccessResourceClient nega).
 * Não há "sem chave = permitido".
 */
function resolveRawFlags(user: AuthUser, resourceKey: string): PermissionFlags {
  if (user.role === "SUPER_ADMIN") return { ...ALL };

  const effective = user.effectivePermissions ?? user.permissions ?? [];
  let flags: PermissionFlags = { ...NONE };

  const resource = byKey.get(resourceKey);
  if (!resource) return flags;

  const hits = resource.legacyAliasKeys.filter((k) => effective.includes(k));
  if (hits.length === 0) return flags;

  flags = mergeFlags(flags, {
    canView: true,
    canExecute: hits.some(isExecuteAlias) ? true : undefined,
    canManage: hits.some(isManageAlias) ? true : undefined,
  });
  return flags;
}

function ancestorKeys(resourceKey: string): string[] {
  const out: string[] = [];
  let parent = byKey.get(resourceKey)?.parentKey ?? null;
  const seen = new Set<string>();
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    out.push(parent);
    parent = byKey.get(parent)?.parentKey ?? null;
  }
  return out;
}

/**
 * Concede view aos ancestrais quando um filho foi liberado por alias legado
 * (senão a hierarquia bloquearia a aba).
 */
function resolveFlagsWithLegacyAncestors(
  user: AuthUser,
  resourceKey: string
): PermissionFlags {
  if (user.role === "SUPER_ADMIN") return { ...ALL };

  const flags = resolveRawFlags(user, resourceKey);
  const effective = user.effectivePermissions ?? user.permissions ?? [];
  const resource = byKey.get(resourceKey);
  if (!resource) return flags;

  const selfHit = resource.legacyAliasKeys.some((k) => effective.includes(k));
  if (!selfHit) return flags;

  // Ancestrais precisam de view para a hierarquia passar.
  return flags;
}

export function canAccessResourceClient(
  user: AuthUser | null | undefined,
  resourceKey: string,
  action: PermissionAction = "view",
  options?: { elevateFromDescendants?: boolean }
): boolean {
  if (!user || user.isActive === false) return false;
  if (user.role === "SUPER_ADMIN") return true;

  if (!byKey.has(resourceKey)) return false;

  const effective = user.effectivePermissions ?? user.permissions ?? [];
  const elevateFromDescendants = options?.elevateFromDescendants !== false;

  const grantedByAlias = (key: string): boolean => {
    const res = byKey.get(key);
    if (!res) return false;
    return res.legacyAliasKeys.some((a) => effective.includes(a));
  };

  const hasViewOnKey = (key: string, allowDescendantElevation: boolean): boolean => {
    if (resolveRawFlags(user, key).canView) return true;
    if (grantedByAlias(key)) return true;
    if (!allowDescendantElevation) return false;
    return FRONTEND_PERMISSION_RESOURCES.some(
      (res) =>
        grantedByAlias(res.key) && ancestorKeys(res.key).includes(key)
    );
  };

  // Hierarquia: ancestrais precisam de view (com elevação a partir do alvo).
  for (const ancestor of ancestorKeys(resourceKey)) {
    if (!hasViewOnKey(ancestor, true)) return false;
  }

  const viewOk = hasViewOnKey(resourceKey, elevateFromDescendants);
  if (action === "view") return viewOk;
  if (!viewOk) return false;
  const flags = resolveFlagsWithLegacyAncestors(user, resourceKey);
  if (action === "execute") return flags.canExecute;
  return flags.canManage;
}

/** Viewer de sidebar: MENU não herda visibilidade só de filhos; SUBMENU/TAB sim. */
export function createSidebarCanViewResource(
  user: AuthUser | null | undefined
): (resourceKey: string) => boolean {
  return (resourceKey: string) => {
    const meta = byKey.get(resourceKey);
    const elevateFromDescendants = meta?.type !== "MENU";
    return canAccessResourceClient(user, resourceKey, "view", {
      elevateFromDescendants,
    });
  };
}

export type PermissionsApi = {
  canView: (resourceKey: string) => boolean;
  canExecute: (resourceKey: string) => boolean;
  canManage: (resourceKey: string) => boolean;
  getAllowedTabs: (parentResourceKey: string) => FrontendPermissionResource[];
  listAllowedPortfolioReconciliationTabs: () => PortfolioReconciliationUiTabId[];
  /**
   * Retorna somente as abas da Conciliação de Carteira que ainda são
   * mostradas na UI (Status Pedidos + Auditoria Pedido → Caixa) filtradas
   * por permissão do usuário. Preserva a ordem de `PORTFOLIO_RECONCILIATION_VISIBLE_TAB_IDS`.
   */
  listVisiblePortfolioReconciliationTabs: () => PortfolioReconciliationVisibleTabId[];
  listAllowedCrmTabs: () => Array<"general" | "seller" | "portfolio">;
  listAllowedCommissionsLiveTabs: () => Array<
    | "monthlyClosing"
    | "closings"
    | "customerExclusions"
    | "orderProvision"
    | "reports"
    | "reprocess"
  >;
  listAllowedMaterialsSections: () => Array<"catalog" | "marketIntelligence">;
  canViewPortfolioModule: () => boolean;
};

export function createPermissionsApi(user: AuthUser | null | undefined): PermissionsApi {
  const canView = (resourceKey: string) =>
    canAccessResourceClient(user, resourceKey, "view");
  const canExecute = (resourceKey: string) =>
    canAccessResourceClient(user, resourceKey, "execute");
  const canManage = (resourceKey: string) =>
    canAccessResourceClient(user, resourceKey, "manage");

  return {
    canView,
    canExecute,
    canManage,
    getAllowedTabs(parentResourceKey: string) {
      if (!canView(parentResourceKey)) return [];
      return FRONTEND_PERMISSION_RESOURCES.filter(
        (r) => r.parentKey === parentResourceKey && r.type === "TAB" && canView(r.key)
      );
    },
    listAllowedPortfolioReconciliationTabs() {
      return PORTFOLIO_RECONCILIATION_UI_TABS.filter((t) => canView(t.resourceKey)).map(
        (t) => t.id
      );
    },
    listVisiblePortfolioReconciliationTabs() {
      // Intersecção: (whitelist visível) ∩ (permissões efetivas). Preserva a
      // ordem canônica de PORTFOLIO_RECONCILIATION_VISIBLE_TAB_IDS.
      return PORTFOLIO_RECONCILIATION_VISIBLE_TAB_IDS.filter((id) => {
        const tab = PORTFOLIO_RECONCILIATION_UI_TABS.find((t) => t.id === id);
        return tab ? canView(tab.resourceKey) : false;
      });
    },
    listAllowedCrmTabs() {
      return CRM_UI_TABS.filter((t) => canView(t.resourceKey)).map((t) => t.id);
    },
    listAllowedCommissionsLiveTabs() {
      return COMMISSIONS_LIVE_UI_TABS.filter((t) => canView(t.resourceKey)).map((t) => t.id);
    },
    listAllowedMaterialsSections() {
      return MATERIALS_UI_SECTIONS.filter((t) => canView(t.resourceKey)).map((t) => t.id);
    },
    canViewPortfolioModule() {
      return (
        canView(ResourceKeys.FINANCEIRO_CONCILIACAO_CARTEIRA) ||
        PORTFOLIO_RECONCILIATION_UI_TABS.some((t) => canView(t.resourceKey))
      );
    },
  };
}

export const PERMISSION_DENIED_TAB_MESSAGE =
  "Você não tem permissão para acessar esta aba.";

export const PERMISSION_EMPTY_TABS_MESSAGE =
  "Nenhuma aba disponível com o seu perfil. Solicite acesso ao administrador.";
