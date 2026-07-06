import React from "react";
import { ListOrdered } from "lucide-react";
import { NOMUS_OPERATIONAL_WORKFLOW_STEPS } from "@/src/lib/nomusMaintenanceStepCopy";

export const NomusOperationalWorkflowGuide: React.FC = () => (
  <section
    className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-4 shadow-sm"
    aria-labelledby="nomus-operational-workflow-title"
  >
    <header className="space-y-1">
      <h3
        id="nomus-operational-workflow-title"
        className="text-sm font-semibold text-foreground flex items-center gap-2"
      >
        <ListOrdered className="h-4 w-4 text-primary shrink-0" aria-hidden />
        Fluxo operacional recomendado
      </h3>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Use este roteiro para tratar produtos bloqueados após a sincronização Nomus.
      </p>
    </header>

    <ol className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 list-none m-0 p-0">
      {NOMUS_OPERATIONAL_WORKFLOW_STEPS.map((step, index) => (
        <li
          key={step.title}
          className="flex gap-3 rounded-lg border border-border bg-background p-3 sm:p-3.5 min-h-[5.5rem]"
        >
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-bold tabular-nums"
            aria-hidden
          >
            {index + 1}
          </span>
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-semibold text-foreground leading-snug">{step.title}</p>
            <p className="text-sm text-muted-foreground leading-relaxed">{step.description}</p>
          </div>
        </li>
      ))}
    </ol>
  </section>
);
