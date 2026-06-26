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
import type { LabelProps } from "recharts";
import {
  formatFinanceCurrency,
  formatFinanceCurrencyCompact,
} from "@/src/lib/financeAccountsReceivableFormat";
import { FINANCE_BI_COLORS } from "@/src/lib/financeBiDashboardTheme";
import type { FinanceCashFlowAnnualComparisonChartRow } from "@/src/lib/financeCashFlowAnnualComparison";
import { buildChartBarLabelProps } from "@/src/lib/chartValueLabels";

export const FINANCE_CASH_FLOW_ANNUAL_COMPARISON_CHART_HEIGHT = 440;

export const FINANCE_CASH_FLOW_ANNUAL_COMPARISON_COLORS = {
  receivedAmount: "#059669",
  receivableOpenAmount: "#6EE7B7",
  paidAmount: "#B91C1C",
  payableOpenAmount: "#FB923C",
  netCashAmount: "#1E3A5F",
  netCashPositive: "#059669",
  netCashNegative: "#DC2626",
} as const;

const ANNUAL_CHART_MIN_WIDTH = 960;

function StackedBarTotalLabel({
  totalKey,
  ...props
}: LabelProps & {
  totalKey: "cashInTotalAmount" | "cashOutTotalAmount";
}) {
  const row = props.payload as FinanceCashFlowAnnualComparisonChartRow | undefined;
  const value = row?.[totalKey] ?? 0;
  if (!value || value <= 0) return null;
  const built = buildChartBarLabelProps({
    x: props.x as number,
    y: props.y as number,
    width: props.width as number,
    value,
  });
  if (!built) return null;
  return (
    <text
      x={built.x}
      y={built.y}
      fill={built.fill}
      fontSize={9}
      fontWeight={600}
      textAnchor="middle"
    >
      {built.text}
    </text>
  );
}

function AnnualComparisonTooltip({
  active,
  payload,
  label,
  labels,
  year,
}: {
  active?: boolean;
  payload?: Array<{ payload?: FinanceCashFlowAnnualComparisonChartRow }>;
  label?: string;
  labels: {
    receivedAmount: string;
    receivableOpenAmount: string;
    paidAmount: string;
    payableOpenAmount: string;
    netCashAmount: string;
    receivableGoal: string;
  };
  year: number;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  const netColor =
    row.netCashAmount >= 0
      ? FINANCE_CASH_FLOW_ANNUAL_COMPARISON_COLORS.netCashPositive
      : FINANCE_CASH_FLOW_ANNUAL_COMPARISON_COLORS.netCashNegative;

  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 shadow-sm text-[11px] text-[#111827] max-w-xs">
      <p className="font-semibold mb-1 capitalize">
        Mês: {label}/{year}
      </p>
      <p className="font-medium text-[#374151] mt-1">Entradas</p>
      <p style={{ color: FINANCE_CASH_FLOW_ANNUAL_COMPARISON_COLORS.receivedAmount }}>
        {labels.receivedAmount}: {formatFinanceCurrency(row.receivedAmount)}
      </p>
      <p style={{ color: FINANCE_CASH_FLOW_ANNUAL_COMPARISON_COLORS.receivableOpenAmount }}>
        {labels.receivableOpenAmount}: {formatFinanceCurrency(row.receivableOpenAmount)}
      </p>
      <p className="font-medium text-[#059669]">
        Total de entradas: {formatFinanceCurrency(row.cashInTotalAmount)}
      </p>
      <p className="font-medium text-[#374151] mt-2">Saídas</p>
      <p style={{ color: FINANCE_CASH_FLOW_ANNUAL_COMPARISON_COLORS.paidAmount }}>
        {labels.paidAmount}: {formatFinanceCurrency(row.paidAmount)}
      </p>
      <p style={{ color: FINANCE_CASH_FLOW_ANNUAL_COMPARISON_COLORS.payableOpenAmount }}>
        {labels.payableOpenAmount}: {formatFinanceCurrency(row.payableOpenAmount)}
      </p>
      <p className="font-medium text-[#DC2626]">
        Total de saídas: {formatFinanceCurrency(row.cashOutTotalAmount)}
      </p>
      <p className="font-semibold mt-2" style={{ color: netColor }}>
        {labels.netCashAmount}: {formatFinanceCurrency(row.netCashAmount)}
      </p>
      {row.receivableGoal != null ? (
        <p className="text-[#7C3AED] mt-1">
          {labels.receivableGoal}: {formatFinanceCurrency(row.receivableGoal)}
        </p>
      ) : null}
    </div>
  );
}

export function FinanceCashFlowAnnualComparisonChartView({
  data,
  labels,
  year,
  showGoal = false,
  height = FINANCE_CASH_FLOW_ANNUAL_COMPARISON_CHART_HEIGHT,
  testId = "finance-cash-flow-annual-comparison-chart",
}: {
  data: FinanceCashFlowAnnualComparisonChartRow[];
  labels: {
    receivedAmount: string;
    receivableOpenAmount: string;
    paidAmount: string;
    payableOpenAmount: string;
    netCashAmount: string;
    receivableGoal: string;
  };
  year: number;
  showGoal?: boolean;
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
            margin={{ top: 36, right: 16, left: 4, bottom: 4 }}
            barCategoryGap="18%"
            barGap={4}
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
            <Tooltip content={<AnnualComparisonTooltip labels={labels} year={year} />} />
            <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8 }} />
            <Bar
              dataKey="receivedAmount"
              name={labels.receivedAmount}
              stackId="entradas"
              fill={FINANCE_CASH_FLOW_ANNUAL_COMPARISON_COLORS.receivedAmount}
              maxBarSize={28}
            />
            <Bar
              dataKey="receivableOpenAmount"
              name={labels.receivableOpenAmount}
              stackId="entradas"
              fill={FINANCE_CASH_FLOW_ANNUAL_COMPARISON_COLORS.receivableOpenAmount}
              maxBarSize={28}
              radius={[3, 3, 0, 0]}
            >
              <LabelList
                content={<StackedBarTotalLabel totalKey="cashInTotalAmount" />}
              />
            </Bar>
            <Bar
              dataKey="paidAmount"
              name={labels.paidAmount}
              stackId="saidas"
              fill={FINANCE_CASH_FLOW_ANNUAL_COMPARISON_COLORS.paidAmount}
              maxBarSize={28}
            />
            <Bar
              dataKey="payableOpenAmount"
              name={labels.payableOpenAmount}
              stackId="saidas"
              fill={FINANCE_CASH_FLOW_ANNUAL_COMPARISON_COLORS.payableOpenAmount}
              maxBarSize={28}
              radius={[3, 3, 0, 0]}
            >
              <LabelList
                content={<StackedBarTotalLabel totalKey="cashOutTotalAmount" />}
              />
            </Bar>
            <Line
              type="monotone"
              dataKey="netCashAmount"
              name={labels.netCashAmount}
              stroke={FINANCE_CASH_FLOW_ANNUAL_COMPARISON_COLORS.netCashAmount}
              strokeWidth={2.5}
              dot={{ r: 3, fill: FINANCE_CASH_FLOW_ANNUAL_COMPARISON_COLORS.netCashAmount }}
              activeDot={{ r: 5 }}
            />
            {showGoal ? (
              <Line
                type="monotone"
                dataKey="receivableGoal"
                name={labels.receivableGoal}
                stroke="#7C3AED"
                strokeWidth={1.5}
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
