/**
 * Fonte oficial FE para `view` na navegação (P10/P11).
 *
 * Sidebar e canViewModule: DTO efetivo (contrato) — sem canAccessModule / mega-key.
 * Loading / sessão inválida → sem menu e sem acesso de módulo.
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
import { resolveSidebarModuleResourceKey } from "@/src/lib/sidebarMenuResources.js";
import type { SidebarAccessibleNavigation } from "@/src/lib/sidebarNavigation.js";
import {
  buildSidebarNavigationFromEffectiveAccess,
  canViewSidebarModuleFromDto,
  EMPTY_SIDEBAR_NAVIGATION,
  resolveSidebarEffectiveAccessDto,
} from "@/src/lib/sidebarEffectiveAccess.js";

export type ResourceViewOptions = {
  /** MENU: não elevar só por filhos; SUBMENU/TAB: elevação legada. Default: regras do sidebar. */
  elevateFromDescendants?: boolean;
};

export type PathViewDecision = {
  allowed: boolean;
  moduleId: AppModuleId | null;
  resourceKey: string | null;
  /** `unmapped` = rota autenticada fora do mapa de módulos (não bloqueia no Layout — P11). */
  reason: "allowed" | "denied" | "unmapped" | "super_admin" | "loading" | "session_error";
  source: "effective_dto" | "none" | "super_admin";
};

export type NavigationAccessContext = {
  user: AuthUser | null | undefined;
  /** Checker legado (AuthContext) — ainda usado por APIs UI; sidebar não usa. */
  checker: PermissionChecker;
  /** Bloco `/me.effectiveAccess` quando a flag servidor estiver on. */
  effectiveAccess?: EffectiveAccessMeDto | null;
  /** true enquanto /api/auth/me não resolveu — sidebar vazia. */
  authLoading?: boolean;
  /** Erro de sessão — não libera menu. */
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
 * View do módulo de menu/rota — somente DTO efetivo (P10).
 */
export function canViewModule(
  moduleId: AppModuleId,
  ctx: NavigationAccessContext
): boolean {
  if (ctx.authLoading || ctx.authError) return false;
  if (ctx.user?.role === "SUPER_ADMIN") return true;
  if (ctx.user && ctx.user.isActive === false) return false;
  const dto = resolveDto(ctx);
  return canViewSidebarModuleFromDto(dto, moduleId);
}

/**
 * Proteção de rota por path (Layout / URL direta).
 * Paths não mapeados a `AppModuleId` → `unmapped` (allowed), evitando loop/falso negativo.
 */
export function evaluatePathViewAccess(
  pathname: string,
  ctx: NavigationAccessContext
): PathViewDecision {
  if (ctx.authLoading) {
    return {
      allowed: false,
      moduleId: resolveModuleIdFromPath(pathname),
      resourceKey: null,
      reason: "loading",
      source: "none",
    };
  }
  if (ctx.authError) {
    return {
      allowed: false,
      moduleId: resolveModuleIdFromPath(pathname),
      resourceKey: null,
      reason: "session_error",
      source: "none",
    };
  }
  const { user } = ctx;
  if (user?.role === "SUPER_ADMIN") {
    return {
      allowed: true,
      moduleId: resolveModuleIdFromPath(pathname),
      resourceKey: null,
      reason: "super_admin",
      source: "super_admin",
    };
  }

  const moduleId = resolveModuleIdFromPath(pathname);
  if (!moduleId) {
    return {
      allowed: true,
      moduleId: null,
      resourceKey: null,
      reason: "unmapped",
      source: "none",
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
  if (ctx.user?.role === "SUPER_ADMIN") {
    return getModulePath("dashboard");
  }
  const nav = buildResourceAwareSidebarNavigation(ctx);
  const first = nav.flatAccessibleItems[0];
  return first?.path ?? null;
}

/**
 * Navegação segura: se o destino não tem view, cai no primeiro permitido
 * (ou `null` = nenhuma área — UI deve mostrar NoPermissionsGranted, sem Navigate).
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
 * Escolhe aba ativa sem loop: pedida se permitida; senão primeira permitida; senão null.
 */
export function pickAllowedTabId<T extends string>(
  requested: T | null | undefined,
  allowedIds: readonly T[]
): T | null {
  if (allowedIds.length === 0) return null;
  if (requested && allowedIds.includes(requested)) return requested;
  return allowedIds[0] ?? null;
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
