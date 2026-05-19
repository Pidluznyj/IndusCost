import React from "react";
import type { NomusMaintenanceTab } from "@/src/lib/nomusMaintenanceWorkspaceTypes";
import { NOMUS_MAINTENANCE_STEP_COPY } from "@/src/lib/nomusMaintenanceStepCopy";

type NomusMaintenanceStepHeaderProps = {
  tab: NomusMaintenanceTab;
};

export const NomusMaintenanceStepHeader: React.FC<NomusMaintenanceStepHeaderProps> = ({ tab }) => {
  const step = NOMUS_MAINTENANCE_STEP_COPY[tab];
  return (
    <div className="rounded-xl border border-border/80 bg-muted/20 px-4 py-3 space-y-2">
      <h4 className="text-lg font-bold text-foreground">{step.title}</h4>
      <p className="text-sm text-muted-foreground leading-relaxed max-w-3xl">{step.description}</p>
      <div className="grid gap-2 sm:grid-cols-2 text-sm">
        <p>
          <span className="font-semibold text-foreground">O que observar: </span>
          <span className="text-muted-foreground">{step.observe}</span>
        </p>
        <p>
          <span className="font-semibold text-foreground">Próximo passo: </span>
          <span className="text-muted-foreground">{step.nextStep}</span>
        </p>
      </div>
    </div>
  );
};
