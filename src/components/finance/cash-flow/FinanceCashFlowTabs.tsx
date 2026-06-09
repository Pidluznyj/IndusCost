import React from "react";
import {
  controlRoomTabActiveClass,
  controlRoomTabInactiveClass,
} from "@/src/lib/financeControlRoomTheme";
import { cn } from "@/src/lib/utils";

export function FinanceCashFlowTabs<T extends string>({
  tabs,
  activeTab,
  onChange,
  isEnabled,
}: {
  tabs: ReadonlyArray<{ id: T; label: string }>;
  activeTab: T;
  onChange: (id: T) => void;
  isEnabled: (id: T) => boolean;
}) {
  return (
    <nav className="flex flex-wrap gap-1 border-b border-[#E7E5E4]" aria-label="Abas do fluxo de caixa">
      {tabs.map((tab) => {
        const enabled = isEnabled(tab.id);
        const active = activeTab === tab.id && enabled;
        return (
          <button
            key={tab.id}
            type="button"
            data-testid={`tab-${tab.id}`}
            disabled={!enabled}
            onClick={() => enabled && onChange(tab.id)}
            className={cn(active ? controlRoomTabActiveClass : controlRoomTabInactiveClass)}
            title={enabled ? undefined : "Disponível em fase posterior"}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
