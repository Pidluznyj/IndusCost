import React from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ExecutiveCashFlowChartRow } from "@/src/lib/financeExecutiveReportPresentation";
import {
  formatExecutiveReportAxisCurrency,
  formatExecutiveReportPresentationCurrency,
} from "@/src/lib/financeExecutiveReportPresentation";
import { ExecutiveChartShell } from "@/src/components/finance/executive-report/charts/ExecutiveChartShell";

const INFLOW_COLOR = "#059669";
const OUTFLOW_COLOR = "#DC2626";
const NET_POSITIVE = "#2563EB";
const NET_NEGATIVE = "#B91C1C";
const ACCUMULATED_COLOR = "#1E3A5F";

function CashFlowTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload?: ExecutiveCashFlowChartRow & { name: string } }>;
  label?: string;
}) {
  if (!active || !payload?.[0]?.payload) return null;
  const row = payload[0].payload;
  return (
    <div className="executive-chart-tooltip">
      <p className="executive-chart-tooltip-title">Mês: {label}</p>
      <p style={{ color: INFLOW_COLOR }}>
        Entradas: {formatExecutiveReportPresentationCurrency(row.inflow)}
      </p>
      <p style={{ color: OUTFLOW_COLOR }}>
        Saídas: {formatExecutiveReportPresentationCurrency(row.outflow)}
      </p>
      <p style={{ color: row.isNegative ? NET_NEGATIVE : NET_POSITIVE }}>
        Saldo líquido: {formatExecutiveReportPresentationCurrency(row.netFlow)}
      </p>
      <p style={{ color: ACCUMULATED_COLOR }}>
        Acumulado: {formatExecutiveReportPresentationCurrency(row.accumulated)}
      </p>
    </div>
  );
}

export function ExecutiveCashFlowChart({
  title,
  subtitle,
  rows,
  empty,
}: {
  title: string;
  subtitle?: string;
  rows: ExecutiveCashFlowChartRow[];
  empty?: boolean;
}) {
  const data = rows.map((row) => ({
    ...row,
    name: row.monthLabel,
  }));

  return (
    <ExecutiveChartShell
      title={title}
      subtitle={subtitle ?? "Entradas, saídas, saldo líquido e acumulado — meses negativos em destaque"}
      empty={empty ?? rows.length === 0}
      testId="executive-cash-flow-chart"
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 12, right: 16, left: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
          <ReferenceLine y={0} stroke="#94A3B8" strokeWidth={1.5} />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 11, fill: "#64748B" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#64748B" }}
            tickFormatter={formatExecutiveReportAxisCurrency}
            width={88}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CashFlowTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          <Bar dataKey="inflow" name="Entradas" fill={INFLOW_COLOR} radius={[3, 3, 0, 0]} maxBarSize={20} />
          <Bar dataKey="outflow" name="Saídas" fill={OUTFLOW_COLOR} radius={[3, 3, 0, 0]} maxBarSize={20} />
          <Bar dataKey="netFlow" name="Saldo líquido" radius={[3, 3, 0, 0]} maxBarSize={24}>
            {data.map((entry) => (
              <Cell
                key={`net-${entry.name}`}
                fill={entry.isNegative ? NET_NEGATIVE : NET_POSITIVE}
                opacity={entry.isCurrentMonth ? 1 : 0.88}
                stroke={entry.isNegative ? "#7F1D1D" : undefined}
                strokeWidth={entry.isNegative ? 1.5 : 0}
              />
            ))}
          </Bar>
          <Line
            type="monotone"
            dataKey="accumulated"
            name="Saldo acumulado"
            stroke={ACCUMULATED_COLOR}
            strokeWidth={2.5}
            dot={{ r: 3, fill: ACCUMULATED_COLOR }}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ExecutiveChartShell>
  );
}
