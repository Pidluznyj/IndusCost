/**
 * Cliente de permissões para UI (browser-safe).
 * Segurança real fica no backend; aqui só experiência visual a partir de /api/auth/me.
 */

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
  COMERCIAL: "comercial",
  COMERCIAL_PEDIDOS_VENDA: "comercial.pedidos_venda",
  COMERCIAL_CRM: "comercial.crm",
  COMISSOES: "comissoes",
  SUPRIMENTOS: "suprimentos",
  SUPRIMENTOS_INTELIGENCIA_MERCADO: "suprimentos.inteligencia_mercado",
  ADMIN: "admin",
  ADMIN_USUARIOS: "admin.usuarios",
  ADMIN_PERMISSOES: "admin.permissoes",
  ADMIN_PERMISSOES_ACTION_MANAGE: "admin.permissoes.action.manage",
  CONFIGURACOES: "configuracoes",
} as const;

export type PortfolioReconciliationUiTabId =
  | "conciliation"
  | "intelligence"
  | "order-to-cash-audit";

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
    id: "order-to-cash-audit",
    resourceKey: ResourceKeys.FINANCEIRO_CONCILIACAO_TAB_AUDITORIA_PEDIDO_CAIXA,
    label: "Auditoria Pedido → Caixa",
  },
] as const;

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
    key: ResourceKeys.COMISSOES,
    label: "Comissões",
    type: "MENU",
    parentKey: null,
    legacyAliasKeys: ["commissions.view"],
  },
  {
    key: ResourceKeys.SUPRIMENTOS,
    label: "Suprimentos",
    type: "MENU",
    parentKey: null,
    legacyAliasKeys: ["materials.view", "costs.view"],
  },
  {
    key: ResourceKeys.SUPRIMENTOS_INTELIGENCIA_MERCADO,
    label: "Inteligência de Mercado",
    type: "SUBMENU",
    parentKey: ResourceKeys.SUPRIMENTOS,
    legacyAliasKeys: [
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
    [ResourceKeys.COMERCIAL]: V,
    [ResourceKeys.COMERCIAL_PEDIDOS_VENDA]: V,
    [ResourceKeys.COMERCIAL_CRM]: V,
    [ResourceKeys.COMISSOES]: V,
    [ResourceKeys.SUPRIMENTOS]: V,
    [ResourceKeys.SUPRIMENTOS_INTELIGENCIA_MERCADO]: V,
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
    [ResourceKeys.COMISSOES]: V,
  }),
  SELLER: fillRoleMatrix({
    [ResourceKeys.DASHBOARD]: V,
    [ResourceKeys.COMERCIAL]: V,
    [ResourceKeys.COMERCIAL_PEDIDOS_VENDA]: V,
    [ResourceKeys.COMERCIAL_CRM]: V,
    [ResourceKeys.COMISSOES]: V,
  }),
  VIEWER: fillRoleMatrix({
    [ResourceKeys.DASHBOARD]: V,
    [ResourceKeys.COMERCIAL]: V,
    [ResourceKeys.COMERCIAL_PEDIDOS_VENDA]: V,
    [ResourceKeys.COMERCIAL_CRM]: V,
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
