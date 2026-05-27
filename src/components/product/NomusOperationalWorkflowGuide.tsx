import React from "react";
import { ListOrdered } from "lucide-react";
import { NOMUS_OPERATIONAL_WORKFLOW_STEPS } from "@/src/lib/nomusMaintenanceStepCopy";

export const NomusOperationalWorkflowGuide: React.FC = () => (
  <div className="rounded-xl border border-sky-200 bg-sky-50/80 dark:bg-sky-950/30 p-3 space-y-2">
    <p className="text-xs font-bold text-sky-950 dark:text-sky-100 flex items-center gap-1.5">
      <ListOrdered className="h-3.5 w-3.5" />
      Fluxo operacional recomendado
    </p>
    <ol className="list-decimal list-inside text-[11px] text-sky-900/90 dark:text-sky-100/90 space-y-1 leading-relaxed">
      {NOMUS_OPERATIONAL_WORKFLOW_STEPS.map((step) => (
        <li key={step}>{step}</li>
      ))}
    </ol>
  </div>
);
