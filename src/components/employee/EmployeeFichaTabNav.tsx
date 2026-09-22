import React, { useEffect } from "react";
import { cn } from "@/src/lib/utils";
import { EMPLOYEE_FICHA_TABS, type EmployeeFichaTabId } from "@/src/lib/employeeHrUi";

export type EmployeeFichaTabGroup = { label: string; ids: readonly EmployeeFichaTabId[] };

/** Mesma leitura da ficha funcional (ProfileTabs): Perfil → Trabalho → Rotina → Registro. */
export const EMPLOYEE_FICHA_TAB_GROUPS: readonly EmployeeFichaTabGroup[] = [
  { label: "Perfil", ids: ["professional", "personal", "emergency"] },
  { label: "Trabalho", ids: ["career", "compensation", "admin"] },
  { label: "Rotina", ids: ["absences", "epi", "documents"] },
  { label: "Registro", ids: ["notes", "links"] },
];

type EmployeeFichaTabNavProps = {
  activeTab: EmployeeFichaTabId;
  onTabChange: (tab: EmployeeFichaTabId) => void;
  layout?: "sidebar" | "horizontal";
  /** Quando informado, só exibe estas abas (permissões). */
  visibleTabIds?: readonly EmployeeFichaTabId[];
  /** Quando informado, agrupa as abas com rótulo de seção (guias fora de grupo vão ao final). */
  groups?: readonly EmployeeFichaTabGroup[];
};

export const EmployeeFichaTabNav: React.FC<EmployeeFichaTabNavProps> = ({
  activeTab,
  onTabChange,
  layout = "sidebar",
  visibleTabIds,
  groups,
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

  const sections: { label: string | null; tabs: typeof tabs }[] = [];
  if (groups && groups.length > 0) {
    const grouped = new Set<EmployeeFichaTabId>();
    for (const group of groups) {
      const groupTabs = group.ids
        .map((id) => tabs.find((t) => t.id === id))
        .filter((t): t is (typeof tabs)[number] => Boolean(t));
      groupTabs.forEach((t) => grouped.add(t.id));
      if (groupTabs.length > 0) sections.push({ label: group.label, tabs: groupTabs });
    }
    const rest = tabs.filter((t) => !grouped.has(t.id));
    if (rest.length > 0) sections.push({ label: null, tabs: rest });
  } else {
    sections.push({ label: null, tabs });
  }

  const renderTab = (tab: (typeof tabs)[number]) => {
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
  };

  return (
    <nav
      className={cn(
        "shrink-0",
        isSidebar
          ? "lg:w-56 lg:overflow-y-auto border-b lg:border-b-0 lg:border-r border-border bg-muted/20 p-3 lg:p-4"
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
        {sections.map((section, index) => (
          <React.Fragment key={section.label ?? `section-${index}`}>
            {section.label ? (
              <div
                className={cn(
                  "hidden lg:block px-3 pb-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground",
                  index > 0 && "lg:pt-3"
                )}
              >
                {section.label}
              </div>
            ) : null}
            {section.tabs.map(renderTab)}
          </React.Fragment>
        ))}
      </div>
    </nav>
  );
};
