import React from "react";
import { AlertTriangle, Info } from "lucide-react";
import { cn } from "@/src/lib/utils";
import type {
  FinanceApDataQualityAlertItem,
  FinanceApDataQualityAlertKey,
} from "@/src/lib/financeAccountsPayableDashboardTypes";
import {
  formatFinanceCurrency,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsPayableFormat";
import { financeApDataQualitySeverityLabel } from "@/src/lib/financeAccountsPayableDataQuality";

function severityClass(severity: FinanceApDataQualityAlertItem["severity"]): string {
  switch (severity) {
    case "critical":
      return "border-red-200 bg-red-50/80 text-red-950";
    case "warning":
      return "border-amber-200 bg-amber-50/80 text-amber-950";
    default:
      return "border-blue-200 bg-blue-50/80 text-blue-950";
  }
}

export function FinanceAccountsPayableDataQualityPanel({
  alerts,
  onViewTitles,
}: {
  alerts: FinanceApDataQualityAlertItem[];
  onViewTitles?: (key: FinanceApDataQualityAlertKey) => void;
}) {
  if (!alerts.length) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
        Nenhum alerta de qualidade na seleção atual — dados consistentes com as regras verificadas.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card/60 p-4 space-y-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <h4 className="text-sm font-bold">Alertas de qualidade dos recebíveis</h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            Inconsistências detectadas nos dados sincronizados do Nomus (somente leitura).
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
        {alerts.map((alert) => (
          <div
            key={alert.key}
            className={cn("rounded-lg border px-3 py-2.5 space-y-1.5", severityClass(alert.severity))}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-semibold leading-snug">{alert.label}</p>
              <span className="text-[10px] font-bold uppercase shrink-0 opacity-80">
                {financeApDataQualitySeverityLabel(alert.severity)}
              </span>
            </div>
            <p className="text-lg font-bold tabular-nums">{formatFinanceInteger(alert.count)}</p>
            {alert.amount != null && alert.amount > 0 ? (
              <p className="text-xs opacity-90">
                Valor envolvido: {formatFinanceCurrency(alert.amount)}
              </p>
            ) : (
              <p className="text-xs opacity-70 flex items-center gap-1">
                <Info className="h-3 w-3" />
                Sem valor agregado aplicável
              </p>
            )}
            {onViewTitles ? (
              <button
                type="button"
                onClick={() => onViewTitles(alert.key as FinanceApDataQualityAlertKey)}
                className="text-[11px] font-semibold underline underline-offset-2 hover:opacity-80"
              >
                Ver na tabela de títulos
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
