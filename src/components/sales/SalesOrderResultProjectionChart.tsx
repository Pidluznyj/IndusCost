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
import type {
  SalesOrderResultProjection,
  SalesOrderResultRealizedVsProjectedRow,
} from "@/src/lib/salesOrderResultTypes";
import { formatFinanceCurrencyCompact } from "@/src/lib/financeAccountsReceivableFormat";
import { formatCurrency, formatNumber } from "@/src/lib/utils";
import { ChartBarValueLabel } from "@/src/components/finance/shared/ChartValueLabel";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { MetricCard } from "@/src/components/ui/MetricCard";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";

export function SalesOrderResultProjectionChart({
  rows,
  projection,
}: {
  rows: SalesOrderResultRealizedVsProjectedRow[];
  projection: SalesOrderResultProjection;
}) {
  const chartData = rows.map((row) => ({
    name: row.monthLabel,
    realized: row.isFuture ? 0 : row.realizedAmount,
    projected: row.projectedAmount ?? 0,
    target: row.targetAmount ?? 0,
  }));

  return (
    <div className="space-y-4" data-testid="sales-order-result-projection-chart">
      <SummaryKpiGrid minColumnWidth={180}>
        <MetricCard
          label="Média diária (mês)"
          formattedValue={
            projection.averageBusinessDaySales != null
              ? formatCurrency(projection.averageBusinessDaySales)
              : "—"
          }
        />
        <MetricCard
          label="Realizado no ano"
          formattedValue={formatCurrency(projection.yearRealized)}
        />
        <MetricCard
          label="Meta no ano"
          formattedValue={
            projection.yearTarget != null ? formatCurrency(projection.yearTarget) : "Sem meta cadastrada"
          }
        />
        <MetricCard
          label="Projeção no ano"
          formattedValue={
            projection.yearProjected != null ? formatCurrency(projection.yearProjected) : "—"
          }
        />
        <MetricCard
          label="% atingimento projetado"
          formattedValue={
            projection.projectedAchievementPercent != null
              ? `${formatNumber(projection.projectedAchievementPercent, 1)}%`
              : "—"
          }
        />
      </SummaryKpiGrid>

      <div className={`${financeBiCardClass} p-5`}>
        <h3 className="text-sm font-bold text-[#111827]">Realizado vs Projetado</h3>
        <p className="text-[11px] text-[#6B7280] mt-0.5 mb-3">
          Projeção = média de venda por dia útil × dias úteis do mês. Meta = +30% sobre ano anterior quando disponível.
        </p>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={chartData} margin={{ top: 28, right: 16, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748B" }} axisLine={false} tickLine={false} />
            <YAxis
              tick={{ fontSize: 11, fill: "#64748B" }}
              tickFormatter={(v: number) => formatFinanceCurrencyCompact(v)}
              width={88}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip formatter={(v: number) => formatCurrency(v)} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Bar dataKey="realized" name="Realizado" fill="#166534" radius={[4, 4, 0, 0]} maxBarSize={24}>
              <LabelList dataKey="realized" content={<ChartBarValueLabel />} />
            </Bar>
            <Bar dataKey="projected" name="Projeção" fill="#F59E0B" radius={[4, 4, 0, 0]} maxBarSize={24}>
              <LabelList dataKey="projected" content={<ChartBarValueLabel />} />
            </Bar>
            <Line
              type="monotone"
              dataKey="target"
              name="Meta mensal"
              stroke="#DC2626"
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={{ r: 2, fill: "#DC2626" }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
