/**
 * Grid responsivo para blocos de resumo/KPI executivo.
 * Envolve MetricCardGrid com classe de print e breakpoints mobile.
 */

import React from "react";
import { MetricCardGrid } from "@/src/components/ui/MetricCardGrid";
import { cn } from "@/src/lib/utils";
import "./executive-summary-section.css";

export type SummaryKpiGridProps = {
  children: React.ReactNode;
  className?: string;
  /** Largura mínima de cada card — padrão 220px. */
  minColumnWidth?: number;
};

export function SummaryKpiGrid({
  children,
  className,
  minColumnWidth = 220,
}: SummaryKpiGridProps) {
  return (
    <MetricCardGrid
      minColumnWidth={minColumnWidth}
      className={cn("summary-kpi-grid", className)}
    >
      {children}
    </MetricCardGrid>
  );
}
