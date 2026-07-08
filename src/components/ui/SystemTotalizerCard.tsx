/**
 * Cards Totalizadores Executivos — componente padrão IndusCost.
 * Wrapper sobre MetricCard com tipografia executiva (referência Fluxo de Caixa).
 */

import React from "react";
import type { LucideIcon } from "lucide-react";
import { MetricCard, type MetricCardVariant } from "@/src/components/ui/MetricCard";
import { FinanceBiCalcTooltip } from "@/src/components/finance/bi/FinanceBiCalcTooltip";
import {
  formatKpiCompactCurrency,
  formatKpiCompactNumber,
  formatKpiCompactPercent,
  formatKpiDisplayValue,
} from "@/src/lib/kpiDisplayFormat";
import { cn } from "@/src/lib/utils";
import "./system-totalizer-card.css";

export const SYSTEM_TOTALIZER_GRID_CLASS = "system-totalizer-grid";
export const SYSTEM_TOTALIZER_GRID_SECONDARY_CLASS = "system-totalizer-grid--secondary";
export const SYSTEM_TOTALIZER_METRIC_CARD_CLASS = "system-totalizer-metric-card";

export type SystemTotalizerTone =
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "money"
  | "margin"
  | "internal"
  | "default";

const TONE_VARIANT: Record<SystemTotalizerTone, MetricCardVariant> = {
  neutral: "neutral",
  success: "success",
  warning: "warning",
  danger: "danger",
  info: "info",
  money: "money",
  margin: "margin",
  internal: "internal",
  default: "default",
};

export type SystemTotalizerBadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

export type SystemTotalizerBadgeProps = {
  label: string;
  tone?: SystemTotalizerBadgeTone;
  testId?: string;
};

export function SystemTotalizerBadge({
  label,
  tone = "neutral",
  testId,
}: SystemTotalizerBadgeProps) {
  return (
    <span
      className={cn("system-totalizer-badge", `system-totalizer-badge--${tone}`)}
      data-testid={testId}
    >
      {label}
    </span>
  );
}

export function receiptClosingStatusBadgeTone(
  status: string
): SystemTotalizerBadgeTone {
  const normalized = status.trim().toUpperCase();
  if (normalized === "CLOSED" || normalized === "FECHADO") return "success";
  if (normalized === "PREVIEW") return "warning";
  return "neutral";
}

export function receiptClosingStatusBadgeLabel(status: string): string {
  const normalized = status.trim().toUpperCase();
  if (normalized === "CLOSED" || normalized === "FECHADO") return "Fechado";
  if (normalized === "PREVIEW") return "Prévia";
  return status;
}

export type SystemTotalizerCardProps = {
  testId?: string;
  label: string;
  value?: string;
  valueTitle?: string | null;
  amount?: number | null;
  amountFormat?: "currency" | "number" | "percent";
  subtitle?: string;
  helperText?: string;
  icon?: LucideIcon;
  tone?: SystemTotalizerTone;
  variant?: MetricCardVariant;
  loading?: boolean;
  compact?: boolean;
  /** Texto longo (ex.: meta não configurada) — fonte proporcional. */
  valueSize?: "default" | "text";
  /** Logs, caminhos, datas longas. */
  valueWrap?: boolean;
  badge?: SystemTotalizerBadgeProps;
  footer?: React.ReactNode;
  labelAccessory?: React.ReactNode;
  featured?: boolean;
  className?: string;
};

export function SystemTotalizerCard({
  testId,
  label,
  value,
  valueTitle,
  amount,
  amountFormat,
  subtitle,
  helperText,
  icon: Icon,
  tone = "neutral",
  variant,
  loading = false,
  compact = false,
  valueSize = "default",
  valueWrap = false,
  badge,
  footer,
  labelAccessory,
  featured = false,
  className,
}: SystemTotalizerCardProps) {
  let displayValue = value ?? "—";
  let displayTitle = valueTitle ?? undefined;

  if (!loading && !badge && amount != null && amountFormat != null) {
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

  const useTextSize =
    !badge &&
    (valueSize === "text" ||
      (valueSize !== "default" && amount == null && amountFormat == null && Boolean(value?.trim())));

  return (
    <div
      data-testid={testId}
      className={cn(featured && "system-totalizer-metric-card--featured")}
    >
      <MetricCard
        label={label}
        value={badge ? "\u00a0" : displayValue}
        formattedValue={badge ? "\u00a0" : displayValue}
        fullValue={badge ? undefined : displayTitle}
        subtitle={subtitle}
        variant={variant ?? TONE_VARIANT[tone]}
        icon={Icon ? <Icon className="h-3.5 w-3.5" /> : undefined}
        labelAccessory={
          labelAccessory ??
          (helperText && !badge ? <FinanceBiCalcTooltip rule={helperText} /> : undefined)
        }
        footer={
          badge ? (
            <>
              <SystemTotalizerBadge {...badge} />
              {footer}
            </>
          ) : (
            footer
          )
        }
        loading={loading}
        compact={compact}
        valueWrap={valueWrap}
        className={cn(
          SYSTEM_TOTALIZER_METRIC_CARD_CLASS,
          badge && "system-totalizer-metric-card--badge",
          useTextSize && "metric-card-value--text",
          className
        )}
      />
    </div>
  );
}

/** Alias semântico para módulos financeiros. */
export const ExecutiveTotalizerCard = SystemTotalizerCard;
