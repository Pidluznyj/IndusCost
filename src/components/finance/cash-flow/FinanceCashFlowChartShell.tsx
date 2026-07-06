import React from "react";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { FinanceBiEmptyState } from "@/src/components/finance/bi/FinanceBiEmptyState";
import { FinanceCashFlowBlockTitle } from "@/src/components/finance/cash-flow/FinanceCashFlowBlockTitle";

/** Altura explícita — ResponsiveContainer com height="100%" colapsa em flex sem altura definida. */
export const FINANCE_CASH_FLOW_CHART_HEIGHT = 280;

export function FinanceCashFlowChartShell({
  title,
  subtitle,
  help,
  children,
  empty,
  emptyDescription,
  testId,
  chartHeight = FINANCE_CASH_FLOW_CHART_HEIGHT,
}: {
  title: string;
  subtitle?: string;
  help?: string;
  children: React.ReactNode;
  empty?: boolean;
  emptyDescription?: string;
  testId?: string;
  chartHeight?: number;
}) {
  if (empty) {
    return (
      <FinanceBiEmptyState
        title={title}
        description={emptyDescription ?? "Sem movimentos para os filtros aplicados."}
      />
    );
  }

  return (
    <div
      data-testid={testId}
      className={`${financeBiCardClass} p-5 space-y-3 flex flex-col`}
    >
      <FinanceCashFlowBlockTitle title={title} subtitle={subtitle} help={help} testId={testId} />
      <div style={{ width: "100%", height: chartHeight }}>{children}</div>
    </div>
  );
}
