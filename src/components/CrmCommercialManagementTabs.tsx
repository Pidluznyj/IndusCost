import React from "react";
import { cn } from "@/src/lib/utils";
import { useAuth } from "@/src/contexts/AuthContext";
import {
  canAccessCrmGeneral,
  canAccessCrmPortfolio,
  canAccessCrmSeller,
  isCrmOwnSellerOnly,
} from "@/src/lib/modulePermissions";

export type CrmManagementTabId = "general" | "seller" | "portfolio";

export type CrmCommercialManagementTabsProps = {
  activeTab: CrmManagementTabId;
  onTabChange: (tab: CrmManagementTabId) => void;
};

const ALL_TABS: {
  id: CrmManagementTabId;
  label: string;
  ownLabel?: string;
}[] = [
  { id: "general", label: "Gestão Geral" },
  { id: "seller", label: "Gestão por Vendedor", ownLabel: "Meu Dashboard" },
  { id: "portfolio", label: "Carteira de Clientes" },
];

function isTabVisible(
  tabId: CrmManagementTabId,
  auth: ReturnType<typeof useAuth>
): boolean {
  if (tabId === "general") return canAccessCrmGeneral(auth);
  if (tabId === "seller") return canAccessCrmSeller(auth);
  return canAccessCrmPortfolio(auth);
}

export const CrmCommercialManagementTabs: React.FC<CrmCommercialManagementTabsProps> = ({
  activeTab,
  onTabChange,
}) => {
  const auth = useAuth();
  const ownSellerTab = isCrmOwnSellerOnly(auth);
  const tabs = ALL_TABS.filter((tab) => isTabVisible(tab.id, auth));

  if (tabs.length === 0) return null;

  return (
    <div
      className="flex flex-wrap gap-2 border-b border-border pb-3"
      role="tablist"
      aria-label="Visões de gestão comercial"
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
  hasPermission: (p: string) => boolean;
  hasAnyPermission: (ps: string[]) => boolean;
}): CrmManagementTabId | null {
  if (canAccessCrmSeller(auth) && !canAccessCrmGeneral(auth)) return "seller";
  if (canAccessCrmGeneral(auth)) return "general";
  if (canAccessCrmSeller(auth)) return "seller";
  if (canAccessCrmPortfolio(auth)) return "portfolio";
  return null;
}
