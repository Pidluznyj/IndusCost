import React, { useState } from "react";
import { cn } from "@/src/lib/utils";
import { NomusBomBatchReportPanel } from "@/src/components/product/NomusBomBatchReportPanel";
import { NomusBomClassificationPanel } from "@/src/components/product/NomusBomClassificationPanel";
import type { NomusMaintenanceWorkspaceProps } from "@/src/lib/nomusMaintenanceWorkspaceTypes";

type DiagnosticView = "comparison" | "classification";

type NomusMaintenanceDiagnosticPanelProps = NomusMaintenanceWorkspaceProps & {
  onOpenProduct?: (productId: string) => void;
  disabled?: boolean;
};

export const NomusMaintenanceDiagnosticPanel: React.FC<NomusMaintenanceDiagnosticPanelProps> = ({
  onOpenProduct,
  disabled = false,
  ...workspaceProps
}) => {
  const [view, setView] = useState<DiagnosticView>("comparison");

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-bold">Diagnóstico técnico</h4>
        <p className="text-[11px] text-muted-foreground mt-1 max-w-3xl">
          Ferramentas de auditoria e comparação detalhada Nomus x IndusCost. Use quando precisar
          investigar divergências linha a linha.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-border pb-2">
        {(
          [
            { id: "comparison" as const, label: "Comparação Nomus x IndusCost" },
            { id: "classification" as const, label: "Classificação técnica" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setView(tab.id)}
            className={cn(
              "h-8 rounded-lg border px-3 text-xs font-semibold transition-colors",
              view === tab.id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:bg-accent"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {view === "comparison" ? (
        <NomusBomBatchReportPanel onOpenProduct={onOpenProduct} disabled={disabled} {...workspaceProps} />
      ) : (
        <NomusBomClassificationPanel onOpenProduct={onOpenProduct} disabled={disabled} {...workspaceProps} />
      )}
    </div>
  );
};
