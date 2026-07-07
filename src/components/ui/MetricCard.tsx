/**
 * IndusCost Design System — card KPI executivo reutilizável.
 *
 * Visual:
 * - Fundo neutro (card/branco), sem preenchimento colorido inteiro.
 * - Acento semântico na borda lateral esquerda (4px).
 * - Valor principal escuro; variante danger usa vermelho no valor.
 * - Valores monetários grandes: abreviação (mil / Mi), nunca reticências.
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
  | "neutral"
  | "money"
  | "margin"
  | "internal";

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
  /** Conteúdo ao lado do label (ex.: tooltip de cálculo). */
  labelAccessory?: React.ReactNode;
  /** Rodapé opcional abaixo do subtítulo (ex.: badge de tendência). */
  footer?: React.ReactNode;
  loading?: boolean;
  compact?: boolean;
  className?: string;
  /** Permite quebra de linha em valores técnicos longos (logs, caminhos, nomes de arquivo). */
  valueWrap?: boolean;
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
  labelAccessory,
  footer,
  loading = false,
  compact = false,
  className,
  valueWrap = false,
}: MetricCardProps) {
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
  const footnote = subtitle ?? helperText ?? (isCompactDisplay ? displayTitle : null);

  return (
    <article
      className={cn(
        "metric-card",
        `metric-card--${variant}`,
        compact && "metric-card--compact",
        className
      )}
      data-testid="metric-card"
      data-variant={variant}
      aria-label={label}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <span className="metric-card-label inline-flex min-w-0 items-center gap-1">
          {label}
          {labelAccessory}
        </span>
        {icon ? (
          <span className="metric-card-icon-wrap" aria-hidden="true">
            {icon}
          </span>
        ) : null}
      </div>

      {loading ? (
        <div className="metric-card-loading" aria-hidden data-testid="metric-card-loading" />
      ) : (
        <p
          className={cn(
            "metric-card-value min-w-0 w-full",
            isCompactDisplay && "metric-card-value--compact",
            valueWrap && "metric-card-value--wrap"
          )}
          title={displayTitle}
          data-testid="metric-card-value"
        >
          {resolved.display}
        </p>
      )}

      {footnote && !loading ? (
        <p className="metric-card-subtitle" title={displayTitle}>
          {footnote}
        </p>
      ) : null}

      {footer && !loading ? <div className="metric-card-footer">{footer}</div> : null}
    </article>
  );
}
