import React from "react";
import { cn } from "@/src/lib/utils";

export type CrmSellerSubTabId = "dashboard" | "portfolio";

export type CrmSellerSubTabsProps = {
  activeTab: CrmSellerSubTabId;
  onTabChange: (tab: CrmSellerSubTabId) => void;
  ownScopeOnly: boolean;
};

const TABS: { id: CrmSellerSubTabId; label: string; ownLabel?: string }[] = [
  { id: "dashboard", label: "Meu dashboard", ownLabel: "Meu dashboard" },
  { id: "portfolio", label: "Carteira de clientes" },
];

export const CrmSellerSubTabs: React.FC<CrmSellerSubTabsProps> = ({
  activeTab,
  onTabChange,
  ownScopeOnly,
}) => (
  <div
    className="flex flex-wrap gap-2 border-b border-border/80 pb-3"
    role="tablist"
    aria-label="Gestão por vendedor"
  >
    {TABS.map((tab) => {
      const active = activeTab === tab.id;
      const label =
        tab.id === "dashboard" && ownScopeOnly && tab.ownLabel ? tab.ownLabel : tab.label;
      return (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active}
          onClick={() => onTabChange(tab.id)}
          className={cn(
            "rounded-xl px-4 py-2 text-sm font-semibold transition-colors",
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
