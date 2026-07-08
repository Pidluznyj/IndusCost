import React from "react";
import {
  SYSTEM_TOTALIZER_GRID_CLASS,
  SYSTEM_TOTALIZER_METRIC_CARD_CLASS,
  SystemTotalizerCard,
  type SystemTotalizerTone,
} from "@/src/components/ui/SystemTotalizerCard";
import { FinanceBiCalcTooltip } from "@/src/components/finance/bi/FinanceBiCalcTooltip";
import { cn } from "@/src/lib/utils";

const EXECUTIVE_TONE: Record<string, SystemTotalizerTone> = {
  default: "neutral",
  neutral: "neutral",
  positive: "success",
  negative: "danger",
};

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

  return (
    <SystemTotalizerCard
      label={label}
      value={value}
      valueTitle={value}
      subtitle={sub}
      tone={EXECUTIVE_TONE[tone] ?? "neutral"}
      labelAccessory={calcHint ? <FinanceBiCalcTooltip rule={calcHint} /> : undefined}
      className={cn(
        SYSTEM_TOTALIZER_METRIC_CARD_CLASS,
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
