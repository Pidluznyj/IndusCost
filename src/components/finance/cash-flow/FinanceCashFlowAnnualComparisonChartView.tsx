import React from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  formatFinanceCurrency,
  formatFinanceCurrencyCompact,
} from "@/src/lib/financeAccountsReceivableFormat";
import { FINANCE_BI_COLORS } from "@/src/lib/financeBiDashboardTheme";
import type { FinanceCashFlowAnnualComparisonChartRow } from "@/src/lib/financeCashFlowAnnualComparison";
import { ChartBarValueLabel } from "@/src/components/finance/shared/ChartValueLabel";

export const FINANCE_CASH_FLOW_ANNUAL_COMPARISON_CHART_HEIGHT = 420;

export const FINANCE_CASH_FLOW_ANNUAL_COMPARISON_COLORS = {
  receivedAmount: "#059669",
  receivableOpenAmount: "#34D399",
  paidAmount: "#B91C1C",
  payableOpenAmount: "#F97316",
  receivableGoal: "#7C3AED",
} as const;

const ANNUAL_CHART_MIN_WIDTH = 960;

function AnnualComparisonTooltip({
  active,
  payload,
  label,
  labels,
}: {
  active?: boolean;
  payload?: Array<{ payload?: FinanceCashFlowAnnualComparisonChartRow }>;
  label?: string;
  labels: {
    receivedAmount: string;
    receivableOpenAmount: string;
    paidAmount: string;
    payableOpenAmount: string;
    receivableGoal: string;
  };
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  const totalInflow = row.receivedAmount + row.receivableOpenAmount;
  const totalOutflow = row.paidAmount + row.payableOpenAmount;
  const netPotential = totalInflow - totalOutflow;

  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 shadow-sm text-[11px] text-[#111827] max-w-xs">
      <p className="font-semibold mb-1 capitalize">Mês: {label}</p>
      <p style={{ color: FINANCE_CASH_FLOW_ANNUAL_COMPARISON_COLORS.receivedAmount }}>
        {labels.receivedAmount}: {formatFinanceCurrency(row.receivedAmount)}
      </p>
      <p style={{ color: FINANCE_CASH_FLOW_ANNUAL_COMPARISON_COLORS.receivableOpenAmount }}>
        {labels.receivableOpenAmount}: {formatFinanceCurrency(row.receivableOpenAmount)}
      </p>
      <p style={{ color: FINANCE_CASH_FLOW_ANNUAL_COMPARISON_COLORS.paidAmount }}>
        {labels.paidAmount}: {formatFinanceCurrency(row.paidAmount)}
      </p>
      <p style={{ color: FINANCE_CASH_FLOW_ANNUAL_COMPARISON_COLORS.payableOpenAmount }}>
        {labels.payableOpenAmount}: {formatFinanceCurrency(row.payableOpenAmount)}
      </p>
      {row.receivableGoal != null ? (
        <p style={{ color: FINANCE_CASH_FLOW_ANNUAL_COMPARISON_COLORS.receivableGoal }}>
          {labels.receivableGoal}: {formatFinanceCurrency(row.receivableGoal)}
        </p>
      ) : null}
      <p className="mt-1 font-medium text-[#059669]">
        Total entradas: {formatFinanceCurrency(totalInflow)}
      </p>
      <p className="font-medium text-[#DC2626]">
        Total saídas: {formatFinanceCurrency(totalOutflow)}
      </p>
      <p className="font-semibold">
        Saldo potencial: {formatFinanceCurrency(netPotential)}
      </p>
    </div>
  );
}

export function FinanceCashFlowAnnualComparisonChartView({
  data,
  labels,
  showGoal,
  height = FINANCE_CASH_FLOW_ANNUAL_COMPARISON_CHART_HEIGHT,
  testId = "finance-cash-flow-annual-comparison-chart",
}: {
  data: FinanceCashFlowAnnualComparisonChartRow[];
  labels: {
    receivedAmount: string;
    receivableOpenAmount: string;
    paidAmount: string;
    payableOpenAmount: string;
    receivableGoal: string;
  };
  showGoal: boolean;
  height?: number;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="w-full overflow-x-auto"
      style={{ minHeight: height, height }}
    >
      <div style={{ minWidth: ANNUAL_CHART_MIN_WIDTH, width: "100%", height }}>
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart
            data={data}
            margin={{ top: 32, right: 12, left: 4, bottom: 4 }}
            barCategoryGap="14%"
            barGap={1}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={FINANCE_BI_COLORS.border} />
            <XAxis
              dataKey="name"
              interval={0}
              tick={{ fontSize: 11, fill: FINANCE_BI_COLORS.textSecondary }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: FINANCE_BI_COLORS.textSecondary }}
              tickFormatter={(v: number) => formatFinanceCurrencyCompact(v)}
              width={88}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<AnnualComparisonTooltip labels={labels} />} />
            <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8 }} />
            <Bar
              dataKey="receivedAmount"
              name={labels.receivedAmount}
              fill={FINANCE_CASH_FLOW_ANNUAL_COMPARISON_COLORS.receivedAmount}
              maxBarSize={18}
              radius={[2, 2, 0, 0]}
            >
              <LabelList dataKey="receivedAmount" content={<ChartBarValueLabel fontSize={8} />} />
            </Bar>
            <Bar
              dataKey="receivableOpenAmount"
              name={labels.receivableOpenAmount}
              fill={FINANCE_CASH_FLOW_ANNUAL_COMPARISON_COLORS.receivableOpenAmount}
              maxBarSize={18}
              radius={[2, 2, 0, 0]}
            >
              <LabelList
                dataKey="receivableOpenAmount"
                content={<ChartBarValueLabel fontSize={8} />}
              />
            </Bar>
            <Bar
              dataKey="paidAmount"
              name={labels.paidAmount}
              fill={FINANCE_CASH_FLOW_ANNUAL_COMPARISON_COLORS.paidAmount}
              maxBarSize={18}
              radius={[2, 2, 0, 0]}
            >
              <LabelList dataKey="paidAmount" content={<ChartBarValueLabel fontSize={8} />} />
            </Bar>
            <Bar
              dataKey="payableOpenAmount"
              name={labels.payableOpenAmount}
              fill={FINANCE_CASH_FLOW_ANNUAL_COMPARISON_COLORS.payableOpenAmount}
              maxBarSize={18}
              radius={[2, 2, 0, 0]}
            >
              <LabelList
                dataKey="payableOpenAmount"
                content={<ChartBarValueLabel fontSize={8} />}
              />
            </Bar>
            {showGoal ? (
              <Line
                type="monotone"
                dataKey="receivableGoal"
                name={labels.receivableGoal}
                stroke={FINANCE_CASH_FLOW_ANNUAL_COMPARISON_COLORS.receivableGoal}
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={false}
                connectNulls={false}
              />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
