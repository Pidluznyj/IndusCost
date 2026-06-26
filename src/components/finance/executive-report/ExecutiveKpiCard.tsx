import React from "react";
import { FinanceBiKpiCard } from "@/src/components/finance/bi/FinanceBiKpiCard";
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
  /** Texto explicativo — exibido no tooltip de cálculo */
  hint?: string;
  /** Alias de hint para compatibilidade */
  tooltip?: string;
  className?: string;
  accent?: boolean;
  highlight?: boolean;
  tone?: "default" | "positive" | "negative" | "neutral";
}) {
  const calcHint = hint ?? tooltip;

  return (
    <FinanceBiKpiCard
      label={label}
      value={value}
      valueTitle={value}
      sub={sub}
      hint={calcHint}
      colorClass={TONE_COLOR_CLASS[tone]}
      labelClassName="normal-case tracking-normal font-semibold text-[11px]"
      valueClassName="text-xl font-semibold sm:text-2xl"
      className={cn(
        "finance-executive-kpi-card",
        accent && "border-[#2563EB]/35 bg-[#2563EB]/[0.03]",
        highlight && "ring-1 ring-[#111827]/10",
        tone === "positive" && !accent && "border-[#059669]/25",
        tone === "negative" && !accent && "border-[#DC2626]/25",
        className
      )}
    />
  );
}
