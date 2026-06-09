import React from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import {
  financeBiCardClass,
  financeBiKpiLabelClass,
  financeBiKpiValueClass,
} from "@/src/lib/financeBiDashboardTheme";
import { FinanceBiCalcTooltip } from "@/src/components/finance/bi/FinanceBiCalcTooltip";
import { cn } from "@/src/lib/utils";

export function FinanceBiKpiCard({
  icon: Icon,
  label,
  value,
  sub,
  hint,
  scopeNote,
  trend,
  trendLabel,
  colorClass = "text-[#111827]",
  loading = false,
}: {
  icon?: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  hint?: string;
  scopeNote?: string;
  trend?: "up" | "down" | "neutral";
  trendLabel?: string;
  colorClass?: string;
  loading?: boolean;
}) {
  return (
    <div className={cn(financeBiCardClass, "p-5 space-y-3")}>
      <div className="flex items-center justify-between gap-2">
        <span className={cn(financeBiKpiLabelClass, "flex items-center gap-1.5")}>
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
        <p className={cn(financeBiKpiValueClass, colorClass)}>{value}</p>
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
