/**
 * Fonte oficial FE para `view` na navegação (P10/P11).
 *
 * Sidebar e rotas: DTO efetivo (contrato) — sem canAccessModule / mega-key / role matrix.
 * Loading / sessão inválida → sem menu e sem acesso.
 * Path sem módulo mapeado → DENY (salvo allowlist autenticada explícita).
 */

import type { AuthUser } from "@/src/lib/appAuthClient.js";
import type { EffectiveAccessMeDto } from "@/src/lib/effectiveAccessDtoTypes.js";
import {
  resolveModuleIdFromPath,
  type AppModuleId,
  type PermissionChecker,
} from "@/src/lib/modulePermissions.js";
import { getModulePath } from "@/src/lib/navigationGroups.js";
import {
  canAccessResourceClient,
  createSidebarCanViewResource,
  type FrontendPermissionResource,
} from "@/src/lib/permissionsClient.js";
import {
  isAuthenticatedAllowlistPath,
} from "@/src/lib/privateRouteAccess.js";
import { resolveSidebarModuleResourceKey } from "@/src/lib/sidebarMenuResources.js";
import type { SidebarAccessibleNavigation } from "@/src/lib/sidebarNavigation.js";
import {
  buildSidebarNavigationFromEffectiveAccess,
  canViewSidebarModuleFromDto,
  EMPTY_SIDEBAR_NAVIGATION,
  resolveSidebarEffectiveAccessDto,
} from "@/src/lib/sidebarEffectiveAccess.js";
import {
  canViewInternalSurfaceFromDto,
  FINANCE_UI_SECTIONS,
} from "@/src/lib/internalSurfaceAccess.js";

export type ResourceViewOptions = {
  /** MENU: não elevar só por filhos; SUBMENU/TAB: elevação legada. Default: regras do sidebar. */
  elevateFromDescendants?: boolean;
};

export type PathViewDecision = {
  allowed: boolean;
  moduleId: AppModuleId | null;
  resourceKey: string | null;
  /**
   * `unmapped` = path autenticado sem módulo/resource → DENY (P11).
   * `allowlist` = autenticado sem resourceKey por exceção explícita.
   */
  reason:
    | "allowed"
    | "denied"
    | "unmapped"
    | "allowlist"
    | "super_admin"
    | "loading"
    | "session_error";
  source: "effective_dto" | "none" | "super_admin" | "allowlist";
  /** Path pedido — preservado para refresh / grant futuro (URL não é forçada a mudar). */
  intendedPath?: string;
};

export type NavigationAccessContext = {
  user: AuthUser | null | undefined;
  /** Checker legado (AuthContext) — ainda usado por APIs UI; sidebar/rotas DTO não usam. */
  checker: PermissionChecker;
  /** Bloco `/me.effectiveAccess` quando a flag servidor estiver on. */
  effectiveAccess?: EffectiveAccessMeDto | null;
  /** true enquanto /api/auth/me não resolveu — sidebar vazia / rotas bloqueadas. */
  authLoading?: boolean;
  /** Erro de sessão — não libera menu nem rota. */
  authError?: string | null;
};

/** Viewer oficial de resourceKey (reexport tipado). */
export type CanViewResourceFn = (resourceKey: string) => boolean;

/** Alias oficial: `view` do recurso via resolvedor canônico + aliases legados. */
export function canViewResource(
  user: AuthUser | null | undefined,
  resourceKey: string,
  options?: ResourceViewOptions
): boolean {
  return canAccessResourceClient(user, resourceKey, "view", options);
}

/** Mesmas regras da sidebar (MENU sem elevação só por descendentes). */
export function createCanViewResourceForSidebar(
  user: AuthUser | null | undefined
): CanViewResourceFn {
  return createSidebarCanViewResource(user);
}

function resolveDto(ctx: NavigationAccessContext): EffectiveAccessMeDto | null {
  if (ctx.authLoading) return null;
  if (ctx.authError) return null;
  if (!ctx.user) return null;
  return resolveSidebarEffectiveAccessDto({
    user: ctx.user,
    effectiveAccessFromMe: ctx.effectiveAccess,
  });
}

/**
 * View do módulo de menu/rota — somente DTO efetivo (P10/P11).
 * SUPER_ADMIN via `dto.isSuperAdmin` / synthetic DTO — não por role matrix.
 */
export function canViewModule(
  moduleId: AppModuleId,
  ctx: NavigationAccessContext
): boolean {
  if (ctx.authLoading || ctx.authError) return false;
  if (ctx.user && ctx.user.isActive === false && ctx.user.role !== "SUPER_ADMIN") {
    return false;
  }
  const dto = resolveDto(ctx);
  return canViewSidebarModuleFromDto(dto, moduleId);
}

/**
 * Proteção central de rota (Layout / URL direta / RequirePathViewAccess).
 * action implícita = view do resourceKey do módulo (mapa sidebar).
 */
export function evaluatePathViewAccess(
  pathname: string,
  ctx: NavigationAccessContext
): PathViewDecision {
  const intendedPath = pathname;

  if (ctx.authLoading) {
    return {
      allowed: false,
      moduleId: resolveModuleIdFromPath(pathname),
      resourceKey: null,
      reason: "loading",
      source: "none",
      intendedPath,
    };
  }
  if (ctx.authError) {
    return {
      allowed: false,
      moduleId: resolveModuleIdFromPath(pathname),
      resourceKey: null,
      reason: "session_error",
      source: "none",
      intendedPath,
    };
  }

  const dto = resolveDto(ctx);
  if (dto?.isSuperAdmin) {
    return {
      allowed: true,
      moduleId: resolveModuleIdFromPath(pathname),
      resourceKey: null,
      reason: "super_admin",
      source: "super_admin",
      intendedPath,
    };
  }

  if (isAuthenticatedAllowlistPath(pathname)) {
    return {
      allowed: true,
      moduleId: null,
      resourceKey: null,
      reason: "allowlist",
      source: "allowlist",
      intendedPath,
    };
  }

  const moduleId = resolveModuleIdFromPath(pathname);
  if (!moduleId) {
    return {
      allowed: false,
      moduleId: null,
      resourceKey: null,
      reason: "unmapped",
      source: "none",
      intendedPath,
    };
  }

  const resourceKey = resolveSidebarModuleResourceKey(moduleId);
  const allowed = canViewModule(moduleId, ctx);
  return {
    allowed,
    moduleId,
    resourceKey,
    reason: allowed ? "allowed" : "denied",
    source: "effective_dto",
    intendedPath,
  };
}

export function canAccessPath(
  pathname: string,
  ctx: NavigationAccessContext
): boolean {
  return evaluatePathViewAccess(pathname, ctx).allowed;
}

/** Sidebar filtrada exclusivamente pelo DTO efetivo (P10). */
export function buildResourceAwareSidebarNavigation(
  ctx: NavigationAccessContext
): SidebarAccessibleNavigation {
  if (ctx.authLoading || ctx.authError) {
    return EMPTY_SIDEBAR_NAVIGATION;
  }
  if (
    ctx.user &&
    ctx.user.role !== "SUPER_ADMIN" &&
    ctx.user.isActive === false
  ) {
    return EMPTY_SIDEBAR_NAVIGATION;
  }

  const dto = resolveDto(ctx);
  return buildSidebarNavigationFromEffectiveAccess(dto);
}

/**
 * Primeiro path permitido alinhado à sidebar (evita redirect para módulo
 * que a matriz resource-key esconderia, o que geraria AccessDenied em loop).
 */
export function getSafeFirstAllowedPath(
  ctx: NavigationAccessContext
): string | null {
  if (ctx.authLoading || ctx.authError) return null;
  const dto = resolveDto(ctx);
  if (dto?.isSuperAdmin) {
    return getModulePath("dashboard");
  }
  const nav = buildResourceAwareSidebarNavigation(ctx);
  const first = nav.flatAccessibleItems[0];
  return first?.path ?? null;
}

/**
 * Navegação segura: se o destino não tem view, cai no primeiro permitido
 * (ou `null` = nenhuma área — UI deve mostrar NoPermissionsGranted, sem Navigate).
 * URL negada permanece no address bar quando o caller renderiza AccessDenied.
 */
export function resolveSafeNavigateTarget(
  desiredPath: string,
  ctx: NavigationAccessContext
): { path: string | null; redirected: boolean; deniedDesired: boolean } {
  if (canAccessPath(desiredPath, ctx)) {
    return { path: desiredPath, redirected: false, deniedDesired: false };
  }
  const fallback = getSafeFirstAllowedPath(ctx);
  if (!fallback) {
    return { path: null, redirected: false, deniedDesired: true };
  }
  if (fallback === desiredPath || !canAccessPath(fallback, ctx)) {
    return { path: null, redirected: false, deniedDesired: true };
  }
  return { path: fallback, redirected: true, deniedDesired: true };
}

/** Filtra abas/seções por `view` do resourceKey. */
export function filterTabsByView<T extends { resourceKey: string }>(
  tabs: readonly T[],
  canView: CanViewResourceFn,
  options?: { parentResourceKey?: string; requireParentView?: boolean }
): T[] {
  if (
    options?.parentResourceKey &&
    options.requireParentView !== false &&
    !canView(options.parentResourceKey)
  ) {
    return [];
  }
  return tabs.filter((tab) => canView(tab.resourceKey));
}

/**
 * P12 — view de aba/seção via DTO efetivo (contrato), não bag FE paralela.
 */
export function canViewTabResource(
  resourceKey: string,
  ctx: NavigationAccessContext
): boolean {
  if (ctx.authLoading || ctx.authError) return false;
  const dto = resolveDto(ctx);
  return canViewInternalSurfaceFromDto(dto, resourceKey);
}

/** Filtra abas pelo DTO (P12). */
export function filterTabsByViewDto<T extends { resourceKey: string }>(
  tabs: readonly T[],
  ctx: NavigationAccessContext,
  options?: { parentResourceKey?: string; requireParentView?: boolean }
): T[] {
  const canView: CanViewResourceFn = (key) => canViewTabResource(key, ctx);
  return filterTabsByView(tabs, canView, options);
}

/**
 * Escolhe aba ativa sem loop: pedida se permitida; senão primeira permitida; senão null.
 * Bloqueia seleção programática / query string / hash não autorizada.
 */
export function pickAllowedTabId<T extends string>(
  requested: T | null | undefined,
  allowedIds: readonly T[]
): T | null {
  if (allowedIds.length === 0) return null;
  if (requested && allowedIds.includes(requested)) return requested;
  return allowedIds[0] ?? null;
}

/**
 * Resolve aba a partir de query/hash/state — só IDs permitidos.
 */
export function resolveActiveTabFromRequest<T extends string>(args: {
  requested: T | null | undefined;
  allowedTabs: ReadonlyArray<{ id: T; resourceKey: string }>;
  ctx: NavigationAccessContext;
  parentResourceKey?: string;
}): { activeId: T | null; allowedIds: T[] } {
  const allowed = filterTabsByViewDto(args.allowedTabs, args.ctx, {
    parentResourceKey: args.parentResourceKey,
  });
  const allowedIds = allowed.map((t) => t.id);
  return {
    activeId: pickAllowedTabId(args.requested, allowedIds),
    allowedIds,
  };
}

/** Seções FinanceModule visíveis via DTO. */
export function listVisibleFinanceSections(ctx: NavigationAccessContext) {
  return filterTabsByViewDto(FINANCE_UI_SECTIONS, ctx);
}

/** Filtra recursos TAB do catálogo (pai + filhos). */
export function filterCatalogTabsByView(
  tabs: readonly FrontendPermissionResource[],
  canView: CanViewResourceFn,
  parentResourceKey: string
): FrontendPermissionResource[] {
  if (!canView(parentResourceKey)) return [];
  return tabs.filter(
    (r) =>
      r.parentKey === parentResourceKey &&
      r.type === "TAB" &&
      canView(r.key)
  );
}

/** Helper para montar ctx a partir do AuthContext. */
export function navigationAccessContextFromAuth(auth: {
  authUser: AuthUser | null;
  effectiveAccess?: EffectiveAccessMeDto | null;
  authLoading: boolean;
  authError: string | null;
  hasPermission: (p: string) => boolean;
  hasAnyPermission: (ps: string[]) => boolean;
}): NavigationAccessContext {
  return {
    user: auth.authUser,
    checker: auth,
    effectiveAccess: auth.effectiveAccess,
    authLoading: auth.authLoading,
    authError: auth.authError,
  };
}
