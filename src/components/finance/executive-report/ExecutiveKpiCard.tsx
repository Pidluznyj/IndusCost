import React from "react";
import { MetricCard } from "@/src/components/ui/MetricCard";
import { FinanceBiCalcTooltip } from "@/src/components/finance/bi/FinanceBiCalcTooltip";
import { financeColorClassToVariant } from "@/src/lib/financeKpiMetricVariant";
import { cn } from "@/src/lib/utils";

const TONE_COLOR_CLASS = {
  default: "text-[#111827]",
  neutral: "text-[#111827]",
  positive: "text-[#059669]",
  negative: "text-[#DC2626]",
} as const;

export function ExecutiveKpiCard({
  label,
  value,
  sub,
  hint,
  tooltip,
  className,
  accent,
  highlight,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  hint?: string;
  tooltip?: string;
  className?: string;
  accent?: boolean;
  highlight?: boolean;
  tone?: "default" | "positive" | "negative" | "neutral";
}) {
  const calcHint = hint ?? tooltip;
  const colorClass = TONE_COLOR_CLASS[tone];

  return (
    <MetricCard
      label={label}
      formattedValue={value}
      fullValue={value}
      subtitle={sub}
      variant={financeColorClassToVariant(colorClass)}
      labelAccessory={calcHint ? <FinanceBiCalcTooltip rule={calcHint} /> : undefined}
      className={cn(
        "finance-executive-kpi-card executive-kpi-card",
        accent && "border-[#2563EB]/35 bg-[#2563EB]/[0.03]",
        highlight && "ring-1 ring-[#111827]/10",
        tone === "positive" && !accent && "border-[#059669]/25",
        tone === "negative" && !accent && "border-[#DC2626]/25",
        className
      )}
    />
  );
}
