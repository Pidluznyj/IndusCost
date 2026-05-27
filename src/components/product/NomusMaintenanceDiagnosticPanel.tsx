import React from "react";
import { NomusBomBatchReportPanel } from "@/src/components/product/NomusBomBatchReportPanel";
import { NomusBomClassificationPanel } from "@/src/components/product/NomusBomClassificationPanel";
import { NomusMaintenanceProductDiagnosticView } from "@/src/components/product/NomusMaintenanceProductDiagnosticView";
import { NomusMaintenanceStepHeader } from "@/src/components/product/NomusMaintenanceStepHeader";
import type { NomusMaintenanceWorkspaceProps } from "@/src/lib/nomusMaintenanceWorkspaceTypes";

type NomusMaintenanceDiagnosticPanelProps = NomusMaintenanceWorkspaceProps & {
  onOpenProduct?: (productId: string) => void;
  disabled?: boolean;
};

export const NomusMaintenanceDiagnosticPanel: React.FC<NomusMaintenanceDiagnosticPanelProps> = ({
  onOpenProduct,
  disabled = false,
  selectedParentCode,
  ...workspaceProps
}) => {
  const hasProduct = Boolean(selectedParentCode?.trim());

  if (hasProduct) {
    return (
      <div className="space-y-4">
        <NomusMaintenanceStepHeader tab="diagnostic" />
        <p className="text-xs text-muted-foreground rounded-lg border border-border bg-muted/30 px-3 py-2">
          Suporte técnico para este SKU. Não é etapa obrigatória do fluxo operacional — use a Central
          Engenharia e as abas Pendências / Plano no dia a dia.
        </p>
        <NomusMaintenanceProductDiagnosticView
          selectedParentCode={selectedParentCode}
          disabled={disabled}
          {...workspaceProps}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <NomusMaintenanceStepHeader tab="diagnostic" />
      <p className="text-xs text-muted-foreground rounded-lg border border-amber-200/80 bg-amber-50/50 px-3 py-2">
        <strong>Suporte técnico.</strong> Use esta aba apenas para investigação ou auditoria. Para
        operação diária (bloqueados, pendências, apply), use a Visão Geral e a Central Engenharia
        Nomus.
      </p>
      <p className="text-sm text-muted-foreground">
        Listagem técnica de todos os produtos no stage Nomus. Selecione um produto no topo para ver o
        diagnóstico aberto daquele SKU.
      </p>
      <NomusBomBatchReportPanel onOpenProduct={onOpenProduct} disabled={disabled} {...workspaceProps} />
      <NomusBomClassificationPanel onOpenProduct={onOpenProduct} disabled={disabled} {...workspaceProps} />
    </div>
  );
};
