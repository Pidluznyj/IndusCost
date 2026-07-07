import React from "react";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { cn } from "@/src/lib/utils";

type ExecutiveKpiGridProps = {
  children: React.ReactNode;
  className?: string;
  compact?: boolean;
};

export function ExecutiveKpiGrid({ children, className, compact = false }: ExecutiveKpiGridProps) {
  return (
    <SummaryKpiGrid
      minColumnWidth={compact ? 160 : 200}
      className={cn(
        "finance-executive-kpi-grid executive-kpi-grid",
        compact && "executive-kpi-grid--compact",
        className
      )}
    >
      {children}
    </SummaryKpiGrid>
  );
}
