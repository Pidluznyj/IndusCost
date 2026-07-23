import React from "react";
import type { FinanceDreReport } from "@/src/lib/financeDreTypes";
import { formatFinanceKpiCurrency } from "@/src/lib/financeKpiFormat";
import { cn } from "@/src/lib/utils";

type Props = {
  report: FinanceDreReport;
  className?: string;
};

function statusBadge(status: "ok" | "gap" | "info") {
  if (status === "ok") {
    return "bg-emerald-50 text-emerald-800 border-emerald-200";
  }
  if (status === "gap") {
    return "bg-amber-50 text-amber-900 border-amber-200";
  }
  return "bg-slate-100 text-slate-700 border-slate-200";
}

export function FinanceDreInformativeReport({ report, className }: Props) {
  const { sourceChecks, informativeReport } = report;

  return (
    <div className={cn("space-y-4", className)} data-testid="finance-dre-informative-report">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">Validação das fontes oficiais</h3>
        <p className="mt-1 text-xs text-slate-500">
          Confirma de onde cada bloco do DRE está puxando dados e se entra no resultado.
        </p>
        <div className="mt-3 space-y-2">
          {sourceChecks.map((check) => (
            <div
              key={check.id}
              className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-slate-150 bg-slate-50/60 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-slate-800">{check.label}</div>
                <div className="text-[11px] text-slate-500">{check.officialMotor}</div>
                <div className="mt-0.5 text-xs text-slate-600">{check.note}</div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase",
                    statusBadge(check.status)
                  )}
                >
                  {check.status === "ok" ? "OK" : check.status === "gap" ? "Atenção" : "Info"}
                </span>
                <span className="text-[10px] text-slate-500">
                  {check.appliedToResult ? "Entra no resultado" : "Não entra no resultado"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-amber-950">{informativeReport.title}</h3>
            <p className="mt-1 max-w-3xl text-xs text-amber-900/80">
              {informativeReport.subtitle}
            </p>
          </div>
          <div className="text-right text-xs text-amber-900">
            <div>
              Não aplicados (mês):{" "}
              <span className="font-semibold tabular-nums">
                {formatFinanceKpiCurrency(informativeReport.totalNotAppliedHighlight)}
              </span>
            </div>
            <div>
              Não aplicados (YTD):{" "}
              <span className="font-semibold tabular-nums">
                {formatFinanceKpiCurrency(informativeReport.totalNotAppliedYtd)}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-3 overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-amber-200 text-left text-[11px] uppercase text-amber-900/70">
                <th className="py-2 pr-3">Item</th>
                <th className="py-2 pr-3">Motivo</th>
                <th className="py-2 pr-3">Fonte</th>
                <th className="py-2 pr-3 text-right">Mês</th>
                <th className="py-2 text-right">YTD</th>
              </tr>
            </thead>
            <tbody>
              {informativeReport.items.map((item) => (
                <tr key={item.id} className="border-b border-amber-100/80 align-top">
                  <td className="py-2.5 pr-3">
                    <div className="font-medium text-slate-800">{item.label}</div>
                    <div className="text-[10px] text-slate-500">
                      {item.appliedToResult
                        ? "Provisório — entra no resultado"
                        : "Informativo — fora do resultado"}
                      {item.count != null ? ` · ${item.count} registro(s)` : ""}
                    </div>
                  </td>
                  <td className="max-w-[280px] py-2.5 pr-3 text-xs text-slate-600">
                    {item.reason}
                  </td>
                  <td className="py-2.5 pr-3 text-xs text-slate-500">{item.source}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-slate-800">
                    {formatFinanceKpiCurrency(item.highlightAmount)}
                  </td>
                  <td className="py-2.5 text-right tabular-nums text-slate-800">
                    {formatFinanceKpiCurrency(item.ytdAmount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
