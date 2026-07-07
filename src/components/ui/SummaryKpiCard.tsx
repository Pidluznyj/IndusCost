/**
 * Alias semântico de MetricCard para blocos de resumo executivo.
 * Não altera visual nem comportamento — apenas expõe `description` como alias de `subtitle`.
 */

import React from "react";
import {
  MetricCard,
  type MetricCardProps,
  type MetricCardVariant,
} from "@/src/components/ui/MetricCard";

export type SummaryKpiCardProps = Omit<MetricCardProps, "subtitle" | "helperText"> & {
  /** Descrição curta abaixo do valor principal. */
  description?: string;
  subtitle?: string;
  helperText?: string;
};

export function SummaryKpiCard({
  description,
  subtitle,
  helperText,
  ...rest
}: SummaryKpiCardProps) {
  return (
    <MetricCard
      {...rest}
      subtitle={description ?? subtitle}
      helperText={helperText}
    />
  );
}

export type { MetricCardVariant as SummaryKpiCardVariant };
