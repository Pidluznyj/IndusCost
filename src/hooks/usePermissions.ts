import { useMemo } from "react";
import { useAuth } from "@/src/contexts/AuthContext";
import {
  createPermissionsApi,
  type PermissionsApi,
  type PortfolioReconciliationUiTabId,
} from "@/src/lib/permissionsClient";

export type UsePermissionsResult = PermissionsApi & {
  authUser: ReturnType<typeof useAuth>["authUser"];
  authLoading: boolean;
  authenticated: boolean;
  /** Recarrega /api/auth/me — permissões refletem após refetch. */
  refetch: () => Promise<void>;
  listAllowedPortfolioReconciliationTabs: () => PortfolioReconciliationUiTabId[];
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
  ].join("::");

  const api = useMemo(
    () => createPermissionsApi(auth.authUser),
    // permissionKey captura mudanças de permissões após loadMe/login.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [permissionKey]
  );

  return {
    ...api,
    authUser: auth.authUser,
    authLoading: auth.authLoading,
    authenticated: auth.authenticated,
    refetch: auth.loadMe,
  };
}
