/**
 * IndusCost Design System — grid responsivo para cards KPI.
 *
 * Uso:
 * ```tsx
 * <MetricCardGrid>
 *   <MetricCard label="Em aberto" amount={total} amountFormat="currency" />
 * </MetricCardGrid>
 * ```
 *
 * Evita colunas fixas estreitas (ex.: 7 cards na mesma linha) que truncam valores.
 */

import React from "react";
import { cn } from "@/src/lib/utils";
import "./metric-card.css";

type MetricCardGridProps = {
  children: React.ReactNode;
  className?: string;
  /** Largura mínima de cada card — padrão 220px para métricas financeiras. */
  minColumnWidth?: number;
  testId?: string;
};

export function MetricCardGrid({
  children,
  className,
  minColumnWidth = 220,
  testId = "metric-card-grid",
}: MetricCardGridProps) {
  return (
    <div
      className={cn("metric-card-grid", className)}
      style={{ ["--metric-card-min" as string]: `${minColumnWidth}px` }}
      data-testid={testId}
    >
      {children}
    </div>
  );
}
