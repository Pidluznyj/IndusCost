import React, { useCallback, useState } from "react";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { FinanceBiEmptyState } from "@/src/components/finance/bi/FinanceBiEmptyState";
import { FinanceBiChartExpandButton } from "@/src/components/finance/bi/FinanceBiChartExpandButton";
import {
  FinanceBiChartExpandModal,
  useFinanceBiExpandedChartHeight,
} from "@/src/components/finance/bi/FinanceBiChartExpandModal";

/** Altura explícita — ResponsiveContainer com height="100%" colapsa em flex sem altura definida. */
export const FINANCE_BILLING_CHART_HEIGHT = 280;

export type FinanceBillingChartRenderContext = {
  height: number;
  expanded: boolean;
};

export function FinanceBillingChartShell({
  title,
  subtitle,
  children,
  empty,
  emptyDescription,
  testId,
  chartHeight = FINANCE_BILLING_CHART_HEIGHT,
  expandable,
  modalEyebrow = "Comercial · Pedidos de venda",
}: {
  title: string;
  subtitle?: string;
  /** Conteúdo estático ou função com altura (inline vs apresentação). */
  children:
    | React.ReactNode
    | ((ctx: FinanceBillingChartRenderContext) => React.ReactNode);
  empty?: boolean;
  emptyDescription?: string;
  testId?: string;
  chartHeight?: number;
  /**
   * Botão Maximize → modal de apresentação.
   * Default: ligado quando `children` é função (altura dinâmica).
   */
  expandable?: boolean;
  modalEyebrow?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const expandedHeight = useFinanceBiExpandedChartHeight(
    Math.max(chartHeight + 160, 560)
  );
  const openExpand = useCallback(() => setExpanded(true), []);
  const closeExpand = useCallback(() => setExpanded(false), []);

  const renderChart =
    typeof children === "function"
      ? children
      : (_ctx: FinanceBillingChartRenderContext) => children;

  const canExpand =
    expandable ?? typeof children === "function";

  if (empty) {
    return (
      <FinanceBiEmptyState
        title={title}
        description={emptyDescription ?? subtitle ?? "Sem dados para exibir com os filtros aplicados."}
      />
    );
  }

  return (
    <>
      <div
        data-testid={testId}
        className={`${financeBiCardClass} p-5 space-y-3 flex flex-col`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-[#111827]">{title}</h3>
            {subtitle ? (
              <p className="text-[11px] text-[#6B7280] mt-0.5">{subtitle}</p>
            ) : null}
          </div>
          {canExpand ? (
            <FinanceBiChartExpandButton
              onClick={openExpand}
              testId={testId ? `${testId}-expand` : "billing-chart-expand"}
            />
          ) : null}
        </div>
        <div style={{ width: "100%", height: chartHeight }}>
          {renderChart({ height: chartHeight, expanded: false })}
        </div>
      </div>
      {canExpand ? (
        <FinanceBiChartExpandModal
          open={expanded}
          title={title}
          subtitle={subtitle}
          eyebrow={modalEyebrow}
          onClose={closeExpand}
          testId={testId ? `${testId}-expand-modal` : "billing-chart-expand-modal"}
        >
          <div style={{ width: "100%", height: expandedHeight }}>
            {renderChart({ height: expandedHeight, expanded: true })}
          </div>
        </FinanceBiChartExpandModal>
      ) : null}
    </>
  );
}
