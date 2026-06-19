import React from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  ReferenceLine,
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
import type { ExecutiveMonthlyPlannedChartRow } from "@/src/lib/financeCashFlowExecutiveChart";
import {
  ChartBarValueLabel,
  ChartLineValueLabel,
} from "@/src/components/finance/shared/ChartValueLabel";
import {
  EXECUTIVE_CHART_BAR_LABEL_SIZE,
  EXECUTIVE_CHART_LEGEND,
  EXECUTIVE_CHART_LINE_LABEL_SIZE,
  EXECUTIVE_CHART_MARGIN,
  EXECUTIVE_CHART_X_TICK,
  EXECUTIVE_CHART_Y_AXIS_WIDTH,
  EXECUTIVE_CHART_Y_TICK,
} from "@/src/components/finance/executive-report/charts/executiveReportChartTheme";

export const FINANCE_CASH_FLOW_PLANNED_CHART_HEIGHT = 340;

function PlannedMonthlyTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload?: ExecutiveMonthlyPlannedChartRow }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 shadow-sm text-[11px] text-[#111827]">
      <p className="font-semibold mb-1">Mês: {label}</p>
      <p className="text-[#059669]">Recebido: {formatFinanceCurrency(row.received)}</p>
      <p className="text-[#059669]">A receber: {formatFinanceCurrency(row.receivableOpen)}</p>
      <p className="text-[#059669] font-medium">
        Entradas est.: {formatFinanceCurrency(row.estimatedInflow)}
      </p>
      <p className="text-[#DC2626]">Pago: {formatFinanceCurrency(row.paid)}</p>
      <p className="text-[#DC2626]">A pagar: {formatFinanceCurrency(row.payableOpen)}</p>
      <p className="text-[#DC2626] font-medium">
        Saídas est.: {formatFinanceCurrency(row.estimatedOutflow)}
      </p>
      <p className="font-semibold mt-1">
        Saldo líquido: {formatFinanceCurrency(row.netBalance)}
      </p>
      <p className="text-[#2563EB]">
        Saldo acumulado: {formatFinanceCurrency(row.accumulatedBalance)}
      </p>
    </div>
  );
}

export function FinanceCashFlowPlannedChart({
  data,
  height = FINANCE_CASH_FLOW_PLANNED_CHART_HEIGHT,
  showValueLabels = false,
  testId = "finance-cash-flow-planned-chart",
  presentation = "default",
}: {
  data: ExecutiveMonthlyPlannedChartRow[];
  height?: number;
  showValueLabels?: boolean;
  testId?: string;
  presentation?: "default" | "executive";
}) {
  const isExecutive = presentation === "executive";
  const margin =
    showValueLabels || isExecutive
      ? isExecutive
        ? EXECUTIVE_CHART_MARGIN
        : { top: 28, right: 12, left: 0, bottom: 4 }
      : { top: 8, right: 12, left: 0, bottom: 4 };

  const xTick = isExecutive
    ? EXECUTIVE_CHART_X_TICK
    : { fontSize: 10, fill: FINANCE_BI_COLORS.textSecondary };
  const yTick = isExecutive
    ? EXECUTIVE_CHART_Y_TICK
    : { fontSize: 10, fill: FINANCE_BI_COLORS.textSecondary };
  const yAxisWidth = isExecutive ? EXECUTIVE_CHART_Y_AXIS_WIDTH : 84;
  const legendStyle = isExecutive ? EXECUTIVE_CHART_LEGEND : { fontSize: 10 };
  const barLabelSize = isExecutive ? EXECUTIVE_CHART_BAR_LABEL_SIZE : undefined;
  const lineLabelSize = isExecutive ? EXECUTIVE_CHART_LINE_LABEL_SIZE : undefined;

  return (
    <div data-testid={testId} style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={margin}>
          <CartesianGrid strokeDasharray="3 3" stroke={FINANCE_BI_COLORS.border} />
          <ReferenceLine y={0} stroke={FINANCE_BI_COLORS.textSecondary} strokeWidth={1.5} />
          <XAxis
            dataKey="name"
            interval={0}
            tick={xTick}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={yTick}
            tickFormatter={(v: number) => formatFinanceCurrencyCompact(v)}
            width={yAxisWidth}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<PlannedMonthlyTooltip />} />
          <Legend wrapperStyle={legendStyle} />
          <Bar
            dataKey="netBalance"
            name="Saldo líquido mensal"
            maxBarSize={36}
            radius={[3, 3, 0, 0]}
          >
            {data.map((entry) => (
              <Cell
                key={`planned-net-${entry.name}`}
                fill={entry.netBalance >= 0 ? FINANCE_BI_COLORS.success : FINANCE_BI_COLORS.risk}
              />
            ))}
            {showValueLabels ? (
              <LabelList
                dataKey="netBalance"
                content={<ChartBarValueLabel fontSize={barLabelSize} />}
              />
            ) : null}
          </Bar>
          <Line
            type="monotone"
            dataKey="accumulatedBalance"
            name="Saldo acumulado"
            stroke={FINANCE_BI_COLORS.primary}
            strokeWidth={2}
            dot={{ r: 2, fill: FINANCE_BI_COLORS.primary }}
            connectNulls={false}
          >
            {showValueLabels ? (
              <LabelList
                dataKey="accumulatedBalance"
                content={<ChartLineValueLabel fontSize={lineLabelSize} />}
              />
            ) : null}
          </Line>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
