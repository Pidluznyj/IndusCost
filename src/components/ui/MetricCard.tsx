/**
 * IndusCost Design System — card KPI executivo reutilizável.
 *
 * Regras:
 * - Valores monetários grandes usam abreviação (mil / Mi), nunca reticências.
 * - Valor completo fica em `title` para tooltip nativo.
 * - Variantes visuais para contexto (vencido, recebido, etc.).
 *
 * @example
 * <MetricCard
 *   label="Vencido"
 *   amount={summary.totalOverdueValue}
 *   amountFormat="currency"
 *   variant="danger"
 * />
 */

import React from "react";
import { cn } from "@/src/lib/utils";
import {
  resolveMetricDisplay,
  type FinancialMetricFormat,
} from "@/src/lib/formatFinancialMetric";
import "./metric-card.css";

export type MetricCardVariant =
  | "default"
  | "success"
  | "danger"
  | "warning"
  | "info"
  | "neutral";

const VARIANT_CLASS: Record<
  MetricCardVariant,
  { card: string; value: string; label: string }
> = {
  default: {
    card: "border-border/70 bg-card",
    value: "text-foreground",
    label: "text-muted-foreground",
  },
  neutral: {
    card: "border-border/70 bg-card",
    value: "text-foreground",
    label: "text-muted-foreground",
  },
  success: {
    card: "border-emerald-200/70 bg-emerald-50/40 dark:bg-emerald-950/20",
    value: "text-emerald-700 dark:text-emerald-400",
    label: "text-emerald-800/70 dark:text-emerald-400/80",
  },
  danger: {
    card: "border-red-200/70 bg-red-50/40 dark:bg-red-950/20",
    value: "text-red-700 dark:text-red-400",
    label: "text-red-800/70 dark:text-red-400/80",
  },
  warning: {
    card: "border-amber-200/70 bg-amber-50/40 dark:bg-amber-950/20",
    value: "text-amber-700 dark:text-amber-400",
    label: "text-amber-800/70 dark:text-amber-400/80",
  },
  info: {
    card: "border-blue-200/70 bg-blue-50/40 dark:bg-blue-950/20",
    value: "text-blue-700 dark:text-blue-400",
    label: "text-blue-800/70 dark:text-blue-400/80",
  },
};

export type MetricCardProps = {
  label: string;
  value?: string | number;
  formattedValue?: string;
  fullValue?: string;
  /** Valor numérico bruto — preferir com `amountFormat` para formatação automática. */
  amount?: number | null;
  amountFormat?: FinancialMetricFormat;
  subtitle?: string;
  helperText?: string;
  variant?: MetricCardVariant;
  icon?: React.ReactNode;
  loading?: boolean;
  compact?: boolean;
  className?: string;
};

export function MetricCard({
  label,
  value,
  formattedValue,
  fullValue,
  amount,
  amountFormat,
  subtitle,
  helperText,
  variant = "default",
  icon,
  loading = false,
  compact = false,
  className,
}: MetricCardProps) {
  const styles = VARIANT_CLASS[variant];
  const resolved = resolveMetricDisplay({
    label,
    value,
    formattedValue,
    fullValue,
    amount,
    amountFormat,
  });
  const displayTitle = resolved.title ?? resolved.fullValue;
  const isCompactDisplay = Boolean(resolved.title);

  return (
    <article
      className={cn(
        "metric-card rounded-xl border p-4 shadow-none",
        styles.card,
        compact && "metric-card--compact p-3.5",
        className
      )}
      data-testid="metric-card"
      aria-label={label}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span
          className={cn(
            "text-[10px] font-bold uppercase tracking-widest leading-snug",
            styles.label
          )}
        >
          {label}
        </span>
        {icon ? <span className="shrink-0 opacity-80">{icon}</span> : null}
      </div>

      {loading ? (
        <div
          className="h-8 w-28 animate-pulse rounded-md bg-muted/60"
          aria-hidden
          data-testid="metric-card-loading"
        />
      ) : (
        <p
          className={cn(
            "metric-card-value",
            isCompactDisplay && "metric-card-value--compact",
            styles.value
          )}
          title={displayTitle}
          data-testid="metric-card-value"
        >
          {resolved.display}
        </p>
      )}

      <div className="mt-auto pt-2 min-h-[1rem]">
        {subtitle ? (
          <p className="text-[11px] text-muted-foreground leading-snug">{subtitle}</p>
        ) : helperText ? (
          <p className="text-[10px] text-muted-foreground/80 leading-snug">{helperText}</p>
        ) : displayTitle && isCompactDisplay ? (
          <p className="text-[10px] text-muted-foreground/70 truncate" title={displayTitle}>
            {displayTitle}
          </p>
        ) : null}
      </div>
    </article>
  );
}
