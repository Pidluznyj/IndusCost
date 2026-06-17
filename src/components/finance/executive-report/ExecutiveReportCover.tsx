import React from "react";
import type { FinanceExecutiveReportCover } from "@/src/lib/financeExecutiveReportTypes";
import { formatFinanceDateTime } from "@/src/lib/financeAccountsReceivableFormat";

export function ExecutiveReportCover({
  cover,
  generatedAt,
}: {
  cover: FinanceExecutiveReportCover;
  generatedAt: string;
}) {
  return (
    <section className="finance-executive-report-cover" data-testid="executive-report-cover">
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-300">
        IndusCost + Nomus
      </p>
      <h1 className="text-4xl md:text-5xl font-bold tracking-tight">{cover.title}</h1>
      <p className="text-lg text-slate-200">{cover.subtitle}</p>
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
        <div>
          <p className="text-slate-400 uppercase text-[10px] tracking-wider font-semibold">
            Data-base
          </p>
          <p className="text-lg font-semibold">{cover.reportDateLabel}</p>
        </div>
        <div>
          <p className="text-slate-400 uppercase text-[10px] tracking-wider font-semibold">
            Período
          </p>
          <p className="text-lg font-semibold">{cover.periodLabel}</p>
        </div>
        <div>
          <p className="text-slate-400 uppercase text-[10px] tracking-wider font-semibold">
            Empresa
          </p>
          <p className="text-lg font-semibold">{cover.companyLabel ?? "Consolidado"}</p>
        </div>
      </div>
      <p className="text-xs text-slate-400 mt-6">
        Emitido em {formatFinanceDateTime(generatedAt)}
      </p>
    </section>
  );
}
