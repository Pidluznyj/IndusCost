import React from "react";
import type { CustomerIntelligenceReport } from "@/src/lib/customerIntelligenceTypes";

export function CustomerIntelligenceProfileTab({ report }: { report: CustomerIntelligenceReport }) {
  const { customer, profileFields } = report;

  return (
    <div className="customer-intelligence-tab-panel space-y-5">
      <section className="rounded-xl border border-border bg-card p-4 space-y-1">
        <h2 className="text-sm font-bold">Origem dos dados cadastrais</h2>
        <p className="text-sm text-muted-foreground">
          {customer.isNomusSynced
            ? "Cliente sincronizado do Nomus. Campos abaixo indicam a fonte de cada informação."
            : "Cliente cadastrado localmente no IndusCost."}
        </p>
        {customer.registrationHeaderLabel ? (
          <p className="text-xs text-muted-foreground mt-2">
            {customer.registrationHeaderLabel}
            {customer.registrationSourceLabel ? ` · Fonte: ${customer.registrationSourceLabel}` : null}
          </p>
        ) : null}
      </section>

      <section className="rounded-xl border border-border bg-card overflow-x-auto">
        <table className="w-full text-sm border-collapse min-w-[28rem]">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 px-4 font-semibold">Campo</th>
              <th className="py-2 px-4 font-semibold">Valor</th>
              <th className="py-2 px-4 font-semibold">Fonte</th>
            </tr>
          </thead>
          <tbody>
            {profileFields.map((field) => (
              <tr key={field.id} className="border-b border-border/60 last:border-0">
                <td className="py-2 px-4 font-medium whitespace-nowrap">{field.label}</td>
                <td className="py-2 px-4">{field.displayValue}</td>
                <td className="py-2 px-4 text-muted-foreground whitespace-nowrap">
                  {field.sourceLabel}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
