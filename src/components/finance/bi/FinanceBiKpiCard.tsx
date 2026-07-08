import React from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { MetricCard } from "@/src/components/ui/MetricCard";
import { FinanceBiCalcTooltip } from "@/src/components/finance/bi/FinanceBiCalcTooltip";
import {
  formatKpiCompactCurrency,
  formatKpiCompactNumber,
  formatKpiCompactPercent,
  formatKpiDisplayValue,
} from "@/src/lib/kpiDisplayFormat";
import { financeColorClassToVariant } from "@/src/lib/financeKpiMetricVariant";
import { cn } from "@/src/lib/utils";

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
  className,
  loading = false,
  compact = false,
}: {
  icon?: React.ElementType;
  label: string;
  value: string;
  valueTitle?: string | null;
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
  className?: string;
  loading?: boolean;
}) {
  let displayValue = value;
  let displayTitle = valueTitle ?? undefined;

  const usesStructuredAmount = !loading && amount != null && amountFormat != null;

  if (usesStructuredAmount) {
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

  const subtitleParts = [scopeNote, sub].filter(Boolean);
  const subtitle = subtitleParts.length > 0 ? subtitleParts.join(" · ") : undefined;

  const trendFooter =
    trend && trendLabel ? (
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
    ) : null;

  return (
    <MetricCard
      label={label}
      value={displayValue}
      formattedValue={displayValue}
      fullValue={displayTitle}
      subtitle={subtitle}
      variant={financeColorClassToVariant(colorClass)}
      icon={Icon ? <Icon className="h-3.5 w-3.5" /> : undefined}
      labelAccessory={hint ? <FinanceBiCalcTooltip rule={hint} /> : undefined}
      footer={trendFooter}
      loading={loading}
      compact={compact}
      className={cn(labelClassName, valueClassName, className)}
    />
  );
}
