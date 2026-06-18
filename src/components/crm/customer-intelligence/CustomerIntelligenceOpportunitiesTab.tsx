import React from "react";
import { Target } from "lucide-react";
import { cn } from "@/src/lib/utils";
import type { CustomerIntelligenceReport } from "@/src/lib/customerIntelligenceTypes";
import { CustomerIntelligenceSignals } from "./CustomerIntelligenceSignals";

function opportunityTone(type: CustomerIntelligenceReport["opportunities"][number]["type"]): string {
  if (type === "RISK") return "border-red-200 bg-red-50/60";
  if (type === "OPPORTUNITY") return "border-emerald-200 bg-emerald-50/60";
  return "border-border bg-muted/15";
}

export function CustomerIntelligenceOpportunitiesTab({
  report,
}: {
  report: CustomerIntelligenceReport;
}) {
  const { opportunities } = report;

  return (
    <div className="customer-intelligence-tab-panel space-y-4">
      <CustomerIntelligenceSignals report={report} />

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-bold flex items-center gap-2 mb-3">
          <Target className="h-4 w-4 text-primary" />
          Oportunidades e ações sugeridas
        </h2>

        {opportunities.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma oportunidade identificada com evidência suficiente no filtro atual.
          </p>
        ) : (
          <ol className="space-y-3">
            {opportunities.map((item, idx) => (
              <li
                key={`${item.kind}-${item.title}-${idx}`}
                className={cn("rounded-xl border p-4", opportunityTone(item.type))}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {item.kind.replace(/_/g, " ")} · {item.severity}
                    </p>
                    <h3 className="text-sm font-bold mt-0.5">{item.title}</h3>
                  </div>
                  <span className="text-xs font-bold tabular-nums rounded-full bg-background/80 border border-border px-2 py-0.5">
                    Prioridade {item.priorityScore}
                  </span>
                </div>
                <p className="text-sm mt-2">{item.description}</p>
                <p className="text-sm font-semibold mt-2">Ação sugerida: {item.suggestedAction}</p>
                {item.relatedProduct ? (
                  <p className="text-xs text-muted-foreground mt-1">
                    Produto: {item.relatedProduct.sku} — {item.relatedProduct.name}
                  </p>
                ) : null}
                {item.evidence.length > 0 ? (
                  <ul className="mt-2 text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
                    {item.evidence.map((line, eidx) => (
                      <li key={eidx}>{line}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
