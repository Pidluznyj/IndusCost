/**
 * Cliente de permissões para UI (browser-safe).
 * Segurança real fica no backend; aqui só experiência visual a partir de /api/auth/me.
 */

import {
  COMMISSIONS_LIVE_UI_TABS,
  CRM_UI_TABS,
  MATERIALS_UI_SECTIONS,
} from "@/src/lib/moduleTabResources.js";
import type { AppUserRole, AuthUser } from "@/src/lib/appAuthClient.js";

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
  COMERCIAL: "comercial",
  COMERCIAL_PEDIDOS_VENDA: "comercial.pedidos_venda",
  COMERCIAL_CRM: "comercial.crm",
  COMERCIAL_CRM_TAB_GESTAO_GERAL: "comercial.crm.tab.gestao_geral",
  COMERCIAL_CRM_TAB_GESTAO_VENDEDOR: "comercial.crm.tab.gestao_vendedor",
  COMERCIAL_CRM_TAB_CARTEIRA_CLIENTES: "comercial.crm.tab.carteira_clientes",
  COMERCIAL_CRM_TAB_CLIENTE_360: "comercial.crm.tab.cliente_360",
  COMISSOES: "comissoes",
  COMISSOES_TAB_FECHAMENTO_MES: "comissoes.tab.fechamento_mes",
  COMISSOES_TAB_EXCECOES_CLIENTE: "comissoes.tab.excecoes_cliente",
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

const V: PermissionFlags = { canView: true, canExecute: false, canManage: false };
const VE: PermissionFlags = { canView: true, canExecute: true, canManage: false };
const VM: PermissionFlags = { canView: true, canExecute: false, canManage: true };
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
    legacyAliasKeys: ["finance.view"],
  },
  {
    key: ResourceKeys.FINANCEIRO_CONCILIACAO_CARTEIRA,
    label: "Conciliação de Carteira",
    type: "SUBMENU",
    parentKey: ResourceKeys.FINANCEIRO,
    legacyAliasKeys: ["finance.portfolioReconciliation.view"],
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
    legacyAliasKeys: ["crm.view", "sales_orders.view"],
  },
  {
    key: ResourceKeys.COMERCIAL_PEDIDOS_VENDA,
    label: "Pedidos de Venda",
    type: "SUBMENU",
    parentKey: ResourceKeys.COMERCIAL,
    legacyAliasKeys: ["sales_orders.view"],
  },
  {
    key: ResourceKeys.COMERCIAL_CRM,
    label: "CRM",
    type: "SUBMENU",
    parentKey: ResourceKeys.COMERCIAL,
    legacyAliasKeys: ["crm.view", "crm.general.view", "crm.seller.view"],
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
    legacyAliasKeys: ["crm.seller.own", "crm.seller.all", "crm.seller.view"],
  },
  {
    key: ResourceKeys.COMERCIAL_CRM_TAB_CARTEIRA_CLIENTES,
    label: "Carteira de Clientes",
    type: "TAB",
    parentKey: ResourceKeys.COMERCIAL_CRM,
    legacyAliasKeys: ["crm.general.view", "crm.seller.own", "crm.seller.all", "crm.view"],
  },
  {
    key: ResourceKeys.COMERCIAL_CRM_TAB_CLIENTE_360,
    label: "Cliente 360",
    type: "TAB",
    parentKey: ResourceKeys.COMERCIAL_CRM,
    legacyAliasKeys: [
      "crm.customer_cockpit.view",
      "customers.commercial360.view",
      "customers.view",
    ],
  },
  {
    key: ResourceKeys.COMISSOES,
    label: "Comissões",
    type: "MENU",
    parentKey: null,
    legacyAliasKeys: ["commissions.view"],
  },
  {
    key: ResourceKeys.COMISSOES_TAB_FECHAMENTO_MES,
    label: "Fechamento do mês",
    type: "TAB",
    parentKey: ResourceKeys.COMISSOES,
    legacyAliasKeys: [
      "commissions.view",
      "commissions.dashboard.view",
      "commissions.payments.view",
      "commissions.release.view",
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
    key: ResourceKeys.COMISSOES_TAB_RELATORIOS,
    label: "Relatórios",
    type: "TAB",
    parentKey: ResourceKeys.COMISSOES,
    legacyAliasKeys: ["commissions.view", "commissions.dashboard.view", "commissions.audit.view"],
  },
  {
    key: ResourceKeys.COMISSOES_TAB_REPROCESSAR,
    label: "Reprocessar",
    type: "TAB",
    parentKey: ResourceKeys.COMISSOES,
    legacyAliasKeys: [
      "commissions.view",
      "commissions.payments.manage",
      "commissions.rules.manage",
      "commissions.audit.view",
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
    legacyAliasKeys: ["materials.view", "costs.view"],
  },
  {
    key: ResourceKeys.SUPRIMENTOS_TAB_CATALOGO,
    label: "Matérias-primas",
    type: "TAB",
    parentKey: ResourceKeys.SUPRIMENTOS,
    legacyAliasKeys: ["materials.view", "costs.view"],
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
    label: "Configurações",
    type: "MENU",
    parentKey: null,
    legacyAliasKeys: ["settings.view", "users.manage"],
  },
] as const;

function fillRoleMatrix(
  grants: Partial<Record<string, PermissionFlags>>
): Record<string, PermissionFlags> {
  const out: Record<string, PermissionFlags> = {};
  for (const r of FRONTEND_PERMISSION_RESOURCES) {
    out[r.key] = grants[r.key] ?? NONE;
  }
  return out;
}

const ROLE_MATRIX: Record<
  Exclude<AppUserRole, "SUPER_ADMIN">,
  Record<string, PermissionFlags>
> = {
  ADMIN: fillRoleMatrix({
    [ResourceKeys.DASHBOARD]: V,
    [ResourceKeys.FINANCEIRO]: V,
    [ResourceKeys.FINANCEIRO_CONCILIACAO_CARTEIRA]: V,
    [ResourceKeys.FINANCEIRO_CONCILIACAO_TAB_CONCILIACAO]: V,
    [ResourceKeys.FINANCEIRO_CONCILIACAO_TAB_INTELIGENCIA]: V,
    [ResourceKeys.FINANCEIRO_CONCILIACAO_TAB_AUDITORIA_PEDIDO_CAIXA]: V,
    [ResourceKeys.FINANCEIRO_CONCILIACAO_TAB_STATUS_PEDIDOS]: V,
    [ResourceKeys.COMERCIAL]: V,
    [ResourceKeys.COMERCIAL_PEDIDOS_VENDA]: V,
    [ResourceKeys.COMERCIAL_CRM]: V,
    [ResourceKeys.COMERCIAL_CRM_TAB_GESTAO_GERAL]: V,
    [ResourceKeys.COMERCIAL_CRM_TAB_GESTAO_VENDEDOR]: V,
    [ResourceKeys.COMERCIAL_CRM_TAB_CARTEIRA_CLIENTES]: V,
    [ResourceKeys.COMERCIAL_CRM_TAB_CLIENTE_360]: V,
    [ResourceKeys.COMISSOES]: V,
    [ResourceKeys.COMISSOES_TAB_FECHAMENTO_MES]: V,
    [ResourceKeys.COMISSOES_TAB_EXCECOES_CLIENTE]: V,
    [ResourceKeys.COMISSOES_TAB_RELATORIOS]: V,
    [ResourceKeys.COMISSOES_TAB_REPROCESSAR]: V,
    [ResourceKeys.COMISSOES_TAB_DASHBOARD]: V,
    [ResourceKeys.COMISSOES_TAB_PREVISTAS]: V,
    [ResourceKeys.COMISSOES_TAB_CONFIRMADAS]: V,
    [ResourceKeys.COMISSOES_TAB_LIBERACAO]: V,
    [ResourceKeys.COMISSOES_TAB_PAGAMENTOS]: V,
    [ResourceKeys.COMISSOES_TAB_PESSOAS]: V,
    [ResourceKeys.COMISSOES_TAB_REGRAS]: V,
    [ResourceKeys.COMISSOES_TAB_AUDITORIA]: V,
    [ResourceKeys.COMISSOES_TAB_CONFIGURACOES]: V,
    [ResourceKeys.SUPRIMENTOS]: V,
    [ResourceKeys.SUPRIMENTOS_TAB_CATALOGO]: V,
    [ResourceKeys.SUPRIMENTOS_INTELIGENCIA_MERCADO]: V,
    [ResourceKeys.SUPRIMENTOS_MI_TAB_HOME]: V,
    [ResourceKeys.SUPRIMENTOS_MI_TAB_MATERIA_PRIMA_360]: V,
    [ResourceKeys.SUPRIMENTOS_MI_TAB_FORNECEDORES]: V,
    [ResourceKeys.SUPRIMENTOS_MI_TAB_ALERTAS]: V,
    [ResourceKeys.SUPRIMENTOS_MI_TAB_CONFIGURACOES]: VE,
    [ResourceKeys.ADMIN]: V,
    [ResourceKeys.ADMIN_USUARIOS]: VM,
    [ResourceKeys.ADMIN_PERMISSOES]: V,
    [ResourceKeys.ADMIN_PERMISSOES_ACTION_MANAGE]: NONE,
    [ResourceKeys.CONFIGURACOES]: V,
  }),
  COMMERCIAL_MANAGER: fillRoleMatrix({
    [ResourceKeys.DASHBOARD]: V,
    [ResourceKeys.COMERCIAL]: V,
    [ResourceKeys.COMERCIAL_PEDIDOS_VENDA]: V,
    [ResourceKeys.COMERCIAL_CRM]: V,
    [ResourceKeys.COMERCIAL_CRM_TAB_GESTAO_GERAL]: V,
    [ResourceKeys.COMERCIAL_CRM_TAB_GESTAO_VENDEDOR]: V,
    [ResourceKeys.COMERCIAL_CRM_TAB_CARTEIRA_CLIENTES]: V,
    [ResourceKeys.COMERCIAL_CRM_TAB_CLIENTE_360]: V,
    [ResourceKeys.COMISSOES]: V,
    [ResourceKeys.COMISSOES_TAB_FECHAMENTO_MES]: V,
    [ResourceKeys.COMISSOES_TAB_EXCECOES_CLIENTE]: V,
    [ResourceKeys.COMISSOES_TAB_RELATORIOS]: V,
    [ResourceKeys.COMISSOES_TAB_REPROCESSAR]: V,
    [ResourceKeys.COMISSOES_TAB_DASHBOARD]: V,
    [ResourceKeys.COMISSOES_TAB_PREVISTAS]: V,
    [ResourceKeys.COMISSOES_TAB_CONFIRMADAS]: V,
    [ResourceKeys.COMISSOES_TAB_LIBERACAO]: V,
    [ResourceKeys.COMISSOES_TAB_PAGAMENTOS]: V,
    [ResourceKeys.COMISSOES_TAB_PESSOAS]: V,
    [ResourceKeys.COMISSOES_TAB_REGRAS]: V,
    [ResourceKeys.COMISSOES_TAB_AUDITORIA]: V,
  }),
  SELLER: fillRoleMatrix({
    [ResourceKeys.DASHBOARD]: V,
    [ResourceKeys.COMERCIAL]: V,
    [ResourceKeys.COMERCIAL_PEDIDOS_VENDA]: V,
    [ResourceKeys.COMERCIAL_CRM]: V,
    [ResourceKeys.COMERCIAL_CRM_TAB_GESTAO_VENDEDOR]: V,
    [ResourceKeys.COMERCIAL_CRM_TAB_CARTEIRA_CLIENTES]: V,
    [ResourceKeys.COMERCIAL_CRM_TAB_CLIENTE_360]: V,
    [ResourceKeys.COMISSOES]: V,
    [ResourceKeys.COMISSOES_TAB_FECHAMENTO_MES]: V,
    [ResourceKeys.COMISSOES_TAB_RELATORIOS]: V,
    [ResourceKeys.COMISSOES_TAB_REPROCESSAR]: V,
    [ResourceKeys.COMISSOES_TAB_DASHBOARD]: V,
    [ResourceKeys.COMISSOES_TAB_PREVISTAS]: V,
    [ResourceKeys.COMISSOES_TAB_CONFIRMADAS]: V,
  }),
  VIEWER: fillRoleMatrix({
    [ResourceKeys.DASHBOARD]: V,
    [ResourceKeys.COMERCIAL]: V,
    [ResourceKeys.COMERCIAL_PEDIDOS_VENDA]: V,
    [ResourceKeys.COMERCIAL_CRM]: NONE,
    [ResourceKeys.COMERCIAL_CRM_TAB_GESTAO_GERAL]: NONE,
    [ResourceKeys.COMERCIAL_CRM_TAB_GESTAO_VENDEDOR]: NONE,
    [ResourceKeys.COMERCIAL_CRM_TAB_CARTEIRA_CLIENTES]: NONE,
    [ResourceKeys.COMERCIAL_CRM_TAB_CLIENTE_360]: NONE,
  }),
};

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

function resolveRawFlags(user: AuthUser, resourceKey: string): PermissionFlags {
  if (user.role === "SUPER_ADMIN") return { ...ALL };

  let flags: PermissionFlags =
    user.role === "SUPER_ADMIN"
      ? { ...ALL }
      : { ...(ROLE_MATRIX[user.role]?.[resourceKey] ?? NONE) };

  const resource = byKey.get(resourceKey);
  if (!resource) return flags;

  const effective = user.effectivePermissions ?? user.permissions ?? [];
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
    "monthlyClosing" | "customerExclusions" | "reports" | "reprocess"
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
