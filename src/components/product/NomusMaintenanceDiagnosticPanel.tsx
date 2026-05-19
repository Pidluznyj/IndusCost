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
      <p className="text-sm text-muted-foreground">
        Listagem técnica de todos os produtos no stage Nomus. Selecione um produto no topo para ver o
        diagnóstico aberto daquele SKU.
      </p>
      <NomusBomBatchReportPanel onOpenProduct={onOpenProduct} disabled={disabled} {...workspaceProps} />
      <NomusBomClassificationPanel onOpenProduct={onOpenProduct} disabled={disabled} {...workspaceProps} />
    </div>
  );
};
