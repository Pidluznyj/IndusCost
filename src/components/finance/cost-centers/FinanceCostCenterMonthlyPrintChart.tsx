import React from "react";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import type { CostCenterMonthlyChartPayload } from "@/src/lib/financeCostCenterMonthlyChart.shared";

const CHART_HEIGHT_PX = 140;

type Props = {
  payload: CostCenterMonthlyChartPayload;
  title?: string;
};

export function FinanceCostCenterMonthlyPrintChart({
  payload,
  title = "Comportamento mensal do centro de custo",
}: Props) {
  const peak = payload.series.reduce(
    (max, point) => Math.max(max, point.paidAmount + point.openAmount),
    0
  );
  const maxTotal = peak > 0 ? peak : 1;

  if (!payload.hasData) {
    return (
      <section
        className="finance-cc-detail-print-section finance-cc-detail-print-chart-section"
        data-testid="finance-cc-detail-print-chart-empty"
      >
        <h2 className="finance-cc-detail-print-section-title">{title}</h2>
        <p className="finance-cc-detail-print-chart-subtitle">
          {payload.periodLabel} · {payload.metricsScope}
        </p>
        <p className="finance-cc-detail-print-empty">
          Nenhum título encontrado para este centro de custo no período.
        </p>
      </section>
    );
  }

  return (
    <section
      className="finance-cc-detail-print-section finance-cc-detail-print-chart-section"
      data-testid="finance-cc-detail-print-chart"
    >
      <h2 className="finance-cc-detail-print-section-title">{title}</h2>
      <p className="finance-cc-detail-print-chart-subtitle">
        {payload.periodLabel} · {payload.metricsScope}
      </p>
      <div className="finance-cc-detail-print-chart-legend">
        <span className="finance-cc-detail-print-chart-legend-item">
          <span className="finance-cc-detail-print-chart-swatch finance-cc-detail-print-chart-swatch--paid" />
          Pago / realizado
        </span>
        <span className="finance-cc-detail-print-chart-legend-item">
          <span className="finance-cc-detail-print-chart-swatch finance-cc-detail-print-chart-swatch--open" />
          Previsto / em aberto
        </span>
      </div>
      <div className="finance-cc-detail-print-chart-plot" style={{ height: CHART_HEIGHT_PX }}>
        {payload.series.map((point) => {
          const total = point.paidAmount + point.openAmount;
          const stackHeightPct = Math.max(0, Math.min(100, (total / maxTotal) * 100));
          const paidPct = total > 0 ? (point.paidAmount / total) * 100 : 0;
          const openPct = total > 0 ? (point.openAmount / total) * 100 : 0;
          return (
            <div
              key={`${point.year}-${point.month}`}
              className={
                point.highlighted
                  ? "finance-cc-detail-print-chart-col finance-cc-detail-print-chart-col--highlighted"
                  : "finance-cc-detail-print-chart-col"
              }
              title={`${point.monthLabel}: pago ${formatFinanceCurrency(point.paidAmount)} · aberto ${formatFinanceCurrency(point.openAmount)}`}
            >
              <div className="finance-cc-detail-print-chart-bars">
                {total > 0 ? (
                  <div
                    className="finance-cc-detail-print-chart-stack"
                    style={{ height: `${stackHeightPct}%` }}
                  >
                    {openPct > 0 ? (
                      <div
                        className="finance-cc-detail-print-chart-segment finance-cc-detail-print-chart-segment--open"
                        style={{ height: `${openPct}%` }}
                      />
                    ) : null}
                    {paidPct > 0 ? (
                      <div
                        className="finance-cc-detail-print-chart-segment finance-cc-detail-print-chart-segment--paid"
                        style={{ height: `${paidPct}%` }}
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
              <span className="finance-cc-detail-print-chart-month">{point.monthLabel}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
