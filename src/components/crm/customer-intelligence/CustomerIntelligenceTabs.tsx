import React from "react";
import { cn } from "@/src/lib/utils";
import {
  CUSTOMER_INTELLIGENCE_TAB_IDS,
  CUSTOMER_INTELLIGENCE_TAB_LABELS,
  type CustomerIntelligenceTabId,
} from "@/src/lib/customerIntelligenceNavigation";

export function CustomerIntelligenceTabs({
  activeTab,
  onChange,
}: {
  activeTab: CustomerIntelligenceTabId;
  onChange: (tab: CustomerIntelligenceTabId) => void;
}) {
  return (
    <nav
      className="customer-intelligence-no-print flex flex-wrap gap-1 border-b border-border pb-1"
      aria-label="Abas da inteligência do cliente"
    >
      {CUSTOMER_INTELLIGENCE_TAB_IDS.map((tabId) => (
        <button
          key={tabId}
          type="button"
          onClick={() => onChange(tabId)}
          className={cn(
            "rounded-t-lg px-3 py-2 text-sm font-semibold transition-colors",
            activeTab === tabId
              ? "bg-primary/10 text-primary border-b-2 border-primary -mb-[2px]"
              : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
          )}
        >
          {CUSTOMER_INTELLIGENCE_TAB_LABELS[tabId]}
        </button>
      ))}
    </nav>
  );
}

export function CustomerIntelligenceTabPlaceholder({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="customer-intelligence-tab-panel rounded-xl border border-dashed border-border bg-muted/15 p-8 text-center">
      <p className="text-base font-semibold">{title}</p>
      <p className="text-sm text-muted-foreground mt-2 max-w-lg mx-auto">{description}</p>
      <p className="text-xs text-muted-foreground mt-4">Conteúdo detalhado — próxima etapa.</p>
    </div>
  );
}
