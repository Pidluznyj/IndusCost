import React from "react";
import { cn } from "@/src/lib/utils";
import "@/src/styles/indus-kpi-grid.css";

export function ExecutiveKpiGrid({
  children,
  columns = 4,
  className,
}: {
  children: React.ReactNode;
  columns?: 2 | 3 | 4 | 5;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "indus-kpi-grid finance-executive-kpi-grid executive-kpi-grid",
        className
      )}
      data-columns={columns}
    >
      {children}
    </div>
  );
}
