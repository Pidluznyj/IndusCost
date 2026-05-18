import React from "react";
import { cn } from "@/src/lib/utils";

export type CrmManagementTabId = "general" | "seller";

export type CrmCommercialManagementTabsProps = {
  activeTab: CrmManagementTabId;
  onTabChange: (tab: CrmManagementTabId) => void;
};

const TABS: { id: CrmManagementTabId; label: string }[] = [
  { id: "general", label: "Gestão Geral" },
  { id: "seller", label: "Gestão por Vendedor" },
];

export const CrmCommercialManagementTabs: React.FC<CrmCommercialManagementTabsProps> = ({
  activeTab,
  onTabChange,
}) => (
  <div
    className="flex flex-wrap gap-2 border-b border-border pb-3"
    role="tablist"
    aria-label="Visões de gestão comercial"
  >
    {TABS.map((tab) => {
      const active = activeTab === tab.id;
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
          {tab.label}
        </button>
      );
    })}
  </div>
);
