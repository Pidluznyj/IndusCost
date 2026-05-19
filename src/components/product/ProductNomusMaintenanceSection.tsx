import React, { useState } from "react";
import { cn } from "@/src/lib/utils";
import { NomusBomBatchReportPanel } from "@/src/components/product/NomusBomBatchReportPanel";
import { NomusBomClassificationPanel } from "@/src/components/product/NomusBomClassificationPanel";
import { NomusBomApplyPlanPanel } from "@/src/components/product/NomusBomApplyPlanPanel";

export type NomusMaintenanceTab = "divergences" | "classification" | "apply-plan";

const NOMUS_MAINTENANCE_SUBTABS: { id: NomusMaintenanceTab; label: string }[] = [
  { id: "divergences", label: "Divergências" },
  { id: "classification", label: "Classificação" },
  { id: "apply-plan", label: "Plano dry-run" },
];

type ProductNomusMaintenanceSectionProps = {
  onOpenProduct?: (productId: string) => void;
};

export const ProductNomusMaintenanceSection: React.FC<ProductNomusMaintenanceSectionProps> = ({
  onOpenProduct,
}) => {
  const [activeNomusMaintenanceTab, setActiveNomusMaintenanceTab] =
    useState<NomusMaintenanceTab>("divergences");

  return (
    <div className="space-y-4" data-tour="products-nomus-maintenance">
      <div className="rounded-xl border border-border bg-card/40 px-4 py-3">
        <h3 className="text-sm font-bold text-foreground">Manutenção Nomus</h3>
        <p className="text-xs text-muted-foreground mt-1 max-w-3xl">
          Área de análise e planejamento da integração Nomus. As ações exibidas aqui são somente
          leitura/dry-run. Nenhuma alteração é aplicada ao IndusCost.
        </p>
      </div>

      <div
        className="flex flex-wrap gap-2 border-b border-border pb-2"
        role="tablist"
        aria-label="Subáreas de manutenção Nomus"
      >
        {NOMUS_MAINTENANCE_SUBTABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeNomusMaintenanceTab === tab.id}
            onClick={() => setActiveNomusMaintenanceTab(tab.id)}
            className={cn(
              "h-9 shrink-0 rounded-lg border px-3 text-xs font-semibold transition-colors",
              activeNomusMaintenanceTab === tab.id
                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {activeNomusMaintenanceTab === "divergences" ? (
          <NomusBomBatchReportPanel onOpenProduct={onOpenProduct} />
        ) : null}
        {activeNomusMaintenanceTab === "classification" ? (
          <NomusBomClassificationPanel onOpenProduct={onOpenProduct} />
        ) : null}
        {activeNomusMaintenanceTab === "apply-plan" ? (
          <NomusBomApplyPlanPanel onOpenProduct={onOpenProduct} />
        ) : null}
      </div>
    </div>
  );
};
