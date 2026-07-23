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
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
        <CoverMetaCard label="Data-base" value={cover.reportDateLabel} />
        <CoverMetaCard label="Período" value={cover.periodLabel} />
        <CoverMetaCard label="Empresa" value={cover.companyLabel ?? "Consolidado"} />
      </div>
      <p className="text-xs text-slate-400 mt-6">
        Emitido em {formatFinanceDateTime(generatedAt)}
      </p>
    </section>
  );
}

function CoverMetaCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/25 bg-slate-950/35 p-4 shadow-none backdrop-blur-sm">
      <p className="text-slate-200 uppercase text-[10px] tracking-wider font-bold">{label}</p>
      <p className="text-lg font-semibold text-white mt-1">{value}</p>
    </div>
  );
}
