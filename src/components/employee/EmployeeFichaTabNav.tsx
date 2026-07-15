import React, { useEffect } from "react";
import { cn } from "@/src/lib/utils";
import { EMPLOYEE_FICHA_TABS, type EmployeeFichaTabId } from "@/src/lib/employeeHrUi";

type EmployeeFichaTabNavProps = {
  activeTab: EmployeeFichaTabId;
  onTabChange: (tab: EmployeeFichaTabId) => void;
  layout?: "sidebar" | "horizontal";
  /** Quando informado, só exibe estas abas (permissões). */
  visibleTabIds?: readonly EmployeeFichaTabId[];
};

export const EmployeeFichaTabNav: React.FC<EmployeeFichaTabNavProps> = ({
  activeTab,
  onTabChange,
  layout = "sidebar",
  visibleTabIds,
}) => {
  const isSidebar = layout === "sidebar";
  const tabs = visibleTabIds
    ? EMPLOYEE_FICHA_TABS.filter((t) => visibleTabIds.includes(t.id))
    : EMPLOYEE_FICHA_TABS;

  useEffect(() => {
    if (!visibleTabIds || visibleTabIds.length === 0) return;
    if (!visibleTabIds.includes(activeTab)) {
      onTabChange(visibleTabIds[0]);
    }
  }, [activeTab, onTabChange, visibleTabIds]);

  return (
    <nav
      className={cn(
        "shrink-0",
        isSidebar
          ? "lg:w-56 border-b lg:border-b-0 lg:border-r border-border bg-muted/20 p-3 lg:p-4"
          : "border-b border-border pb-3"
      )}
      role="tablist"
      aria-label="Seções da ficha do colaborador"
    >
      <div
        className={cn(
          "flex gap-2",
          isSidebar ? "flex-row lg:flex-col overflow-x-auto lg:overflow-x-visible pb-1 lg:pb-0" : "flex-wrap"
        )}
      >
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors whitespace-nowrap shrink-0",
                isSidebar ? "lg:w-full" : "",
                active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground border border-border lg:border-transparent"
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
};
