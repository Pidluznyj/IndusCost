import { useMemo } from "react";
import { useAuth } from "@/src/contexts/AuthContext";
import {
  createPermissionsApi,
  type PermissionsApi,
  type PortfolioReconciliationUiTabId,
} from "@/src/lib/permissionsClient";
import {
  canViewModule,
  canViewResource,
  canViewTabResource,
  canPerformAction,
  evaluatePathViewAccess,
  filterTabsByViewDto,
  getSafeFirstAllowedPath,
  listVisibleFinanceSections,
  navigationAccessContextFromAuth,
  pickAllowedTabId,
  resolveActiveTabFromRequest,
  type PathViewDecision,
} from "@/src/lib/resourceNavigationAccess";
import type { AppModuleId } from "@/src/lib/modulePermissions";
import type { UiPermissionAction } from "@/src/lib/actionPermissionAccess";

export type UsePermissionsResult = PermissionsApi & {
  authUser: ReturnType<typeof useAuth>["authUser"];
  authLoading: boolean;
  authError: string | null;
  authenticated: boolean;
  /** Prompt 11 — aliases oficiais de navegação. */
  refetch: () => Promise<void>;
  listAllowedPortfolioReconciliationTabs: () => PortfolioReconciliationUiTabId[];
  canViewResource: (resourceKey: string) => boolean;
  canViewTabResource: (resourceKey: string) => boolean;
  canPerformAction: (resourceKey: string, action: UiPermissionAction) => boolean;
  canViewModule: (moduleId: AppModuleId) => boolean;
  evaluatePathViewAccess: (pathname: string) => PathViewDecision;
  getSafeFirstAllowedPath: () => string | null;
  pickAllowedTabId: typeof pickAllowedTabId;
  filterTabsByViewDto: typeof filterTabsByViewDto;
  resolveActiveTabFromRequest: typeof resolveActiveTabFromRequest;
  listVisibleFinanceSections: () => ReturnType<typeof listVisibleFinanceSections>;
};

/**
 * Hook de permissões para UI. Não é segurança — o backend valida nas APIs.
 */
export function usePermissions(): UsePermissionsResult {
  const auth = useAuth();
  const permissionKey = [
    auth.authUser?.id ?? "",
    auth.authUser?.role ?? "",
    (auth.authUser?.effectivePermissions ?? []).join("|"),
    String(auth.authUser?.isActive ?? ""),
    auth.effectiveAccess?.permissionsVersion ?? "",
    (auth.effectiveAccess?.allowedResources ?? []).join("|"),
    String(auth.authLoading),
    auth.authError ?? "",
  ].join("::");

  const api = useMemo(
    () => createPermissionsApi(auth.authUser),
    // permissionKey captura mudanças de permissões após loadMe/login.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [permissionKey]
  );

  const nav = useMemo(() => {
    const ctx = navigationAccessContextFromAuth(auth);
    return {
      canViewResource: (resourceKey: string) =>
        canViewResource(auth.authUser, resourceKey, {
          effectiveAccess: auth.effectiveAccess,
        }),
      canViewTabResource: (resourceKey: string) => canViewTabResource(resourceKey, ctx),
      canPerformAction: (resourceKey: string, action: UiPermissionAction) =>
        canPerformAction(resourceKey, action, ctx),
      canViewModule: (moduleId: AppModuleId) => canViewModule(moduleId, ctx),
      evaluatePathViewAccess: (pathname: string) => evaluatePathViewAccess(pathname, ctx),
      getSafeFirstAllowedPath: () => getSafeFirstAllowedPath(ctx),
      pickAllowedTabId,
      filterTabsByViewDto: <T extends { resourceKey: string }>(
        tabs: readonly T[],
        options?: { parentResourceKey?: string; requireParentView?: boolean }
      ) => filterTabsByViewDto(tabs, ctx, options),
      resolveActiveTabFromRequest,
      listVisibleFinanceSections: () => listVisibleFinanceSections(ctx),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permissionKey]);

  return {
    ...api,
    ...nav,
    authUser: auth.authUser,
    authLoading: auth.authLoading,
    authError: auth.authError,
    authenticated: auth.authenticated,
    refetch: auth.loadMe,
  };
}
