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
import { buildCostCenterAnnualSpendingScenarioText } from "@/src/lib/financeCostCenterAnnualSpendingChart";
import { ExecutiveChartShell } from "@/src/components/finance/executive-report/charts/ExecutiveChartShell";
import { useExecutiveChartFrameDimensions } from "@/src/components/finance/executive-report/charts/executiveChartFrameContext";
import { useExecutiveReportPdfMode } from "@/src/components/finance/executive-report/ExecutiveReportPrintContext";
import {
  EXECUTIVE_CHART_IS_ANIMATION_ACTIVE,
  EXECUTIVE_CHART_Y_TICK,
  resolveExecutiveChartMargin,
} from "@/src/components/finance/executive-report/charts/executiveReportChartTheme";
import {
  CostCenterAnnualSpendingTable,
  CostCenterAnnualSpendingTooltip,
  HorizontalBarAmountLabel,
  resolveCostCenterChartPeriodLabel,
  resolveCostCenterChartRows,
} from "@/src/components/finance/cost-centers/CostCenterAnnualSpendingChartShared";

const EXECUTIVE_CC_SPENDING_TOP_N = 10;

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
    const labelMax = pdfMode ? 24 : 30;
    return resolveCostCenterChartRows(chart, { useDisplayRows: true, labelMax });
  }, [chart, pdfMode]);

  const periodLabel = useMemo(() => resolveCostCenterChartPeriodLabel(chart), [chart]);

  const resolvedTitle = title ?? chart?.title ?? "Gastos por Centro de Custo";
  const resolvedSubtitle =
    subtitle ??
    chart?.subtitle ??
    "Distribuição do AP gerencial classificado por centro de custo.";

  const resolvedScenario =
    scenarioText ?? (chart ? buildCostCenterAnnualSpendingScenarioText(chart) : undefined);

  const yAxisWidth = pdfMode ? 112 : 136;
  const chartMargin = {
    ...resolveExecutiveChartMargin(pdfMode),
    right: pdfMode ? 132 : 148,
    left: 4,
  };

  return (
    <>
      <ExecutiveChartShell
        title={resolvedTitle}
        subtitle={resolvedSubtitle}
        empty={!chart || rows.length === 0}
        testId="executive-cost-center-annual-spending-chart"
        scenarioText={resolvedScenario}
      >
        <BarChart
          width={width}
          height={height}
          data={rows}
          layout="vertical"
          margin={chartMargin}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
          <XAxis type="number" hide domain={[0, "dataMax"]} />
          <YAxis
            type="category"
            dataKey="shortLabel"
            width={yAxisWidth}
            tick={EXECUTIVE_CHART_Y_TICK}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            content={
              <CostCenterAnnualSpendingTooltip periodLabel={periodLabel} compact={pdfMode} />
            }
          />
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
              content={
                <HorizontalBarAmountLabel
                  fontSize={pdfMode ? 8 : 9}
                  data={rows}
                />
              }
            />
          </Bar>
        </BarChart>
      </ExecutiveChartShell>

      {rows.length > 0 && !pdfMode ? (
        <CostCenterAnnualSpendingTable
          rows={rows}
          testId="executive-cost-center-annual-spending-table"
        />
      ) : null}
    </>
  );
}

export { EXECUTIVE_CC_SPENDING_TOP_N };
