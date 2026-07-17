/**
 * PERM-37 — resolução central de abas autorizadas (catálogo + DTO /me).
 * Ocultação de aba ≠ autorização de API (`requireResource` / ProtectedTab).
 */

import {
  filterTabsByViewDto,
  pickAllowedTabId,
  type NavigationAccessContext,
} from "@/src/lib/resourceNavigationAccess.js";

export type AuthorizedTabDef = {
  id: string;
  resourceKey: string;
};

export type ResolveAuthorizedTabsOptions<TId extends string = string> = {
  requestedId?: TId | null;
  parentResourceKey?: string;
  requireParentView?: boolean;
};

export type AuthorizedTabsResult<T extends AuthorizedTabDef> = {
  /** Abas visíveis na ordem do catálogo (sem gaps). */
  visibleTabs: T[];
  allowedIds: Array<T["id"]>;
  /** Pedida se permitida; senão primeira permitida; senão null. */
  activeId: T["id"] | null;
  /** Nenhuma aba permitida → acesso negado na página. */
  isEmpty: boolean;
  /** URL/estado pediu aba negada (corrigida via activeId). */
  requestedDenied: boolean;
};

/**
 * Filtra abas pelo DTO efetivo e resolve a aba ativa.
 * SUPER_ADMIN: todas as abas do catálogo (via canViewTabResource).
 */
export function resolveAuthorizedTabs<T extends AuthorizedTabDef>(
  tabs: readonly T[],
  ctx: NavigationAccessContext,
  options?: ResolveAuthorizedTabsOptions<T["id"]>
): AuthorizedTabsResult<T> {
  const visibleTabs = filterTabsByViewDto(tabs, ctx, {
    parentResourceKey: options?.parentResourceKey,
    requireParentView: options?.requireParentView,
  });
  const allowedIds = visibleTabs.map((t) => t.id);
  const requested = options?.requestedId ?? null;
  const activeId = pickAllowedTabId(requested, allowedIds);
  const requestedDenied = Boolean(
    requested != null &&
      requested !== "" &&
      !allowedIds.includes(requested)
  );
  return {
    visibleTabs,
    allowedIds,
    activeId,
    isEmpty: visibleTabs.length === 0,
    requestedDenied,
  };
}
