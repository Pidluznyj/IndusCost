/**
 * Catálogo seed + matriz por role para PermissionResource / RolePermission.
 * Fonte documental: docs/security/permissions-model-plan.md
 * Não altera AppUser.permissions[] — só prepara o modelo relacional.
 */

import type { AppUserRole } from "@prisma/client";

/** Espelha o enum Prisma PermissionResourceType (evita acoplar testes ao generate). */
export type PermissionResourceTypeSeed = "MENU" | "SUBMENU" | "TAB" | "ACTION";

export type PermissionResourceSeed = {
  key: string;
  label: string;
  description: string;
  type: PermissionResourceTypeSeed;
  parentKey: string | null;
  module: string;
  sortOrder: number;
  isSystem: true;
  legacyAliasKeys: string[];
};

export type RolePermissionFlags = {
  canView: boolean;
  canExecute: boolean;
  canManage: boolean;
};

export type RolePermissionSeed = {
  role: AppUserRole;
  resourceKey: string;
} & RolePermissionFlags;

/** Catálogo mínimo oficial (MENU → SUBMENU → TAB → ACTION). */
export const PERMISSION_RESOURCE_SEEDS: readonly PermissionResourceSeed[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    description: "Painel principal.",
    type: "MENU",
    parentKey: null,
    module: "dashboard",
    sortOrder: 10,
    isSystem: true,
    legacyAliasKeys: ["dashboard.view"],
  },
  {
    key: "financeiro",
    label: "Financeiro",
    description: "Domínio financeiro no menu.",
    type: "MENU",
    parentKey: null,
    module: "finance",
    sortOrder: 20,
    isSystem: true,
    legacyAliasKeys: ["finance.view"],
  },
  {
    key: "financeiro.conciliacao_carteira",
    label: "Conciliação de Carteira",
    description: "Módulo Conciliação / Inteligência / Auditoria / Status Pedidos.",
    type: "SUBMENU",
    parentKey: "financeiro",
    module: "finance",
    sortOrder: 21,
    isSystem: true,
    legacyAliasKeys: ["finance.portfolioReconciliation.view"],
  },
  {
    key: "financeiro.conciliacao_carteira.tab.conciliacao",
    label: "Aba Conciliação",
    description: "Conciliar carteira vs pedido/caixa.",
    type: "TAB",
    parentKey: "financeiro.conciliacao_carteira",
    module: "finance",
    sortOrder: 22,
    isSystem: true,
    legacyAliasKeys: ["finance.portfolioReconciliation.conciliation.view"],
  },
  {
    key: "financeiro.conciliacao_carteira.tab.inteligencia",
    label: "Aba Inteligência da Carteira",
    description: "KPIs e inteligência O2C da carteira.",
    type: "TAB",
    parentKey: "financeiro.conciliacao_carteira",
    module: "finance",
    sortOrder: 23,
    isSystem: true,
    legacyAliasKeys: ["finance.portfolioReconciliation.intelligence.view"],
  },
  {
    key: "financeiro.conciliacao_carteira.tab.auditoria_pedido_caixa",
    label: "Aba Auditoria Pedido → Caixa",
    description: "Auditoria materializada pedido → caixa.",
    type: "TAB",
    parentKey: "financeiro.conciliacao_carteira",
    module: "finance",
    sortOrder: 24,
    isSystem: true,
    legacyAliasKeys: ["finance.portfolioReconciliation.orderToCashAudit.view"],
  },
  {
    key: "financeiro.conciliacao_carteira.tab.status_pedidos",
    label: "Aba Status Pedidos",
    description: "Status consolidado por Pedido de Venda (OrderToCashAudit).",
    type: "TAB",
    parentKey: "financeiro.conciliacao_carteira",
    module: "finance",
    sortOrder: 25,
    isSystem: true,
    legacyAliasKeys: ["finance.portfolioReconciliation.orderStatusPedidos.view"],
  },
  {
    key: "financeiro.contas_receber",
    label: "Contas a Receber",
    description: "Dashboard e seções de Contas a Receber.",
    type: "SUBMENU",
    parentKey: "financeiro",
    module: "finance",
    sortOrder: 25,
    isSystem: true,
    legacyAliasKeys: ["finance.accountsReceivable.view"],
  },
  {
    key: "financeiro.contas_pagar",
    label: "Contas a Pagar",
    description: "Dashboard e seções de Contas a Pagar.",
    type: "SUBMENU",
    parentKey: "financeiro",
    module: "finance",
    sortOrder: 26,
    isSystem: true,
    legacyAliasKeys: ["finance.accountsPayable.view"],
  },
  {
    key: "financeiro.fluxo_caixa",
    label: "Fluxo de Caixa",
    description: "Visão de fluxo de caixa (chave dedicada; runtime ainda pode usar OR legado).",
    type: "SUBMENU",
    parentKey: "financeiro",
    module: "finance",
    sortOrder: 27,
    isSystem: true,
    legacyAliasKeys: [],
  },
  {
    key: "financeiro.relatorio_presidencial",
    label: "Relatório Presidencial",
    description: "Relatório executivo / presidencial.",
    type: "SUBMENU",
    parentKey: "financeiro",
    module: "finance",
    sortOrder: 28,
    isSystem: true,
    legacyAliasKeys: ["finance.executiveReport.view"],
  },
  {
    key: "comercial",
    label: "Comercial",
    description: "Âncora do grupo comercial; grants efetivos nos submenus.",
    type: "MENU",
    parentKey: null,
    module: "comercial",
    sortOrder: 30,
    isSystem: true,
    legacyAliasKeys: ["crm.view", "sales_orders.view"],
  },
  {
    key: "comercial.pedidos_venda",
    label: "Pedidos de Venda",
    description: "Módulo de pedidos de venda.",
    type: "SUBMENU",
    parentKey: "comercial",
    module: "sales-orders",
    sortOrder: 31,
    isSystem: true,
    legacyAliasKeys: ["sales_orders.view"],
  },
  {
    key: "comercial.crm",
    label: "CRM",
    description: "CRM Comercial.",
    type: "SUBMENU",
    parentKey: "comercial",
    module: "crm-commercial",
    sortOrder: 32,
    isSystem: true,
    legacyAliasKeys: ["crm.view", "crm.general.view", "crm.seller.view"],
  },
  {
    key: "comercial.crm.tab.gestao_geral",
    label: "Gestão Geral",
    description: "Dashboard de gestão comercial geral.",
    type: "TAB",
    parentKey: "comercial.crm",
    module: "crm-commercial",
    sortOrder: 33,
    isSystem: true,
    legacyAliasKeys: ["crm.general.view"],
  },
  {
    key: "comercial.crm.tab.gestao_vendedor",
    label: "Gestão por Responsável",
    description: "Dashboard do vendedor (próprio ou todos).",
    type: "TAB",
    parentKey: "comercial.crm",
    module: "crm-commercial",
    sortOrder: 34,
    isSystem: true,
    legacyAliasKeys: ["crm.seller.own", "crm.seller.all", "crm.seller.view"],
  },
  {
    key: "comercial.crm.tab.carteira_clientes",
    label: "Carteira de Clientes",
    description: "Carteira / lista de clientes do CRM.",
    type: "TAB",
    parentKey: "comercial.crm",
    module: "crm-commercial",
    sortOrder: 35,
    isSystem: true,
    legacyAliasKeys: ["crm.general.view", "crm.seller.own", "crm.seller.all", "crm.view"],
  },
  {
    key: "comercial.crm.tab.cliente_360",
    label: "Cliente 360",
    description: "Cockpit / inteligência do cliente.",
    type: "TAB",
    parentKey: "comercial.crm",
    module: "crm-commercial",
    sortOrder: 36,
    isSystem: true,
    legacyAliasKeys: [
      "crm.customer_cockpit.view",
      "customers.commercial360.view",
      "customers.view",
    ],
  },
  {
    key: "comissoes",
    label: "Comissões",
    description: "Módulo de comissões.",
    type: "MENU",
    parentKey: null,
    module: "commissions",
    sortOrder: 40,
    isSystem: true,
    legacyAliasKeys: ["commissions.view"],
  },
  {
    key: "comissoes.tab.fechamento_mes",
    label: "Fechamento do mês",
    description: "Fechamento / liberação por recebimento (UI atual).",
    type: "TAB",
    parentKey: "comissoes",
    module: "commissions",
    sortOrder: 41,
    isSystem: true,
    legacyAliasKeys: [
      "commissions.view",
      "commissions.dashboard.view",
      "commissions.payments.view",
      "commissions.release.view",
    ],
  },
  {
    key: "comissoes.tab.excecoes_cliente",
    label: "Exceções por cliente",
    description: "Exclusões / exceções de comissão por cliente.",
    type: "TAB",
    parentKey: "comissoes",
    module: "commissions",
    sortOrder: 42,
    isSystem: true,
    legacyAliasKeys: ["commissions.rules.view", "commissions.view"],
  },
  {
    key: "comissoes.tab.relatorios",
    label: "Relatórios",
    description: "Relatórios de comissões.",
    type: "TAB",
    parentKey: "comissoes",
    module: "commissions",
    sortOrder: 43,
    isSystem: true,
    legacyAliasKeys: ["commissions.view", "commissions.dashboard.view", "commissions.audit.view"],
  },
  {
    key: "comissoes.tab.reprocessar",
    label: "Reprocessar",
    description: "Prévia e aplicação de reprocessamento de comissões materializadas.",
    type: "TAB",
    parentKey: "comissoes",
    module: "commissions",
    sortOrder: 44,
    isSystem: true,
    legacyAliasKeys: [
      "commissions.view",
      "commissions.payments.manage",
      "commissions.rules.manage",
      "commissions.audit.view",
    ],
  },
  {
    key: "comissoes.tab.dashboard",
    label: "Dashboard",
    description: "Dashboard legado de comissões.",
    type: "TAB",
    parentKey: "comissoes",
    module: "commissions",
    sortOrder: 45,
    isSystem: true,
    legacyAliasKeys: ["commissions.dashboard.view", "commissions.view"],
  },
  {
    key: "comissoes.tab.previstas",
    label: "Previstas",
    description: "Comissões previstas / forecast.",
    type: "TAB",
    parentKey: "comissoes",
    module: "commissions",
    sortOrder: 46,
    isSystem: true,
    legacyAliasKeys: ["commissions.forecast.view", "commissions.view"],
  },
  {
    key: "comissoes.tab.confirmadas",
    label: "Confirmadas",
    description: "Comissões confirmadas / geradas.",
    type: "TAB",
    parentKey: "comissoes",
    module: "commissions",
    sortOrder: 47,
    isSystem: true,
    legacyAliasKeys: ["commissions.confirmed.view", "commissions.view"],
  },
  {
    key: "comissoes.tab.liberacao",
    label: "Liberação por Recebimento",
    description: "Liberação de comissões.",
    type: "TAB",
    parentKey: "comissoes",
    module: "commissions",
    sortOrder: 48,
    isSystem: true,
    legacyAliasKeys: ["commissions.release.view", "commissions.view"],
  },
  {
    key: "comissoes.tab.pagamentos",
    label: "Pagamentos",
    description: "Pagamentos / lotes de comissão.",
    type: "TAB",
    parentKey: "comissoes",
    module: "commissions",
    sortOrder: 49,
    isSystem: true,
    legacyAliasKeys: ["commissions.payments.view", "commissions.view"],
  },
  {
    key: "comissoes.tab.pessoas",
    label: "Pessoas Comissionadas",
    description: "Cadastro de pessoas comissionadas.",
    type: "TAB",
    parentKey: "comissoes",
    module: "commissions",
    sortOrder: 50,
    isSystem: true,
    legacyAliasKeys: ["commissions.people.view", "commissions.view"],
  },
  {
    key: "comissoes.tab.regras",
    label: "Regras",
    description: "Regras de comissionamento.",
    type: "TAB",
    parentKey: "comissoes",
    module: "commissions",
    sortOrder: 51,
    isSystem: true,
    legacyAliasKeys: ["commissions.rules.view", "commissions.view"],
  },
  {
    key: "comissoes.tab.auditoria",
    label: "Auditoria",
    description: "Auditoria de comissões.",
    type: "TAB",
    parentKey: "comissoes",
    module: "commissions",
    sortOrder: 52,
    isSystem: true,
    legacyAliasKeys: ["commissions.audit.view", "commissions.view"],
  },
  {
    key: "comissoes.tab.configuracoes",
    label: "Configurações",
    description: "Configurações do módulo de comissões.",
    type: "TAB",
    parentKey: "comissoes",
    module: "commissions",
    sortOrder: 53,
    isSystem: true,
    legacyAliasKeys: ["commissions.settings.view", "commissions.view"],
  },
  {
    key: "suprimentos",
    label: "Suprimentos",
    description: "Materiais / compras (entrada lateral).",
    type: "MENU",
    parentKey: null,
    module: "materials",
    sortOrder: 60,
    isSystem: true,
    legacyAliasKeys: ["materials.view", "costs.view"],
  },
  {
    key: "suprimentos.tab.catalogo",
    label: "Matérias-primas",
    description: "Catálogo de matérias-primas.",
    type: "TAB",
    parentKey: "suprimentos",
    module: "materials",
    sortOrder: 61,
    isSystem: true,
    legacyAliasKeys: ["materials.view", "costs.view"],
  },
  {
    key: "suprimentos.inteligencia_mercado",
    label: "Inteligência de Mercado",
    description: "Cotações e alertas de mercado.",
    type: "SUBMENU",
    parentKey: "suprimentos",
    module: "materials",
    sortOrder: 62,
    isSystem: true,
    legacyAliasKeys: [
      "materials.view",
      "materials.market_quote.approve",
      "materials.market_quote.manual_exchange",
    ],
  },
  {
    key: "suprimentos.inteligencia_mercado.tab.home",
    label: "Home Inteligência",
    description: "Painel home de inteligência de mercado.",
    type: "TAB",
    parentKey: "suprimentos.inteligencia_mercado",
    module: "materials",
    sortOrder: 63,
    isSystem: true,
    legacyAliasKeys: ["materials.view"],
  },
  {
    key: "suprimentos.inteligencia_mercado.tab.materia_prima_360",
    label: "Matéria-prima 360",
    description: "Detalhe 360º da matéria-prima.",
    type: "TAB",
    parentKey: "suprimentos.inteligencia_mercado",
    module: "materials",
    sortOrder: 64,
    isSystem: true,
    legacyAliasKeys: ["materials.view"],
  },
  {
    key: "suprimentos.inteligencia_mercado.tab.fornecedores",
    label: "Fornecedores / cotações",
    description: "Fornecedores e cotações de mercado.",
    type: "TAB",
    parentKey: "suprimentos.inteligencia_mercado",
    module: "materials",
    sortOrder: 65,
    isSystem: true,
    legacyAliasKeys: ["materials.view"],
  },
  {
    key: "suprimentos.inteligencia_mercado.tab.alertas",
    label: "Alertas",
    description: "Alertas de mercado.",
    type: "TAB",
    parentKey: "suprimentos.inteligencia_mercado",
    module: "materials",
    sortOrder: 66,
    isSystem: true,
    legacyAliasKeys: ["materials.view"],
  },
  {
    key: "suprimentos.inteligencia_mercado.tab.configuracoes",
    label: "Configurações",
    description: "Configuração de alertas e cotações.",
    type: "TAB",
    parentKey: "suprimentos.inteligencia_mercado",
    module: "materials",
    sortOrder: 67,
    isSystem: true,
    legacyAliasKeys: [
      "materials.edit",
      "materials.view",
      "materials.market_quote.approve",
      "materials.market_quote.manual_exchange",
    ],
  },
  {
    key: "admin",
    label: "Administração",
    description: "Configurações e governança.",
    type: "MENU",
    parentKey: null,
    module: "settings",
    sortOrder: 90,
    isSystem: true,
    legacyAliasKeys: ["settings.view"],
  },
  {
    key: "admin.usuarios",
    label: "Usuários",
    description: "Gestão de usuários da aplicação.",
    type: "SUBMENU",
    parentKey: "admin",
    module: "settings",
    sortOrder: 91,
    isSystem: true,
    legacyAliasKeys: ["users.manage"],
  },
  {
    key: "admin.permissoes",
    label: "Permissões / Perfis",
    description: "Perfis de acesso e editor de permissões.",
    type: "SUBMENU",
    parentKey: "admin",
    module: "settings",
    sortOrder: 92,
    isSystem: true,
    legacyAliasKeys: ["accessProfiles.view"],
  },
  {
    key: "admin.permissoes.action.manage",
    label: "Gerir permissões",
    description: "Criar/editar perfis e grants de ACL.",
    type: "ACTION",
    parentKey: "admin.permissoes",
    module: "settings",
    sortOrder: 93,
    isSystem: true,
    legacyAliasKeys: ["accessProfiles.manage"],
  },
] as const;

const V: RolePermissionFlags = { canView: true, canExecute: false, canManage: false };
const VE: RolePermissionFlags = { canView: true, canExecute: true, canManage: false };
const VM: RolePermissionFlags = { canView: true, canExecute: false, canManage: true };
const ALL: RolePermissionFlags = { canView: true, canExecute: true, canManage: true };
const NONE: RolePermissionFlags = { canView: false, canExecute: false, canManage: false };

/** Matriz default por role (docs/security/permissions-model-plan.md §4). */
const ROLE_MATRIX: Record<Exclude<AppUserRole, "SUPER_ADMIN">, Record<string, RolePermissionFlags>> = {
  ADMIN: {
    dashboard: V,
    financeiro: V,
    "financeiro.conciliacao_carteira": V,
    "financeiro.conciliacao_carteira.tab.conciliacao": V,
    "financeiro.conciliacao_carteira.tab.inteligencia": V,
    "financeiro.conciliacao_carteira.tab.auditoria_pedido_caixa": V,
    "financeiro.conciliacao_carteira.tab.status_pedidos": V,
    "financeiro.contas_receber": VE,
    "financeiro.contas_pagar": VE,
    "financeiro.fluxo_caixa": V,
    "financeiro.relatorio_presidencial": V,
    comercial: V,
    "comercial.pedidos_venda": V,
    "comercial.crm": V,
    "comercial.crm.tab.gestao_geral": V,
    "comercial.crm.tab.gestao_vendedor": V,
    "comercial.crm.tab.carteira_clientes": V,
    "comercial.crm.tab.cliente_360": V,
    comissoes: V,
    "comissoes.tab.fechamento_mes": V,
    "comissoes.tab.excecoes_cliente": V,
    "comissoes.tab.relatorios": V,
    "comissoes.tab.reprocessar": V,
    "comissoes.tab.dashboard": V,
    "comissoes.tab.previstas": V,
    "comissoes.tab.confirmadas": V,
    "comissoes.tab.liberacao": V,
    "comissoes.tab.pagamentos": V,
    "comissoes.tab.pessoas": V,
    "comissoes.tab.regras": V,
    "comissoes.tab.auditoria": V,
    "comissoes.tab.configuracoes": V,
    suprimentos: V,
    "suprimentos.tab.catalogo": V,
    "suprimentos.inteligencia_mercado": V,
    "suprimentos.inteligencia_mercado.tab.home": V,
    "suprimentos.inteligencia_mercado.tab.materia_prima_360": V,
    "suprimentos.inteligencia_mercado.tab.fornecedores": V,
    "suprimentos.inteligencia_mercado.tab.alertas": V,
    "suprimentos.inteligencia_mercado.tab.configuracoes": VE,
    admin: V,
    "admin.usuarios": VM,
    "admin.permissoes": V,
    "admin.permissoes.action.manage": NONE,
  },
  COMMERCIAL_MANAGER: {
    dashboard: V,
    financeiro: NONE,
    "financeiro.conciliacao_carteira": NONE,
    "financeiro.conciliacao_carteira.tab.conciliacao": NONE,
    "financeiro.conciliacao_carteira.tab.inteligencia": NONE,
    "financeiro.conciliacao_carteira.tab.auditoria_pedido_caixa": NONE,
    "financeiro.conciliacao_carteira.tab.status_pedidos": NONE,
    "financeiro.contas_receber": NONE,
    "financeiro.contas_pagar": NONE,
    "financeiro.fluxo_caixa": NONE,
    "financeiro.relatorio_presidencial": NONE,
    comercial: V,
    "comercial.pedidos_venda": V,
    "comercial.crm": V,
    "comercial.crm.tab.gestao_geral": V,
    "comercial.crm.tab.gestao_vendedor": V,
    "comercial.crm.tab.carteira_clientes": V,
    "comercial.crm.tab.cliente_360": V,
    comissoes: V,
    "comissoes.tab.fechamento_mes": V,
    "comissoes.tab.excecoes_cliente": V,
    "comissoes.tab.relatorios": V,
    "comissoes.tab.reprocessar": V,
    "comissoes.tab.dashboard": V,
    "comissoes.tab.previstas": V,
    "comissoes.tab.confirmadas": V,
    "comissoes.tab.liberacao": V,
    "comissoes.tab.pagamentos": V,
    "comissoes.tab.pessoas": V,
    "comissoes.tab.regras": V,
    "comissoes.tab.auditoria": V,
    "comissoes.tab.configuracoes": NONE,
    suprimentos: NONE,
    "suprimentos.tab.catalogo": NONE,
    "suprimentos.inteligencia_mercado": NONE,
    "suprimentos.inteligencia_mercado.tab.home": NONE,
    "suprimentos.inteligencia_mercado.tab.materia_prima_360": NONE,
    "suprimentos.inteligencia_mercado.tab.fornecedores": NONE,
    "suprimentos.inteligencia_mercado.tab.alertas": NONE,
    "suprimentos.inteligencia_mercado.tab.configuracoes": NONE,
    admin: NONE,
    "admin.usuarios": NONE,
    "admin.permissoes": NONE,
    "admin.permissoes.action.manage": NONE,
  },
  SELLER: {
    dashboard: V,
    financeiro: NONE,
    "financeiro.conciliacao_carteira": NONE,
    "financeiro.conciliacao_carteira.tab.conciliacao": NONE,
    "financeiro.conciliacao_carteira.tab.inteligencia": NONE,
    "financeiro.conciliacao_carteira.tab.auditoria_pedido_caixa": NONE,
    "financeiro.conciliacao_carteira.tab.status_pedidos": NONE,
    "financeiro.contas_receber": NONE,
    "financeiro.contas_pagar": NONE,
    "financeiro.fluxo_caixa": NONE,
    "financeiro.relatorio_presidencial": NONE,
    comercial: V,
    "comercial.pedidos_venda": V,
    "comercial.crm": V,
    "comercial.crm.tab.gestao_geral": NONE,
    "comercial.crm.tab.gestao_vendedor": V,
    "comercial.crm.tab.carteira_clientes": V,
    "comercial.crm.tab.cliente_360": V,
    comissoes: V,
    "comissoes.tab.fechamento_mes": V,
    "comissoes.tab.excecoes_cliente": NONE,
    "comissoes.tab.relatorios": V,
    "comissoes.tab.reprocessar": V,
    "comissoes.tab.dashboard": V,
    "comissoes.tab.previstas": V,
    "comissoes.tab.confirmadas": V,
    "comissoes.tab.liberacao": NONE,
    "comissoes.tab.pagamentos": NONE,
    "comissoes.tab.pessoas": NONE,
    "comissoes.tab.regras": NONE,
    "comissoes.tab.auditoria": NONE,
    "comissoes.tab.configuracoes": NONE,
    suprimentos: NONE,
    "suprimentos.tab.catalogo": NONE,
    "suprimentos.inteligencia_mercado": NONE,
    "suprimentos.inteligencia_mercado.tab.home": NONE,
    "suprimentos.inteligencia_mercado.tab.materia_prima_360": NONE,
    "suprimentos.inteligencia_mercado.tab.fornecedores": NONE,
    "suprimentos.inteligencia_mercado.tab.alertas": NONE,
    "suprimentos.inteligencia_mercado.tab.configuracoes": NONE,
    admin: NONE,
    "admin.usuarios": NONE,
    "admin.permissoes": NONE,
    "admin.permissoes.action.manage": NONE,
  },
  VIEWER: {
    dashboard: V,
    financeiro: NONE,
    "financeiro.conciliacao_carteira": NONE,
    "financeiro.conciliacao_carteira.tab.conciliacao": NONE,
    "financeiro.conciliacao_carteira.tab.inteligencia": NONE,
    "financeiro.conciliacao_carteira.tab.auditoria_pedido_caixa": NONE,
    "financeiro.conciliacao_carteira.tab.status_pedidos": NONE,
    "financeiro.contas_receber": NONE,
    "financeiro.contas_pagar": NONE,
    "financeiro.fluxo_caixa": NONE,
    "financeiro.relatorio_presidencial": NONE,
    comercial: V,
    "comercial.pedidos_venda": V,
    "comercial.crm": NONE,
    "comercial.crm.tab.gestao_geral": NONE,
    "comercial.crm.tab.gestao_vendedor": NONE,
    "comercial.crm.tab.carteira_clientes": NONE,
    "comercial.crm.tab.cliente_360": NONE,
    comissoes: NONE,
    "comissoes.tab.fechamento_mes": NONE,
    "comissoes.tab.excecoes_cliente": NONE,
    "comissoes.tab.relatorios": NONE,
    "comissoes.tab.reprocessar": NONE,
    "comissoes.tab.dashboard": NONE,
    "comissoes.tab.previstas": NONE,
    "comissoes.tab.confirmadas": NONE,
    "comissoes.tab.liberacao": NONE,
    "comissoes.tab.pagamentos": NONE,
    "comissoes.tab.pessoas": NONE,
    "comissoes.tab.regras": NONE,
    "comissoes.tab.auditoria": NONE,
    "comissoes.tab.configuracoes": NONE,
    suprimentos: NONE,
    "suprimentos.tab.catalogo": NONE,
    "suprimentos.inteligencia_mercado": NONE,
    "suprimentos.inteligencia_mercado.tab.home": NONE,
    "suprimentos.inteligencia_mercado.tab.materia_prima_360": NONE,
    "suprimentos.inteligencia_mercado.tab.fornecedores": NONE,
    "suprimentos.inteligencia_mercado.tab.alertas": NONE,
    "suprimentos.inteligencia_mercado.tab.configuracoes": NONE,
    admin: NONE,
    "admin.usuarios": NONE,
    "admin.permissoes": NONE,
    "admin.permissoes.action.manage": NONE,
  },
};

export function listPermissionResourceKeys(): string[] {
  return PERMISSION_RESOURCE_SEEDS.map((r) => r.key);
}

/** Pais antes dos filhos (seguro para FK parentKey). */
export function sortPermissionResourcesForInsert(
  rows: readonly PermissionResourceSeed[] = PERMISSION_RESOURCE_SEEDS
): PermissionResourceSeed[] {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const depth = (key: string, seen = new Set<string>()): number => {
    if (seen.has(key)) return 0;
    seen.add(key);
    const row = byKey.get(key);
    if (!row?.parentKey) return 0;
    return 1 + depth(row.parentKey, seen);
  };
  return [...rows].sort((a, b) => {
    const d = depth(a.key) - depth(b.key);
    if (d !== 0) return d;
    return a.sortOrder - b.sortOrder || a.key.localeCompare(b.key);
  });
}

export function buildRolePermissionSeeds(
  resourceKeys: readonly string[] = listPermissionResourceKeys()
): RolePermissionSeed[] {
  const out: RolePermissionSeed[] = [];
  for (const resourceKey of resourceKeys) {
    out.push({ role: "SUPER_ADMIN", resourceKey, ...ALL });
    for (const role of ["ADMIN", "COMMERCIAL_MANAGER", "SELLER", "VIEWER"] as const) {
      const flags = ROLE_MATRIX[role][resourceKey] ?? NONE;
      out.push({ role, resourceKey, ...flags });
    }
  }
  return out;
}

const FULL_FLAGS: RolePermissionFlags = ALL;
const EMPTY_FLAGS: RolePermissionFlags = NONE;

/** Flags oficiais do preset da role para um resourceKey (fonte única: ROLE_MATRIX). */
export function getOfficialRolePermissionFlags(
  role: AppUserRole,
  resourceKey: string
): RolePermissionFlags {
  if (role === "SUPER_ADMIN") return { ...FULL_FLAGS };
  return { ...(ROLE_MATRIX[role][resourceKey] ?? EMPTY_FLAGS) };
}

export const OFFICIAL_APP_USER_ROLES: readonly AppUserRole[] = [
  "SUPER_ADMIN",
  "ADMIN",
  "COMMERCIAL_MANAGER",
  "SELLER",
  "VIEWER",
] as const;

export type CatalogIntegrityIssue = { code: string; message: string };

export function validatePermissionResourceCatalog(
  rows: readonly PermissionResourceSeed[] = PERMISSION_RESOURCE_SEEDS
): CatalogIntegrityIssue[] {
  const issues: CatalogIntegrityIssue[] = [];
  const keys = new Set<string>();
  for (const row of rows) {
    if (keys.has(row.key)) {
      issues.push({ code: "DUPLICATE_KEY", message: row.key });
    }
    keys.add(row.key);
  }
  for (const row of rows) {
    if (row.parentKey && !keys.has(row.parentKey)) {
      issues.push({
        code: "MISSING_PARENT",
        message: `${row.key} → ${row.parentKey}`,
      });
    }
    if (row.type === "MENU" && row.parentKey) {
      issues.push({ code: "MENU_WITH_PARENT", message: row.key });
    }
    if (row.type === "SUBMENU" && !row.parentKey) {
      issues.push({ code: "SUBMENU_WITHOUT_PARENT", message: row.key });
    }
    if (row.type === "TAB" && !row.parentKey) {
      issues.push({ code: "TAB_WITHOUT_PARENT", message: row.key });
    }
    if (row.type === "ACTION" && !row.parentKey) {
      issues.push({ code: "ACTION_WITHOUT_PARENT", message: row.key });
    }
  }
  for (const role of ["ADMIN", "COMMERCIAL_MANAGER", "SELLER", "VIEWER"] as const) {
    for (const key of keys) {
      if (!(key in ROLE_MATRIX[role])) {
        issues.push({ code: "MATRIX_GAP", message: `${role}/${key}` });
      }
    }
  }
  return issues;
}

/**
 * Política de upsert de RolePermission:
 * - SUPER_ADMIN: sempre sincroniza flags full.
 * - demais roles: cria se ausente; se existir, só atualiza quando syncRoleDefaults=true.
 * Nunca deleta linhas.
 */
export function shouldUpdateExistingRolePermission(args: {
  role: AppUserRole;
  syncRoleDefaults: boolean;
}): boolean {
  if (args.role === "SUPER_ADMIN") return true;
  return args.syncRoleDefaults;
}
