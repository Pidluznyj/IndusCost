import React from "react";
import type { LucideIcon } from "lucide-react";
import { FinanceBiKpiCard } from "@/src/components/finance/bi/FinanceBiKpiCard";
import { cn } from "@/src/lib/utils";

export type FinanceKpiTone = "neutral" | "success" | "warning" | "danger" | "info";

const TONE_COLOR_CLASS: Record<FinanceKpiTone, string> = {
  neutral: "text-[#111827]",
  success: "text-[#059669]",
  warning: "text-[#D97706]",
  danger: "text-[#DC2626]",
  info: "text-[#2563EB]",
};

export type FinanceKpiCardProps = {
  label: string;
  value: string;
  valueTitle?: string | null;
  amount?: number | null;
  amountFormat?: "currency" | "number" | "percent";
  subtitle?: string;
  helperText?: string;
  icon?: LucideIcon;
  tone?: FinanceKpiTone;
  compact?: boolean;
  loading?: boolean;
  trend?: "up" | "down" | "neutral";
  trendLabel?: string;
};

/** Card KPI executivo — somente visual; sem regra de negócio ou backend. */
export function FinanceKpiCard({
  label,
  value,
  valueTitle,
  amount,
  amountFormat,
  subtitle,
  helperText,
  icon,
  tone = "neutral",
  compact = false,
  loading = false,
  trend,
  trendLabel,
}: FinanceKpiCardProps) {
  return (
    <FinanceBiKpiCard
      icon={icon}
      label={label}
      value={value}
      valueTitle={valueTitle}
      amount={amount}
      amountFormat={amountFormat}
      sub={subtitle}
      hint={helperText}
      colorClass={TONE_COLOR_CLASS[tone]}
      loading={loading}
      trend={trend}
      trendLabel={trendLabel}
      labelClassName="normal-case tracking-normal font-semibold"
      valueClassName={cn(
        "text-xl font-semibold sm:text-2xl",
        compact && "text-lg sm:text-xl"
      )}
    />
  );
}
