import { useMemo } from "react";
import { useAuth } from "@/src/contexts/AuthContext";
import {
  COMMISSIONS_LIVE_UI_TABS,
  CRM_UI_TABS,
  MATERIALS_UI_SECTIONS,
} from "@/src/lib/moduleTabResources";
import {
  createPermissionsApi,
  FRONTEND_PERMISSION_RESOURCES,
  PORTFOLIO_RECONCILIATION_UI_TABS,
  PORTFOLIO_RECONCILIATION_VISIBLE_TAB_IDS,
  ResourceKeys,
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

  const api = useMemo(() => {
    const bagApi = createPermissionsApi(auth.authUser);
    if (!auth.effectiveAccess) return bagApi;

    // Com DTO do /me, canView/canExecute/canManage não ampliam via bag.
    const ctx = navigationAccessContextFromAuth(auth);
    const canView = (resourceKey: string) => canViewTabResource(resourceKey, ctx);
    const canExecute = (resourceKey: string) =>
      canPerformAction(resourceKey, "execute", ctx);
    const canManage = (resourceKey: string) =>
      canPerformAction(resourceKey, "manage", ctx);

    return {
      ...bagApi,
      canView,
      canExecute,
      canManage,
      getAllowedTabs(parentResourceKey: string) {
        if (!canView(parentResourceKey)) return [];
        return FRONTEND_PERMISSION_RESOURCES.filter(
          (r) =>
            r.parentKey === parentResourceKey &&
            r.type === "TAB" &&
            canView(r.key)
        );
      },
      listAllowedPortfolioReconciliationTabs() {
        return PORTFOLIO_RECONCILIATION_UI_TABS.filter((t) =>
          canView(t.resourceKey)
        ).map((t) => t.id);
      },
      listVisiblePortfolioReconciliationTabs() {
        return PORTFOLIO_RECONCILIATION_VISIBLE_TAB_IDS.filter((id) => {
          const tab = PORTFOLIO_RECONCILIATION_UI_TABS.find((t) => t.id === id);
          return tab ? canView(tab.resourceKey) : false;
        });
      },
      listAllowedCrmTabs() {
        return CRM_UI_TABS.filter((t) => canView(t.resourceKey)).map((t) => t.id);
      },
      listAllowedCommissionsLiveTabs() {
        return COMMISSIONS_LIVE_UI_TABS.filter((t) => canView(t.resourceKey)).map(
          (t) => t.id
        );
      },
      listAllowedMaterialsSections() {
        return MATERIALS_UI_SECTIONS.filter((t) => canView(t.resourceKey)).map(
          (t) => t.id
        );
      },
      canViewPortfolioModule() {
        return (
          canView(ResourceKeys.FINANCEIRO_CONCILIACAO_CARTEIRA) ||
          PORTFOLIO_RECONCILIATION_UI_TABS.some((t) => canView(t.resourceKey))
        );
      },
    } satisfies PermissionsApi;
    // permissionKey captura mudanças de permissões após loadMe/login.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permissionKey]);

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
