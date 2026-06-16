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
import type { FinanceCashFlowExecutiveMonthlyRow } from "@/src/lib/financeCashFlowExecutiveSummary";
import {
  formatFinanceCurrency,
  formatFinanceCurrencyCompact,
} from "@/src/lib/financeAccountsReceivableFormat";
import { FINANCE_BI_COLORS } from "@/src/lib/financeBiDashboardTheme";
import {
  buildExecutiveMonthlyPlannedChartRows,
  executiveMonthlyTimelineHasChartData,
  type ExecutiveMonthlyPlannedChartRow,
} from "@/src/lib/financeCashFlowExecutiveChart";
import {
  FinanceCashFlowChartShell,
} from "@/src/components/finance/cash-flow/FinanceCashFlowChartShell";

const PLANNED_CHART_HEIGHT = 340;

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

export function FinanceCashFlowMonthlyPlannedChart({
  year,
  rows,
}: {
  year: number;
  rows: FinanceCashFlowExecutiveMonthlyRow[];
}) {
  const data = buildExecutiveMonthlyPlannedChartRows(rows);
  const empty = rows.length === 0 || !executiveMonthlyTimelineHasChartData(rows);

  return (
    <FinanceCashFlowChartShell
      testId="cash-flow-monthly-planned-chart"
      title={`Fluxo de caixa planejado — ${year}`}
      subtitle="Saldo líquido mensal e acumulado calculados por vencimento de contas a receber e contas a pagar."
      empty={empty}
      emptyDescription="Sem dados para montar o fluxo planejado do período filtrado."
      chartHeight={PLANNED_CHART_HEIGHT}
    >
      <ResponsiveContainer width="100%" height={PLANNED_CHART_HEIGHT}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={FINANCE_BI_COLORS.border} />
          <ReferenceLine y={0} stroke={FINANCE_BI_COLORS.textSecondary} strokeWidth={1.5} />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 10, fill: FINANCE_BI_COLORS.textSecondary }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: FINANCE_BI_COLORS.textSecondary }}
            tickFormatter={(v: number) => formatFinanceCurrencyCompact(v)}
            width={84}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<PlannedMonthlyTooltip />} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
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
          </Bar>
          <Line
            type="monotone"
            dataKey="accumulatedBalance"
            name="Saldo acumulado"
            stroke={FINANCE_BI_COLORS.primary}
            strokeWidth={2}
            dot={{ r: 2, fill: FINANCE_BI_COLORS.primary }}
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </FinanceCashFlowChartShell>
  );
}
