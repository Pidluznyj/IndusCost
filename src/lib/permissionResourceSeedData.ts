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
    description: "Módulo Conciliação / Inteligência / Auditoria Pedido → Caixa.",
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
    legacyAliasKeys: ["crm.view"],
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
    key: "suprimentos",
    label: "Suprimentos",
    description: "Materiais / compras (entrada lateral).",
    type: "MENU",
    parentKey: null,
    module: "materials",
    sortOrder: 50,
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
    sortOrder: 51,
    isSystem: true,
    legacyAliasKeys: ["materials.market_quote.approve", "materials.market_quote.manual_exchange"],
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
    "financeiro.contas_receber": VE,
    "financeiro.contas_pagar": VE,
    "financeiro.fluxo_caixa": V,
    "financeiro.relatorio_presidencial": V,
    comercial: V,
    "comercial.pedidos_venda": V,
    "comercial.crm": V,
    comissoes: V,
    suprimentos: V,
    "suprimentos.inteligencia_mercado": V,
    admin: V,
    "admin.usuarios": VM,
    "admin.permissoes": V,
    // ACL crítica: sem manage por padrão (SUPER_ADMIN / política explícita).
    "admin.permissoes.action.manage": NONE,
  },
  COMMERCIAL_MANAGER: {
    dashboard: V,
    financeiro: NONE,
    "financeiro.conciliacao_carteira": NONE,
    "financeiro.conciliacao_carteira.tab.conciliacao": NONE,
    "financeiro.conciliacao_carteira.tab.inteligencia": NONE,
    "financeiro.conciliacao_carteira.tab.auditoria_pedido_caixa": NONE,
    "financeiro.contas_receber": NONE,
    "financeiro.contas_pagar": NONE,
    "financeiro.fluxo_caixa": NONE,
    "financeiro.relatorio_presidencial": NONE,
    comercial: V,
    "comercial.pedidos_venda": V,
    "comercial.crm": V,
    comissoes: V,
    suprimentos: NONE,
    "suprimentos.inteligencia_mercado": NONE,
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
    "financeiro.contas_receber": NONE,
    "financeiro.contas_pagar": NONE,
    "financeiro.fluxo_caixa": NONE,
    "financeiro.relatorio_presidencial": NONE,
    comercial: V,
    "comercial.pedidos_venda": V,
    "comercial.crm": V,
    comissoes: V,
    suprimentos: NONE,
    "suprimentos.inteligencia_mercado": NONE,
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
    "financeiro.contas_receber": NONE,
    "financeiro.contas_pagar": NONE,
    "financeiro.fluxo_caixa": NONE,
    "financeiro.relatorio_presidencial": NONE,
    comercial: V,
    "comercial.pedidos_venda": V,
    "comercial.crm": V,
    comissoes: NONE,
    suprimentos: NONE,
    "suprimentos.inteligencia_mercado": NONE,
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
