import React from "react";
import type { LucideIcon } from "lucide-react";
import { MetricCard, type MetricCardVariant } from "@/src/components/ui/MetricCard";
import { FinanceBiCalcTooltip } from "@/src/components/finance/bi/FinanceBiCalcTooltip";
import { formatCashFlowKpiDisplay } from "@/src/lib/financeCashFlowDisplay";
import { cn } from "@/src/lib/utils";

export type FinanceCashFlowMetricTone = "positive" | "negative" | "warning" | "neutral" | "info";

const TONE_VARIANT: Record<FinanceCashFlowMetricTone, MetricCardVariant> = {
  positive: "success",
  negative: "danger",
  warning: "warning",
  neutral: "neutral",
  info: "info",
};

type Props = {
  testId?: string;
  label: string;
  amount?: number;
  value?: string;
  valueFull?: string;
  subtitle?: string;
  hint?: string;
  icon?: LucideIcon;
  tone?: FinanceCashFlowMetricTone;
  featured?: boolean;
};

export function FinanceCashFlowExecutiveMetricCard({
  testId,
  label,
  amount,
  value,
  valueFull,
  subtitle,
  hint,
  icon: Icon,
  tone = "neutral",
  featured = false,
}: Props) {
  const formatted = amount != null ? formatCashFlowKpiDisplay(amount) : null;

  return (
    <div
      data-testid={testId}
      className={cn(featured && "finance-cash-flow-metric-card--featured")}
    >
      <MetricCard
        label={label}
        formattedValue={formatted?.display ?? value ?? "—"}
        fullValue={valueFull ?? formatted?.full ?? value}
        subtitle={subtitle}
        variant={TONE_VARIANT[tone]}
        icon={Icon ? <Icon className="h-3.5 w-3.5" /> : undefined}
        labelAccessory={hint ? <FinanceBiCalcTooltip rule={hint} /> : undefined}
        className="finance-cash-flow-metric-card"
      />
    </div>
  );
}
