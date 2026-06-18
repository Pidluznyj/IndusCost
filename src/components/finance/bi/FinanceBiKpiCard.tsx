import React from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import {
  financeBiCardClass,
  financeBiKpiLabelClass,
  financeBiKpiValueClass,
} from "@/src/lib/financeBiDashboardTheme";
import { FinanceBiCalcTooltip } from "@/src/components/finance/bi/FinanceBiCalcTooltip";
import {
  formatKpiCompactCurrency,
  formatKpiCompactNumber,
  formatKpiCompactPercent,
  formatKpiDisplayValue,
} from "@/src/lib/kpiDisplayFormat";
import { cn } from "@/src/lib/utils";
import "@/src/styles/indus-kpi-grid.css";

export function FinanceBiKpiCard({
  icon: Icon,
  label,
  value,
  valueTitle,
  amount,
  amountFormat,
  sub,
  hint,
  scopeNote,
  trend,
  trendLabel,
  colorClass = "text-[#111827]",
  valueClassName,
  labelClassName,
  loading = false,
}: {
  icon?: React.ElementType;
  label: string;
  value: string;
  /** Title/tooltip com valor completo quando o display está compacto. */
  valueTitle?: string | null;
  /** Quando informado, formata valor + title automaticamente (sem alterar cálculo). */
  amount?: number | null;
  amountFormat?: "currency" | "number" | "percent";
  sub?: string;
  hint?: string;
  scopeNote?: string;
  trend?: "up" | "down" | "neutral";
  trendLabel?: string;
  colorClass?: string;
  valueClassName?: string;
  labelClassName?: string;
  loading?: boolean;
}) {
  let displayValue = value;
  let displayTitle = valueTitle ?? undefined;

  if (!loading && amount != null && amountFormat) {
    const formatted =
      amountFormat === "currency"
        ? formatKpiCompactCurrency(amount)
        : amountFormat === "percent"
          ? formatKpiCompactPercent(amount)
          : formatKpiCompactNumber(amount);
    const display = formatKpiDisplayValue(formatted, label);
    displayValue = display.value;
    displayTitle = display.valueTitle ?? displayTitle;
  }

  return (
    <div
      className={cn(
        financeBiCardClass,
        "indus-kpi-card commercial-kpi-card p-5 space-y-3 min-h-[9.5rem]"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className={cn(
            financeBiKpiLabelClass,
            "flex items-center gap-1.5 leading-snug",
            labelClassName
          )}
        >
          {label}
          {hint ? <FinanceBiCalcTooltip rule={hint} /> : null}
        </span>
        {Icon ? (
          <span className="h-9 w-9 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] flex items-center justify-center shrink-0">
            <Icon className={cn("h-4 w-4", colorClass)} />
          </span>
        ) : null}
      </div>
      {scopeNote ? (
        <p className="text-[10px] text-[#6B7280] leading-snug">{scopeNote}</p>
      ) : null}
      {loading ? (
        <div className="h-8 w-32 animate-pulse rounded-lg bg-[#E5E7EB]" />
      ) : (
        <p
          className={cn(
            financeBiKpiValueClass,
            "indus-kpi-value commercial-kpi-value tabular-nums",
            colorClass,
            valueClassName
          )}
          title={displayTitle}
        >
          {displayValue}
        </p>
      )}
      <div className="flex items-center justify-between min-h-[1.25rem] gap-2">
        {sub ? <span className="text-[11px] text-[#6B7280]">{sub}</span> : <span />}
        {trend && trendLabel ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold shrink-0",
              trend === "up"
                ? "bg-red-50 text-[#DC2626]"
                : trend === "down"
                  ? "bg-green-50 text-[#059669]"
                  : "bg-[#F3F4F6] text-[#6B7280]"
            )}
          >
            {trend === "up" ? (
              <TrendingUp className="h-2.5 w-2.5" />
            ) : trend === "down" ? (
              <TrendingDown className="h-2.5 w-2.5" />
            ) : null}
            {trendLabel}
          </span>
        ) : null}
      </div>
    </div>
  );
}
