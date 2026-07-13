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
  ADMIN: "admin",
  ADMIN_USUARIOS: "admin.usuarios",
  ADMIN_PERMISSOES: "admin.permissoes",
  ADMIN_PERMISSOES_ACTION_MANAGE: "admin.permissoes.action.manage",
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
    key: ResourceKeys.ADMIN,
    label: "Administração",
    type: "MENU",
    parentKey: null,
    legacyAliasKeys: ["settings.view"],
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
] as const;

const ROLE_MATRIX: Record<
  Exclude<AppUserRole, "SUPER_ADMIN">,
  Record<string, PermissionFlags>
> = {
  ADMIN: {
    [ResourceKeys.DASHBOARD]: V,
    [ResourceKeys.FINANCEIRO]: V,
    [ResourceKeys.FINANCEIRO_CONCILIACAO_CARTEIRA]: V,
    [ResourceKeys.FINANCEIRO_CONCILIACAO_TAB_CONCILIACAO]: V,
    [ResourceKeys.FINANCEIRO_CONCILIACAO_TAB_INTELIGENCIA]: V,
    [ResourceKeys.FINANCEIRO_CONCILIACAO_TAB_AUDITORIA_PEDIDO_CAIXA]: V,
    [ResourceKeys.ADMIN]: V,
    [ResourceKeys.ADMIN_USUARIOS]: VM,
    [ResourceKeys.ADMIN_PERMISSOES]: V,
    [ResourceKeys.ADMIN_PERMISSOES_ACTION_MANAGE]: NONE,
  },
  COMMERCIAL_MANAGER: {
    [ResourceKeys.DASHBOARD]: V,
    [ResourceKeys.FINANCEIRO]: NONE,
    [ResourceKeys.FINANCEIRO_CONCILIACAO_CARTEIRA]: NONE,
    [ResourceKeys.FINANCEIRO_CONCILIACAO_TAB_CONCILIACAO]: NONE,
    [ResourceKeys.FINANCEIRO_CONCILIACAO_TAB_INTELIGENCIA]: NONE,
    [ResourceKeys.FINANCEIRO_CONCILIACAO_TAB_AUDITORIA_PEDIDO_CAIXA]: NONE,
    [ResourceKeys.ADMIN]: NONE,
    [ResourceKeys.ADMIN_USUARIOS]: NONE,
    [ResourceKeys.ADMIN_PERMISSOES]: NONE,
    [ResourceKeys.ADMIN_PERMISSOES_ACTION_MANAGE]: NONE,
  },
  SELLER: {
    [ResourceKeys.DASHBOARD]: V,
    [ResourceKeys.FINANCEIRO]: NONE,
    [ResourceKeys.FINANCEIRO_CONCILIACAO_CARTEIRA]: NONE,
    [ResourceKeys.FINANCEIRO_CONCILIACAO_TAB_CONCILIACAO]: NONE,
    [ResourceKeys.FINANCEIRO_CONCILIACAO_TAB_INTELIGENCIA]: NONE,
    [ResourceKeys.FINANCEIRO_CONCILIACAO_TAB_AUDITORIA_PEDIDO_CAIXA]: NONE,
    [ResourceKeys.ADMIN]: NONE,
    [ResourceKeys.ADMIN_USUARIOS]: NONE,
    [ResourceKeys.ADMIN_PERMISSOES]: NONE,
    [ResourceKeys.ADMIN_PERMISSOES_ACTION_MANAGE]: NONE,
  },
  VIEWER: {
    [ResourceKeys.DASHBOARD]: V,
    [ResourceKeys.FINANCEIRO]: NONE,
    [ResourceKeys.FINANCEIRO_CONCILIACAO_CARTEIRA]: NONE,
    [ResourceKeys.FINANCEIRO_CONCILIACAO_TAB_CONCILIACAO]: NONE,
    [ResourceKeys.FINANCEIRO_CONCILIACAO_TAB_INTELIGENCIA]: NONE,
    [ResourceKeys.FINANCEIRO_CONCILIACAO_TAB_AUDITORIA_PEDIDO_CAIXA]: NONE,
    [ResourceKeys.ADMIN]: NONE,
    [ResourceKeys.ADMIN_USUARIOS]: NONE,
    [ResourceKeys.ADMIN_PERMISSOES]: NONE,
    [ResourceKeys.ADMIN_PERMISSOES_ACTION_MANAGE]: NONE,
  },
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
  action: PermissionAction = "view"
): boolean {
  if (!user || user.isActive === false) return false;
  if (user.role === "SUPER_ADMIN") return true;

  if (!byKey.has(resourceKey)) return false;

  const effective = user.effectivePermissions ?? user.permissions ?? [];

  // Elevação de ancestrais: se este recurso (ou um descendente concedido)…
  // Para o próprio recurso, se concedido via alias, garantir pais com view via
  // checagem: pais têm view se role/alias OU se algum descendente direto foi
  // concedido e estamos no caminho — aplicamos: ao checar filho com alias,
  // pais são tratados como view=true virtualmente.
  const grantedByAlias = (key: string): boolean => {
    const res = byKey.get(key);
    if (!res) return false;
    return res.legacyAliasKeys.some((a) => effective.includes(a));
  };

  const hasView = (key: string): boolean => {
    const raw = resolveRawFlags(user, key);
    if (raw.canView) return true;
    if (grantedByAlias(key)) return true;
    // Pai elevado se algum descendente no catálogo foi concedido por alias
    // e este key é ancestral desse descendente.
    for (const res of FRONTEND_PERMISSION_RESOURCES) {
      if (!grantedByAlias(res.key)) continue;
      if (ancestorKeys(res.key).includes(key)) return true;
    }
    return false;
  };

  for (const ancestor of ancestorKeys(resourceKey)) {
    if (!hasView(ancestor)) return false;
  }

  const flags = resolveFlagsWithLegacyAncestors(user, resourceKey);
  const viewOk = hasView(resourceKey);
  if (action === "view") return viewOk;
  if (!viewOk) return false;
  if (action === "execute") return flags.canExecute;
  return flags.canManage;
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
