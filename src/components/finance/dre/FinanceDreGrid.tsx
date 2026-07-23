import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { FinanceDreLine, FinanceDreReport } from "@/src/lib/financeDreTypes";
import { formatFinanceKpiCurrency } from "@/src/lib/financeKpiFormat";
import { cn } from "@/src/lib/utils";

type Props = {
  report: FinanceDreReport;
  /** Exibe as 12 colunas mensais (modal de apresentação). */
  showAllMonths?: boolean;
  className?: string;
};

function moneyClass(value: number, kind: FinanceDreLine["kind"]): string {
  if (kind === "result") {
    return value >= 0 ? "text-emerald-800 font-semibold" : "text-rose-700 font-semibold";
  }
  if (value < 0) return "text-slate-600";
  if (kind === "informative") return "text-slate-500 italic";
  return "text-slate-800";
}

function rowBg(line: FinanceDreLine, expandedParent: boolean): string {
  if (line.kind === "result") return "bg-slate-100/90";
  if (line.kind === "total") return "bg-slate-50/80";
  if (line.kind === "informative") return "bg-amber-50/40";
  if (line.kind === "detail" && expandedParent) return "bg-white";
  return "bg-white";
}

export function FinanceDreGrid({ report, showAllMonths = false, className }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    receita_bruta: true,
    deducoes: false,
    custos: true,
    despesas_operacionais: true,
  });

  const visibleLines = useMemo(() => {
    return report.lines.filter((line) => {
      if (!line.parentId) return true;
      return Boolean(expanded[line.parentId]);
    });
  }, [report.lines, expanded]);

  const highlightIdx = report.filters.highlightMonth - 1;

  return (
    <div
      className={cn(
        "overflow-auto rounded-xl border border-slate-200/80 bg-white shadow-sm",
        className
      )}
      data-testid="finance-dre-grid"
    >
      <table className="min-w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-slate-900 text-white">
          <tr>
            <th className="sticky left-0 z-20 min-w-[240px] bg-slate-900 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide">
              Linha
            </th>
            {showAllMonths
              ? report.monthLabels.map((label, idx) => (
                  <th
                    key={label}
                    className={cn(
                      "min-w-[88px] px-2 py-3 text-right text-[11px] font-semibold uppercase tracking-wide",
                      idx === highlightIdx && "bg-sky-800"
                    )}
                  >
                    {label}
                  </th>
                ))
              : null}
            <th className="min-w-[104px] px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wide">
              {showAllMonths ? "YTD" : report.monthLabels[highlightIdx] ?? "Mês"}
            </th>
            {showAllMonths ? null : (
              <th className="min-w-[104px] px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wide">
                YTD
              </th>
            )}
            <th className="min-w-[72px] px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wide">
              % RL
            </th>
          </tr>
        </thead>
        <tbody>
          {visibleLines.map((line) => {
            const isExpandable = line.expandable && line.kind === "total";
            const isOpen = Boolean(expanded[line.id]);
            const indent = line.parentId ? "pl-8" : "pl-4";
            return (
              <tr
                key={line.id}
                className={cn(
                  "border-b border-slate-100/90 transition-colors",
                  rowBg(line, true),
                  line.kind === "result" && "border-slate-200"
                )}
                data-testid={`finance-dre-line-${line.id}`}
              >
                <td
                  className={cn(
                    "sticky left-0 z-[1] px-0 py-2.5",
                    rowBg(line, true),
                    indent
                  )}
                >
                  <div className="flex items-center gap-1.5 pr-3">
                    {isExpandable ? (
                      <button
                        type="button"
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-500 hover:bg-slate-200/70"
                        aria-expanded={isOpen}
                        onClick={() =>
                          setExpanded((prev) => ({ ...prev, [line.id]: !prev[line.id] }))
                        }
                      >
                        {isOpen ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                      </button>
                    ) : (
                      <span className="inline-block w-6" />
                    )}
                    <div className="min-w-0">
                      <div
                        className={cn(
                          "truncate",
                          line.kind === "result" || line.kind === "total"
                            ? "font-semibold text-slate-900"
                            : "font-medium text-slate-700",
                          line.informativeOnly && "italic text-slate-500"
                        )}
                      >
                        {line.label}
                      </div>
                      {line.informativeOnly ? (
                        <div className="text-[10px] text-amber-700/80">Não entra no resultado</div>
                      ) : null}
                    </div>
                  </div>
                </td>
                {showAllMonths
                  ? line.values.byMonth.map((value, idx) => (
                      <td
                        key={`${line.id}-${idx}`}
                        className={cn(
                          "px-2 py-2.5 text-right tabular-nums",
                          moneyClass(value, line.kind),
                          idx === highlightIdx && "bg-sky-50/80"
                        )}
                      >
                        {formatFinanceKpiCurrency(value)}
                      </td>
                    ))
                  : null}
                <td
                  className={cn(
                    "px-3 py-2.5 text-right tabular-nums",
                    moneyClass(
                      showAllMonths ? line.values.ytd : line.values.highlight,
                      line.kind
                    ),
                    !showAllMonths && "bg-sky-50/50"
                  )}
                >
                  {formatFinanceKpiCurrency(
                    showAllMonths ? line.values.ytd : line.values.highlight
                  )}
                </td>
                {showAllMonths ? null : (
                  <td
                    className={cn(
                      "px-3 py-2.5 text-right tabular-nums",
                      moneyClass(line.values.ytd, line.kind)
                    )}
                  >
                    {formatFinanceKpiCurrency(line.values.ytd)}
                  </td>
                )}
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">
                  {line.pctOfNetRevenue == null
                    ? "—"
                    : `${line.pctOfNetRevenue.toFixed(1).replace(".", ",")}%`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
