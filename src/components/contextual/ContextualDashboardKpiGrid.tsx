import React from "react";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { SYSTEM_TOTALIZER_GRID_CLASS } from "@/src/components/ui/SystemTotalizerCard";
import { cn } from "@/src/lib/utils";

export function ContextualDashboardKpiGrid({
  children,
  className,
  minColumnWidth = 168,
  testId,
}: {
  children: React.ReactNode;
  className?: string;
  minColumnWidth?: number;
  testId?: string;
}) {
  return (
    <SummaryKpiGrid
      minColumnWidth={minColumnWidth}
      testId={testId}
      className={cn(SYSTEM_TOTALIZER_GRID_CLASS, className)}
    >
      {children}
    </SummaryKpiGrid>
  );
}
