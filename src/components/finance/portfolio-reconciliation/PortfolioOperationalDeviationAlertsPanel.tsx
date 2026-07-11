import React from "react";
import { AlertTriangle, Info, OctagonAlert } from "lucide-react";
import { cn } from "@/src/lib/utils";

export type OperationalDeviationAlertDto = {
  code: string;
  severity: string;
  title: string;
  message: string;
  actionRecommendation: string;
  affectedValue: number | null;
  affectedItems: string[];
  evidenceSource: string;
};

const SEVERITY_STYLE: Record<
  string,
  { box: string; icon: typeof Info; label: string }
> = {
  INFO: {
    box: "border-[#B2DDFF] bg-[#EFF8FF] text-[#175CD3]",
    icon: Info,
    label: "Info",
  },
  WARNING: {
    box: "border-[#FEDF89] bg-[#FFFAEB] text-[#B54708]",
    icon: AlertTriangle,
    label: "Atenção",
  },
  CRITICAL: {
    box: "border-[#FECDCA] bg-[#FEF3F2] text-[#B42318]",
    icon: OctagonAlert,
    label: "Crítico",
  },
};

function severityStyle(severity: string) {
  return SEVERITY_STYLE[severity.toUpperCase()] ?? SEVERITY_STYLE.WARNING!;
}

/**
 * Lista de alertas operacionais de desvio (somente exibição da API).
 */
export function PortfolioOperationalDeviationAlertsPanel({
  alerts,
  compactSummary = false,
}: {
  alerts: OperationalDeviationAlertDto[] | null | undefined;
  /** Resumo compacto no topo do drawer. */
  compactSummary?: boolean;
}) {
  const list = alerts ?? [];

  if (compactSummary) {
    if (list.length === 0) return null;
    return (
      <div
        className="flex flex-wrap gap-1.5"
        data-testid="portfolio-intelligence-drawer-alerts-summary"
      >
        {list.slice(0, 6).map((a) => {
          const style = severityStyle(a.severity);
          return (
            <span
              key={a.code}
              className={cn(
                "inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold",
                style.box
              )}
              title={a.message}
            >
              <style.icon className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">{a.title}</span>
            </span>
          );
        })}
        {list.length > 6 ? (
          <span className="text-[11px] font-semibold text-[#667085]">
            +{list.length - 6} alerta(s)
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="space-y-2"
      data-testid="portfolio-intelligence-drawer-operational-alerts"
    >
      <h3 className="text-[16px] font-bold text-[#101828]">Alertas operacionais</h3>
      {list.length === 0 ? (
        <p
          className="rounded-[12px] border border-dashed border-[#EAECF0] bg-[#F9FAFB] px-3 py-4 text-center text-sm text-[#667085]"
          data-testid="portfolio-intelligence-drawer-operational-alerts-empty"
        >
          Nenhum alerta operacional encontrado com os dados atuais.
        </p>
      ) : (
        <ul className="space-y-2">
          {list.map((a) => {
            const style = severityStyle(a.severity);
            const Icon = style.icon;
            return (
              <li
                key={a.code}
                className={cn(
                  "rounded-[12px] border p-3 sm:p-4",
                  style.box
                )}
                data-severity={a.severity.toUpperCase()}
                data-testid={`portfolio-operational-alert-${a.code}`}
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/70">
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[13px] font-bold leading-snug">{a.title}</p>
                      <span className="rounded border border-current/20 bg-white/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                        {style.label}
                      </span>
                    </div>
                    <p className="text-[13px] leading-relaxed opacity-95">{a.message}</p>
                    <p className="text-[12px] font-semibold leading-snug">
                      Ação: {a.actionRecommendation}
                    </p>
                    <p className="text-[11px] opacity-80">
                      Fonte / evidência: {a.evidenceSource}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
