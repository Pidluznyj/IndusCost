import React from "react";
import { formatCurrency } from "@/src/lib/utils";
import type { CustomerIntelligenceReport } from "@/src/lib/customerIntelligenceTypes";
import { CustomerIntelligenceAlerts } from "./CustomerIntelligenceHeader";
import { CustomerIntelligenceKpiGrid } from "./CustomerIntelligenceKpiGrid";

export function CustomerIntelligenceOverviewTab({ report }: { report: CustomerIntelligenceReport }) {
  const narrative = report.executiveNarrative;
  const leading = report.commercialSummary.leadingProduct;

  return (
    <div className="space-y-5">
      <CustomerIntelligenceKpiGrid report={report} />
      <CustomerIntelligenceAlerts report={report} />

      {narrative.length > 0 ? (
        <section className="rounded-xl border border-border bg-card p-4 space-y-2">
          <h2 className="text-sm font-bold">Resumo executivo</h2>
          <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
            {narrative.map((line, idx) => (
              <li key={idx}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {leading ? (
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-bold">Produto líder (receita no filtro)</h2>
          <p className="text-sm mt-1">
            {leading.sku} — {leading.name}: {formatCurrency(leading.revenue)}
          </p>
        </section>
      ) : null}

      {report.history.strongestMonths.length > 0 ? (
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-bold">Meses mais fortes</h2>
          <ul className="mt-2 text-sm space-y-1">
            {report.history.strongestMonths.slice(0, 5).map((m) => (
              <li key={m.month}>
                {m.monthName}: {formatCurrency(m.totalRevenue)} ({m.ordersCount} pedido(s))
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
