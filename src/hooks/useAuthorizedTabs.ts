/**
 * PERM-37 — hook central de abas protegidas.
 * UI só renderiza `visibleTabs`; conteúdo sensível sob `ProtectedTab`.
 */

import { useMemo } from "react";
import { useAuth } from "@/src/contexts/AuthContext";
import {
  resolveAuthorizedTabs,
  type AuthorizedTabDef,
  type AuthorizedTabsResult,
  type ResolveAuthorizedTabsOptions,
} from "@/src/lib/authorizedTabs";
import { navigationAccessContextFromAuth } from "@/src/lib/resourceNavigationAccess";

export type UseAuthorizedTabsArgs<T extends AuthorizedTabDef> = {
  tabs: readonly T[];
} & ResolveAuthorizedTabsOptions<T["id"]>;

export function useAuthorizedTabs<T extends AuthorizedTabDef>(
  args: UseAuthorizedTabsArgs<T>
): AuthorizedTabsResult<T> {
  const auth = useAuth();
  const permissionKey = [
    auth.authUser?.id ?? "",
    auth.authUser?.role ?? "",
    auth.effectiveAccess?.permissionsVersion ?? "",
    (auth.effectiveAccess?.allowedResources ?? []).join("|"),
    String(auth.authLoading),
    auth.authError ?? "",
    args.requestedId ?? "",
    args.parentResourceKey ?? "",
    String(args.requireParentView ?? ""),
    args.tabs.map((t) => `${t.id}:${t.resourceKey}`).join("|"),
  ].join("::");

  return useMemo(() => {
    const ctx = navigationAccessContextFromAuth(auth);
    return resolveAuthorizedTabs(args.tabs, ctx, {
      requestedId: args.requestedId,
      parentResourceKey: args.parentResourceKey,
      requireParentView: args.requireParentView,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permissionKey]);
}
