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
  receivablePreviousYear: "#F59E0B",
  payableCurrentYear: FINANCE_BI_COLORS.risk,
  receivableCurrentYear: FINANCE_BI_COLORS.success,
  receivableGoal: "#7C3AED",
} as const;

function AnnualComparisonTooltip({
  active,
  payload,
  label,
  labels,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string; value?: number; color?: string }>;
  label?: string;
  labels: {
    receivablePreviousYear: string;
    payableCurrentYear: string;
    receivableCurrentYear: string;
    receivableGoal: string;
  };
}) {
  if (!active || !payload?.length) return null;

  const byKey = new Map(payload.map((p) => [p.dataKey, p.value]));

  const rows: Array<{ label: string; value: number | null | undefined; color?: string }> = [
    {
      label: labels.receivablePreviousYear,
      value: byKey.get("receivablePreviousYear") as number | undefined,
      color: FINANCE_CASH_FLOW_ANNUAL_COMPARISON_COLORS.receivablePreviousYear,
    },
    {
      label: labels.payableCurrentYear,
      value: byKey.get("payableCurrentYear") as number | undefined,
      color: FINANCE_CASH_FLOW_ANNUAL_COMPARISON_COLORS.payableCurrentYear,
    },
    {
      label: labels.receivableCurrentYear,
      value: byKey.get("receivableCurrentYear") as number | undefined,
      color: FINANCE_CASH_FLOW_ANNUAL_COMPARISON_COLORS.receivableCurrentYear,
    },
  ];

  const goal = byKey.get("receivableGoal") as number | null | undefined;
  if (goal != null) {
    rows.push({
      label: labels.receivableGoal,
      value: goal,
      color: FINANCE_CASH_FLOW_ANNUAL_COMPARISON_COLORS.receivableGoal,
    });
  }

  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 shadow-sm text-[11px] text-[#111827] max-w-xs">
      <p className="font-semibold mb-1 capitalize">Mês: {label}</p>
      {rows.map((row) => (
        <p key={row.label} style={{ color: row.color ?? "#111827" }}>
          {row.label}: {formatFinanceCurrency(row.value ?? 0)}
        </p>
      ))}
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
    receivablePreviousYear: string;
    payableCurrentYear: string;
    receivableCurrentYear: string;
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
      <div style={{ minWidth: 720, width: "100%", height }}>
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart
            data={data}
            margin={{ top: 28, right: 12, left: 4, bottom: 4 }}
            barCategoryGap="18%"
            barGap={2}
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
            <Tooltip
              content={<AnnualComparisonTooltip labels={labels} />}
            />
            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
            <Bar
              dataKey="receivablePreviousYear"
              name={labels.receivablePreviousYear}
              fill={FINANCE_CASH_FLOW_ANNUAL_COMPARISON_COLORS.receivablePreviousYear}
              maxBarSize={22}
              radius={[3, 3, 0, 0]}
            >
              <LabelList dataKey="receivablePreviousYear" content={<ChartBarValueLabel fontSize={9} />} />
            </Bar>
            <Bar
              dataKey="payableCurrentYear"
              name={labels.payableCurrentYear}
              fill={FINANCE_CASH_FLOW_ANNUAL_COMPARISON_COLORS.payableCurrentYear}
              maxBarSize={22}
              radius={[3, 3, 0, 0]}
            >
              <LabelList dataKey="payableCurrentYear" content={<ChartBarValueLabel fontSize={9} />} />
            </Bar>
            <Bar
              dataKey="receivableCurrentYear"
              name={labels.receivableCurrentYear}
              fill={FINANCE_CASH_FLOW_ANNUAL_COMPARISON_COLORS.receivableCurrentYear}
              maxBarSize={22}
              radius={[3, 3, 0, 0]}
            >
              <LabelList dataKey="receivableCurrentYear" content={<ChartBarValueLabel fontSize={9} />} />
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
