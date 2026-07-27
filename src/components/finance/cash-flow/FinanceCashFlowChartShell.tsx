import React, { useCallback, useState } from "react";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { FinanceBiEmptyState } from "@/src/components/finance/bi/FinanceBiEmptyState";
import { FinanceBiChartExpandButton } from "@/src/components/finance/bi/FinanceBiChartExpandButton";
import {
  FinanceBiChartExpandModal,
  useFinanceBiExpandedChartHeight,
} from "@/src/components/finance/bi/FinanceBiChartExpandModal";
import { FinanceCashFlowBlockTitle } from "@/src/components/finance/cash-flow/FinanceCashFlowBlockTitle";

/** Altura explícita — ResponsiveContainer com height="100%" colapsa em flex sem altura definida. */
export const FINANCE_CASH_FLOW_CHART_HEIGHT = 280;

export type FinanceCashFlowChartRenderContext = {
  height: number;
  expanded: boolean;
};

export function FinanceCashFlowChartShell({
  title,
  subtitle,
  help,
  children,
  empty,
  emptyDescription,
  testId,
  chartHeight = FINANCE_CASH_FLOW_CHART_HEIGHT,
  expandable = true,
}: {
  title: string;
  subtitle?: string;
  help?: string;
  /** Conteúdo estático ou função que recebe a altura (inline vs modal). */
  children:
    | React.ReactNode
    | ((ctx: FinanceCashFlowChartRenderContext) => React.ReactNode);
  empty?: boolean;
  emptyDescription?: string;
  testId?: string;
  chartHeight?: number;
  /** Botão Maximize no canto superior direito → modal de apresentação. */
  expandable?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const expandedHeight = useFinanceBiExpandedChartHeight(
    Math.max(chartHeight + 160, 560)
  );
  const openExpand = useCallback(() => setExpanded(true), []);
  const closeExpand = useCallback(() => setExpanded(false), []);

  if (empty) {
    return (
      <FinanceBiEmptyState
        title={title}
        description={emptyDescription ?? "Sem movimentos para os filtros aplicados."}
      />
    );
  }

  const renderChart =
    typeof children === "function"
      ? children
      : (_ctx: FinanceCashFlowChartRenderContext) => children;

  return (
    <>
      <div
        data-testid={testId}
        className={`${financeBiCardClass} p-5 space-y-3 flex flex-col`}
      >
        <div className="flex items-start justify-between gap-2">
          <FinanceCashFlowBlockTitle
            title={title}
            subtitle={subtitle}
            help={help}
            testId={testId}
            className="min-w-0 flex-1"
          />
          {expandable ? (
            <FinanceBiChartExpandButton
              onClick={openExpand}
              testId={testId ? `${testId}-expand` : "cash-flow-chart-expand"}
            />
          ) : null}
        </div>
        <div style={{ width: "100%", height: chartHeight }}>
          {renderChart({ height: chartHeight, expanded: false })}
        </div>
      </div>
      {expandable ? (
        <FinanceBiChartExpandModal
          open={expanded}
          title={title}
          subtitle={subtitle}
          onClose={closeExpand}
          testId={testId ? `${testId}-expand-modal` : "cash-flow-chart-expand-modal"}
        >
          <div style={{ width: "100%", height: expandedHeight }}>
            {renderChart({ height: expandedHeight, expanded: true })}
          </div>
        </FinanceBiChartExpandModal>
      ) : null}
    </>
  );
}
