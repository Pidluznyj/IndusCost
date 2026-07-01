import React, { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CostCenterAnnualSpendingChartPayload } from "@/src/lib/financeCostCenterAnnualSpendingChart";
import { formatFinanceCurrencyCompact } from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { FinanceBiEmptyState } from "@/src/components/finance/bi/FinanceBiEmptyState";
import {
  CostCenterAnnualSpendingScenario,
  CostCenterAnnualSpendingTable,
  CostCenterAnnualSpendingTooltip,
  HorizontalBarAmountLabel,
  resolveCostCenterChartPeriodLabel,
  resolveCostCenterChartRows,
} from "@/src/components/finance/cost-centers/CostCenterAnnualSpendingChartShared";

type Props = {
  chart: CostCenterAnnualSpendingChartPayload | null | undefined;
  loading?: boolean;
  /** Usa displayRows (Top N + Outros). Padrão: true. */
  useDisplayRows?: boolean;
  maxBarLabelWidth?: number;
  testId?: string;
};

export function FinanceCostCenterAnnualSpendingChart({
  chart,
  loading = false,
  useDisplayRows = true,
  maxBarLabelWidth = 32,
  testId = "finance-cost-center-annual-spending-chart",
}: Props) {
  const rows = useMemo(
    () => resolveCostCenterChartRows(chart, { useDisplayRows, labelMax: maxBarLabelWidth }),
    [chart, useDisplayRows, maxBarLabelWidth]
  );

  const periodLabel = useMemo(() => resolveCostCenterChartPeriodLabel(chart), [chart]);
  const chartHeight = Math.max(300, Math.min(720, rows.length * 44 + 56));
  const yAxisWidth = Math.min(200, Math.max(120, maxBarLabelWidth * 4));

  if (!loading && rows.length === 0) {
    return (
      <FinanceBiEmptyState
        title={chart?.title ?? "Gastos por Centro de Custo"}
        description="Não há contas classificadas para o período selecionado."
      />
    );
  }

  return (
    <div className={`${financeBiCardClass} p-5 space-y-4`} data-testid={testId}>
      <div>
        <h3 className="text-sm font-bold text-[#111827]">
          {chart?.title ?? "Gastos por Centro de Custo"}
        </h3>
        <p className="text-[11px] text-[#6B7280] mt-0.5">
          {chart?.subtitle ?? "Distribuição do AP gerencial classificado por centro de custo."}
        </p>
        {chart ? (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-muted-foreground mt-2">
            <span>
              Total classificado:{" "}
              <span className="font-semibold text-foreground tabular-nums">
                {formatFinanceCurrencyCompact(chart.totalAmount)}
              </span>
            </span>
            <span>
              Centros no período:{" "}
              <span className="font-semibold text-foreground">{chart.costCentersCount}</span>
            </span>
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
          Carregando gráfico…
        </div>
      ) : (
        <>
          <div style={{ width: "100%", height: chartHeight }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={rows}
                layout="vertical"
                margin={{ top: 8, right: 148, left: 4, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
                <XAxis type="number" hide domain={[0, "dataMax"]} />
                <YAxis
                  type="category"
                  dataKey="shortLabel"
                  width={yAxisWidth}
                  tick={{ fontSize: 11, fill: "#334155" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  content={
                    <CostCenterAnnualSpendingTooltip periodLabel={periodLabel} />
                  }
                />
                <Bar dataKey="totalAmount" name="Total" radius={[0, 4, 4, 0]} maxBarSize={30}>
                  {rows.map((row) => (
                    <Cell key={row.costCenterId} fill={row.colorHex} />
                  ))}
                  <LabelList
                    dataKey="totalAmount"
                    position="right"
                    content={<HorizontalBarAmountLabel fontSize={10} data={rows} />}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <CostCenterAnnualSpendingScenario chart={chart} />

          <CostCenterAnnualSpendingTable
            rows={rows}
            testId={`${testId}-table`}
          />
        </>
      )}
    </div>
  );
}
