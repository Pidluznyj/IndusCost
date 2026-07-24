import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { Download, Printer, X } from "lucide-react";
import type {
  FinanceDreLineId,
  FinanceDreReport,
  FinanceDreSourceCheck,
} from "@/src/lib/financeDreTypes";
import { FinanceDreGrid } from "@/src/components/finance/dre/FinanceDreGrid";
import { FinanceDreInformativeReport } from "@/src/components/finance/dre/FinanceDreInformativeReport";
import { formatFinanceKpiCurrency } from "@/src/lib/financeKpiFormat";
import { cn } from "@/src/lib/utils";

type Props = {
  open: boolean;
  report: FinanceDreReport;
  onClose: () => void;
  onPrint: () => void;
  onExport: () => void;
  onLineClick?: (lineId: FinanceDreLineId) => void;
  onSourceCheckClick?: (check: FinanceDreSourceCheck) => void;
};

function formatDreMarginPct(pct: number | null | undefined): string | undefined {
  if (pct == null || !Number.isFinite(pct)) return undefined;
  return `Margem ${pct.toFixed(1).replace(".", ",")}%`;
}

function KpiChip({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: "emerald" | "slate" | "rose";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3",
        // Fundo escuro no header escuro — evita label claro sobre pastel (ilegível).
        accent === "emerald" && "border-emerald-400/45 bg-emerald-950/55",
        accent === "rose" && "border-rose-400/45 bg-rose-950/55",
        (!accent || accent === "slate") && "border-white/15 bg-white/10"
      )}
    >
      <div
        className={cn(
          "text-[10px] font-semibold uppercase tracking-wide",
          accent === "emerald" && "text-emerald-100",
          accent === "rose" && "text-rose-100",
          (!accent || accent === "slate") && "text-slate-300"
        )}
      >
        {label}
      </div>
      <div
        className={cn(
          "mt-1 text-lg font-semibold tabular-nums",
          accent === "emerald" && "text-white",
          accent === "rose" && "text-white",
          (!accent || accent === "slate") && "text-white"
        )}
      >
        {value}
      </div>
      {hint ? (
        <div
          className={cn(
            "mt-1 text-xs font-medium",
            accent === "emerald" && "text-emerald-50",
            accent === "rose" && "text-rose-50",
            (!accent || accent === "slate") && "text-slate-200"
          )}
        >
          {hint}
        </div>
      ) : null}
    </div>
  );
}

export function FinanceDrePresentationModal({
  open,
  report,
  onClose,
  onPrint,
  onExport,
  onLineClick,
  onSourceCheckClick,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const ytd = report.kpis.ytd;
  const opAccent = ytd.resultadoOperacional >= 0 ? "emerald" : "rose";

  return createPortal(
    <div
      className="fixed inset-0 z-[85] flex flex-col bg-slate-950/70 backdrop-blur-[2px]"
      data-testid="finance-dre-presentation-modal"
      role="dialog"
      aria-modal="true"
      aria-label="DRE Gerencial — apresentação"
    >
      <div className="mx-auto flex h-full w-full max-w-[1680px] flex-col px-3 py-3 sm:px-5 sm:py-4">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-700/60 bg-slate-50 shadow-2xl">
          <header className="shrink-0 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-700 px-5 py-4 text-white">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-300/90">
                  Financeiro · Conselho
                </div>
                <h2 className="mt-1 text-2xl font-semibold tracking-tight">{report.title}</h2>
                <p className="mt-1 text-sm text-slate-300">{report.subtitle}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onExport}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm font-medium hover:bg-white/15"
                >
                  <Download className="h-4 w-4" />
                  CSV
                </button>
                <button
                  type="button"
                  onClick={onPrint}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm font-medium hover:bg-white/15"
                  data-testid="finance-dre-presentation-print"
                >
                  <Printer className="h-4 w-4" />
                  PDF / Imprimir
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/20 bg-white/10 hover:bg-white/15"
                  aria-label="Fechar apresentação"
                  data-testid="finance-dre-presentation-close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <KpiChip
                label="Receita bruta (YTD)"
                value={formatFinanceKpiCurrency(ytd.receitaBruta)}
              />
              <KpiChip
                label="Receita líquida (YTD)"
                value={formatFinanceKpiCurrency(ytd.receitaLiquida)}
                hint={formatDreMarginPct(ytd.receitaLiquidaPct)}
              />
              <KpiChip
                label="Lucro bruto (YTD)"
                value={formatFinanceKpiCurrency(ytd.lucroBruto)}
                hint={formatDreMarginPct(ytd.margemBrutaPct)}
                accent={ytd.lucroBruto >= 0 ? "emerald" : "rose"}
              />
              <KpiChip
                label="Resultado operacional (YTD)"
                value={formatFinanceKpiCurrency(ytd.resultadoOperacional)}
                hint={formatDreMarginPct(ytd.margemOperacionalPct)}
                accent={opAccent}
              />
              <KpiChip
                label="Lucro líquido após IRPJ e CSLL (YTD)"
                value={formatFinanceKpiCurrency(ytd.lucroLiquidoAproximado)}
                hint={formatDreMarginPct(ytd.margemLiquidaAproximadaPct)}
                accent={ytd.lucroLiquidoAproximado >= 0 ? "emerald" : "rose"}
              />
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-5 space-y-4">
            <FinanceDreGrid report={report} showAllMonths onLineClick={onLineClick} />
            <p className="text-xs leading-relaxed text-slate-500">{report.disclaimer}</p>
            {report.qualityAlerts.length > 0 ? (
              <ul className="space-y-1.5">
                {report.qualityAlerts.map((alert) => (
                  <li
                    key={alert.code}
                    className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
                  >
                    {alert.message}
                  </li>
                ))}
              </ul>
            ) : null}
            <FinanceDreInformativeReport
              report={report}
              onSourceCheckClick={onSourceCheckClick}
            />
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
