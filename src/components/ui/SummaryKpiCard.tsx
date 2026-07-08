/**
 * Alias semântico de MetricCard com tipografia Cards Totalizadores Executivos.
 */

import React from "react";
import {
  MetricCard,
  type MetricCardProps,
  type MetricCardVariant,
} from "@/src/components/ui/MetricCard";
import { SYSTEM_TOTALIZER_METRIC_CARD_CLASS } from "@/src/components/ui/SystemTotalizerCard";
import { cn } from "@/src/lib/utils";

export type SummaryKpiCardProps = Omit<MetricCardProps, "subtitle" | "helperText" | "className"> & {
  description?: string;
  subtitle?: string;
  helperText?: string;
  className?: string;
};

export function SummaryKpiCard({
  description,
  subtitle,
  helperText,
  className,
  ...rest
}: SummaryKpiCardProps) {
  return (
    <MetricCard
      {...rest}
      subtitle={description ?? subtitle}
      helperText={helperText}
      className={cn(SYSTEM_TOTALIZER_METRIC_CARD_CLASS, className)}
    />
  );
}

export type { MetricCardVariant as SummaryKpiCardVariant };
