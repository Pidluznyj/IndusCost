import React, { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CostCenterAnnualSpendingChartPayload } from "@/src/lib/financeCostCenterAnnualSpendingChart";
import { formatExecutiveReportAxisCurrency } from "@/src/lib/financeExecutiveReportPresentation";
import { ExecutiveChartShell } from "@/src/components/finance/executive-report/charts/ExecutiveChartShell";
import { ChartBarValueLabel } from "@/src/components/finance/shared/ChartValueLabel";
import { useExecutiveChartFrameDimensions } from "@/src/components/finance/executive-report/charts/executiveChartFrameContext";
import { useExecutiveReportPdfMode } from "@/src/components/finance/executive-report/ExecutiveReportPrintContext";
import {
  EXECUTIVE_CHART_BAR_LABEL_SIZE,
  EXECUTIVE_CHART_IS_ANIMATION_ACTIVE,
  EXECUTIVE_CHART_Y_AXIS_WIDTH,
  EXECUTIVE_CHART_Y_TICK,
  resolveExecutiveChartMargin,
} from "@/src/components/finance/executive-report/charts/executiveReportChartTheme";
import { formatFinancePercent } from "@/src/lib/financeAccountsReceivableFormat";

const EXECUTIVE_CC_SPENDING_TOP_N = 10;

function shortCenterLabel(name: string, max: number): string {
  if (name.length <= max) return name;
  return `${name.slice(0, max - 1)}…`;
}

function ExecutiveCcSpendingTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: Record<string, unknown> }>;
}) {
  if (!active || !payload?.[0]?.payload) return null;
  const row = payload[0].payload as {
    displayName: string;
    totalAmount: number;
    percentageOfTotal: number;
    paidAmount: number;
    openAmount: number;
    overdueAmount: number;
  };
  return (
    <div className="rounded border border-slate-200 bg-white px-2 py-1.5 text-[10px] shadow-sm max-w-[220px]">
      <p className="font-semibold text-slate-900">{row.displayName}</p>
      <p>{formatExecutiveReportAxisCurrency(row.totalAmount)}</p>
      <p className="text-slate-600">{formatFinancePercent(row.percentageOfTotal)} do total</p>
    </div>
  );
}

export function ExecutiveCostCenterAnnualSpendingChart({
  chart,
  title,
  subtitle,
  scenarioText,
}: {
  chart: CostCenterAnnualSpendingChartPayload | null | undefined;
  title?: string;
  subtitle?: string;
  scenarioText?: string;
}) {
  const { width, height } = useExecutiveChartFrameDimensions();
  const pdfMode = useExecutiveReportPdfMode();

  const rows = useMemo(() => {
    if (!chart) return [];
    const labelMax = pdfMode ? 22 : 26;
    return chart.displayRows.map((row) => ({
      ...row,
      shortLabel: shortCenterLabel(row.displayName, labelMax),
    }));
  }, [chart, pdfMode]);

  const resolvedTitle = title ?? chart?.title ?? "Gastos anuais por Centro de Custo";
  const resolvedSubtitle =
    subtitle ??
    chart?.subtitle ??
    "Distribuição do AP gerencial por centro de custo no ano/filtro selecionado.";

  const headerNote =
    chart && chart.othersIncludedCount > 0
      ? `Top ${EXECUTIVE_CC_SPENDING_TOP_N} centros + Outros (${chart.othersIncludedCount} agrupados, ${formatExecutiveReportAxisCurrency(chart.othersAmount ?? 0)}).`
      : chart
        ? `Total ${formatExecutiveReportAxisCurrency(chart.totalAmount)} · ${chart.costCentersCount} centro(s).`
        : undefined;

  return (
    <>
      <ExecutiveChartShell
        title={resolvedTitle}
        subtitle={resolvedSubtitle}
        empty={!chart || rows.length === 0}
        testId="executive-cost-center-annual-spending-chart"
        scenarioText={scenarioText ?? headerNote}
      >
        <BarChart
          width={width}
          height={height}
          data={rows}
          layout="vertical"
          margin={resolveExecutiveChartMargin(pdfMode)}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: pdfMode ? 9 : 10, fill: "#475569" }}
            tickFormatter={formatExecutiveReportAxisCurrency}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="shortLabel"
            width={pdfMode ? 108 : EXECUTIVE_CHART_Y_AXIS_WIDTH}
            tick={EXECUTIVE_CHART_Y_TICK}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<ExecutiveCcSpendingTooltip />} />
          <Bar
            dataKey="totalAmount"
            name="Gasto"
            radius={[0, 3, 3, 0]}
            maxBarSize={pdfMode ? 22 : 28}
            isAnimationActive={EXECUTIVE_CHART_IS_ANIMATION_ACTIVE}
          >
            {rows.map((row) => (
              <Cell key={row.costCenterId} fill={row.colorHex} />
            ))}
            <LabelList
              dataKey="totalAmount"
              position="right"
              content={<ChartBarValueLabel fontSize={EXECUTIVE_CHART_BAR_LABEL_SIZE} />}
            />
          </Bar>
        </BarChart>
      </ExecutiveChartShell>

      {rows.length > 0 ? (
        <div
          className="executive-cc-spending-legend mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[9px] text-slate-600"
          data-testid="executive-cost-center-annual-spending-legend"
        >
          {rows.map((row) => (
            <div key={row.costCenterId} className="flex items-center gap-1.5 min-w-0">
              <span
                className="h-2 w-2 shrink-0 rounded-sm"
                style={{ backgroundColor: row.colorHex }}
                aria-hidden
              />
              <span className="truncate" title={row.displayName}>
                {row.shortLabel}
              </span>
              <span className="ml-auto tabular-nums shrink-0">
                {formatFinancePercent(row.percentageOfTotal)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}

export { EXECUTIVE_CC_SPENDING_TOP_N };
