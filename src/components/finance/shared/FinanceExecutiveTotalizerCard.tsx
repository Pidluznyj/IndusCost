/**
 * Card totalizador financeiro — delega ao padrão SystemTotalizerCard.
 * Substitui FinanceKpiCard / FinanceBiKpiCard em telas financeiras (exceto CC aprovado).
 */

import React from "react";
import type { LucideIcon } from "lucide-react";
import { TrendingDown, TrendingUp } from "lucide-react";
import {
  SYSTEM_TOTALIZER_METRIC_CARD_CLASS,
  SystemTotalizerCard,
  type SystemTotalizerTone,
} from "@/src/components/ui/SystemTotalizerCard";
import { financeColorClassToVariant } from "@/src/lib/financeKpiMetricVariant";
import { cn } from "@/src/lib/utils";
import type { FinanceKpiTone } from "./FinanceKpiCard";

const KPI_TONE: Record<FinanceKpiTone, SystemTotalizerTone> = {
  neutral: "neutral",
  success: "success",
  warning: "warning",
  danger: "danger",
  info: "info",
};

function colorClassToTone(colorClass?: string): SystemTotalizerTone {
  return financeColorClassToVariant(colorClass) as SystemTotalizerTone;
}

function buildTrendFooter(
  trend?: "up" | "down" | "neutral",
  trendLabel?: string
): React.ReactNode {
  if (!trend || !trendLabel) return undefined;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold shrink-0",
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
  );
}

export type FinanceExecutiveTotalizerCardProps = {
  testId?: string;
  label: string;
  value?: string;
  valueTitle?: string | null;
  amount?: number | null;
  amountFormat?: "currency" | "number" | "percent";
  subtitle?: string;
  sub?: string;
  helperText?: string;
  hint?: string;
  scopeNote?: string;
  icon?: LucideIcon;
  tone?: FinanceKpiTone;
  colorClass?: string;
  loading?: boolean;
  compact?: boolean;
  trend?: "up" | "down" | "neutral";
  trendLabel?: string;
  valueSize?: "default" | "text";
  className?: string;
  footer?: React.ReactNode;
};

export function FinanceExecutiveTotalizerCard({
  testId,
  label,
  value,
  valueTitle,
  amount,
  amountFormat,
  subtitle,
  sub,
  helperText,
  hint,
  scopeNote,
  icon,
  tone,
  colorClass,
  loading = false,
  compact = false,
  trend,
  trendLabel,
  valueSize,
  className,
  footer,
}: FinanceExecutiveTotalizerCardProps) {
  const subtitleParts = [scopeNote, subtitle ?? sub].filter(Boolean);
  const resolvedSubtitle = subtitleParts.length > 0 ? subtitleParts.join(" · ") : undefined;
  const resolvedHelper = helperText ?? hint;
  const resolvedTone: SystemTotalizerTone = tone
    ? KPI_TONE[tone]
    : colorClassToTone(colorClass);

  const usesStructuredAmount =
    !loading && amount != null && amountFormat != null && (value == null || value === "" || value === "—");

  const resolvedValue =
    value === "" || value === "—" ? undefined : value;

  const trendFooter = buildTrendFooter(trend, trendLabel);
  const combinedFooter =
    trendFooter || footer ? (
      <>
        {trendFooter}
        {footer}
      </>
    ) : undefined;

  const autoTextSize =
    valueSize ??
    (resolvedValue &&
    !usesStructuredAmount &&
    !amountFormat &&
    resolvedValue.length > 14
      ? "text"
      : "default");

  return (
    <SystemTotalizerCard
      testId={testId}
      className={cn(SYSTEM_TOTALIZER_METRIC_CARD_CLASS, className)}
      label={label}
      value={usesStructuredAmount ? undefined : resolvedValue}
      valueTitle={valueTitle}
      amount={usesStructuredAmount ? amount : loading ? null : amount ?? null}
      amountFormat={usesStructuredAmount ? amountFormat : undefined}
      subtitle={resolvedSubtitle}
      helperText={resolvedHelper}
      icon={icon}
      tone={resolvedTone}
      loading={loading}
      compact={compact}
      valueSize={autoTextSize}
      footer={combinedFooter}
    />
  );
}
