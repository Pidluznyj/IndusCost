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
import {
  ChartLineValueLabel,
} from "@/src/components/finance/shared/ChartValueLabel";

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
const ANNUAL_CHART_BAR_LABEL_MIN_HEIGHT = 14;

/** Rótulo dentro do segmento empilhado — oculta quando o trecho é estreito demais. */
function StackedSegmentValueLabel(
  props: LabelProps & { fill?: string; minHeight?: number }
) {
  const height = Number(props.height ?? 0);
  const minHeight = props.minHeight ?? ANNUAL_CHART_BAR_LABEL_MIN_HEIGHT;
  if (height < minHeight) return null;

  const x = Number(props.x ?? 0);
  const y = Number(props.y ?? 0);
  const width = Number(props.width ?? 0);
  const value = Number(props.value ?? 0);
  if (!Number.isFinite(value) || value === 0) return null;

  const text = formatFinanceCurrencyCompact(value);
  if (!text) return null;

  return (
    <text
      x={x + width / 2}
      y={y + height / 2 + 3}
      fill={props.fill ?? "#FFFFFF"}
      fontSize={8}
      fontWeight={600}
      textAnchor="middle"
    >
      {text}
    </text>
  );
}

function StackTopTotalLabel(props: LabelProps & { total?: number }) {
  const total = props.total ?? 0;
  if (!Number.isFinite(total) || total === 0) return null;
  const x = Number(props.x ?? 0);
  const y = Number(props.y ?? 0);
  const width = Number(props.width ?? 0);
  const text = formatFinanceCurrencyCompact(total);
  if (!text) return null;
  return (
    <text
      x={x + width / 2}
      y={y - 5}
      fill="#334155"
      fontSize={9}
      fontWeight={700}
      textAnchor="middle"
    >
      {text}
    </text>
  );
}

function InflowReceivedLabel(props: LabelProps) {
  const row = props.payload as FinanceCashFlowAnnualComparisonChartRow | undefined;
  const open = row?.receivableOpenAmount ?? 0;
  return (
    <>
      <StackedSegmentValueLabel {...props} fill="#FFFFFF" />
      {open <= 0 ? <StackTopTotalLabel {...props} total={row?.cashInTotalAmount} /> : null}
    </>
  );
}

function InflowOpenLabel(props: LabelProps) {
  const row = props.payload as FinanceCashFlowAnnualComparisonChartRow | undefined;
  return (
    <>
      <StackedSegmentValueLabel {...props} fill="#065F46" />
      <StackTopTotalLabel {...props} total={row?.cashInTotalAmount} />
    </>
  );
}

function OutflowPaidLabel(props: LabelProps) {
  const row = props.payload as FinanceCashFlowAnnualComparisonChartRow | undefined;
  const open = row?.payableOpenAmount ?? 0;
  return (
    <>
      <StackedSegmentValueLabel {...props} fill="#FFFFFF" />
      {open <= 0 ? <StackTopTotalLabel {...props} total={row?.cashOutTotalAmount} /> : null}
    </>
  );
}

function OutflowOpenLabel(props: LabelProps) {
  const row = props.payload as FinanceCashFlowAnnualComparisonChartRow | undefined;
  return (
    <>
      <StackedSegmentValueLabel {...props} fill="#9A3412" />
      <StackTopTotalLabel {...props} total={row?.cashOutTotalAmount} />
    </>
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
      <p className="text-[#374151] mt-1">
        Saldo acumulado: {formatFinanceCurrency(row.accumulatedCashAmount)}
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
            margin={{ top: 44, right: 16, left: 4, bottom: 4 }}
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
            >
              <LabelList dataKey="receivedAmount" content={<InflowReceivedLabel />} />
            </Bar>
            <Bar
              dataKey="receivableOpenAmount"
              name={labels.receivableOpenAmount}
              stackId="entradas"
              fill={FINANCE_CASH_FLOW_ANNUAL_COMPARISON_COLORS.receivableOpenAmount}
              maxBarSize={28}
              radius={[3, 3, 0, 0]}
            >
              <LabelList dataKey="receivableOpenAmount" content={<InflowOpenLabel />} />
            </Bar>
            <Bar
              dataKey="paidAmount"
              name={labels.paidAmount}
              stackId="saidas"
              fill={FINANCE_CASH_FLOW_ANNUAL_COMPARISON_COLORS.paidAmount}
              maxBarSize={28}
            >
              <LabelList dataKey="paidAmount" content={<OutflowPaidLabel />} />
            </Bar>
            <Bar
              dataKey="payableOpenAmount"
              name={labels.payableOpenAmount}
              stackId="saidas"
              fill={FINANCE_CASH_FLOW_ANNUAL_COMPARISON_COLORS.payableOpenAmount}
              maxBarSize={28}
              radius={[3, 3, 0, 0]}
            >
              <LabelList dataKey="payableOpenAmount" content={<OutflowOpenLabel />} />
            </Bar>
            <Line
              type="monotone"
              dataKey="netCashAmount"
              name={labels.netCashAmount}
              stroke={FINANCE_CASH_FLOW_ANNUAL_COMPARISON_COLORS.netCashAmount}
              strokeWidth={2.5}
              dot={{ r: 3, fill: FINANCE_CASH_FLOW_ANNUAL_COMPARISON_COLORS.netCashAmount }}
              activeDot={{ r: 5 }}
            >
              <LabelList
                dataKey="netCashAmount"
                content={<ChartLineValueLabel fontSize={8} />}
              />
            </Line>
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
