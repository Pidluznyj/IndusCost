import React from "react";
import type { LucideIcon } from "lucide-react";
import {
  SystemTotalizerCard,
  type SystemTotalizerTone,
} from "@/src/components/ui/SystemTotalizerCard";
import { formatCashFlowKpiDisplay } from "@/src/lib/financeCashFlowDisplay";
import { cn } from "@/src/lib/utils";
import "./finance-cash-flow-executive-summary.css";

export type FinanceCashFlowMetricTone = SystemTotalizerTone;

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
  icon,
  tone = "neutral",
  featured = false,
}: Props) {
  const formatted = amount != null ? formatCashFlowKpiDisplay(amount) : null;

  return (
    <SystemTotalizerCard
      testId={testId}
      label={label}
      value={formatted?.display ?? value}
      valueTitle={valueFull ?? formatted?.full ?? value}
      subtitle={subtitle}
      helperText={hint}
      icon={icon}
      tone={tone}
      featured={featured}
      className="finance-cash-flow-metric-card"
    />
  );
}
