import React from "react";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { FinanceBiEmptyState } from "@/src/components/finance/bi/FinanceBiEmptyState";

/** Altura explícita — ResponsiveContainer com height="100%" colapsa em flex sem altura definida. */
export const FINANCE_CASH_FLOW_CHART_HEIGHT = 280;

export function FinanceCashFlowChartShell({
  title,
  subtitle,
  children,
  empty,
  emptyDescription,
  testId,
  chartHeight = FINANCE_CASH_FLOW_CHART_HEIGHT,
}: {
  title: string;
  subtitle?: string;
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
      <div>
        <h3 className="text-sm font-bold text-[#111827]">{title}</h3>
        {subtitle ? <p className="text-[11px] text-[#6B7280] mt-0.5">{subtitle}</p> : null}
      </div>
      <div style={{ width: "100%", height: chartHeight }}>{children}</div>
    </div>
  );
}
