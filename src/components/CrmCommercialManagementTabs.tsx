import React from "react";
import { cn } from "@/src/lib/utils";
import { usePermissions } from "@/src/hooks/usePermissions";
import { isCrmOwnSellerOnly } from "@/src/lib/modulePermissions";
import { useAuth } from "@/src/contexts/AuthContext";
import {
  CRM_UI_TABS,
  type CrmUiTabId,
} from "@/src/lib/moduleTabResources";
import { PERMISSION_EMPTY_TABS_MESSAGE } from "@/src/lib/permissionsClient";

export type CrmManagementTabId = CrmUiTabId;

export type CrmCommercialManagementTabsProps = {
  activeTab: CrmManagementTabId;
  onTabChange: (tab: CrmManagementTabId) => void;
};

export const CrmCommercialManagementTabs: React.FC<CrmCommercialManagementTabsProps> = ({
  activeTab,
  onTabChange,
}) => {
  const auth = useAuth();
  const { canView, listAllowedCrmTabs } = usePermissions();
  const ownSellerTab = isCrmOwnSellerOnly(auth);
  const allowedIds = new Set(listAllowedCrmTabs());
  const tabs = CRM_UI_TABS.filter((tab) => allowedIds.has(tab.id) && canView(tab.resourceKey));

  if (tabs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground border-b border-border pb-3" role="status">
        {PERMISSION_EMPTY_TABS_MESSAGE}
      </p>
    );
  }

  return (
    <div
      className="flex flex-wrap gap-2 border-b border-border pb-3"
      role="tablist"
      aria-label="Visões de gestão comercial"
      data-testid="crm-management-tabs"
    >
      {tabs.map((tab) => {
        const active = activeTab === tab.id;
        const label =
          tab.id === "seller" && ownSellerTab && tab.ownLabel ? tab.ownLabel : tab.label;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              "rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-muted/50 text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
};

export function getDefaultCrmManagementTab(auth: {
  canView?: (resourceKey: string) => boolean;
  hasPermission: (p: string) => boolean;
  hasAnyPermission: (ps: string[]) => boolean;
}): CrmManagementTabId | null {
  const canView =
    auth.canView ??
    ((key: string) => {
      const tab = CRM_UI_TABS.find((t) => t.resourceKey === key);
      if (!tab) return false;
      // fallback legado se API de permissões ainda não injetada
      if (tab.id === "general") return auth.hasPermission("crm.general.view");
      if (tab.id === "seller") {
        return (
          auth.hasPermission("crm.seller.all") || auth.hasPermission("crm.seller.own")
        );
      }
      return (
        auth.hasPermission("crm.general.view") ||
        auth.hasPermission("crm.seller.all") ||
        auth.hasPermission("crm.seller.own")
      );
    });

  const allowed = CRM_UI_TABS.filter((t) => canView(t.resourceKey));
  if (allowed.length === 0) return null;
  const sellerOnly =
    allowed.some((t) => t.id === "seller") && !allowed.some((t) => t.id === "general");
  if (sellerOnly) return "seller";
  return allowed[0]!.id;
}
