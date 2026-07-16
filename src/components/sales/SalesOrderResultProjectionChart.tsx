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
import { CalendarDays, Percent, Target, TrendingUp, Wallet } from "lucide-react";
import type {
  SalesOrderResultProjection,
  SalesOrderResultRealizedVsProjectedRow,
} from "@/src/lib/salesOrderResultTypes";
import { formatFinanceCurrencyCompact } from "@/src/lib/financeAccountsReceivableFormat";
import { formatCurrency } from "@/src/lib/utils";
import { ChartBarValueLabel } from "@/src/components/finance/shared/ChartValueLabel";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import {
  SYSTEM_TOTALIZER_GRID_CLASS,
  SYSTEM_TOTALIZER_METRIC_CARD_CLASS,
  SystemTotalizerCard,
  type SystemTotalizerTone,
} from "@/src/components/ui/SystemTotalizerCard";
import { ExecutiveSummarySection } from "@/src/components/ui/ExecutiveSummarySection";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";

function resolveAchievementTone(percent: number | null): SystemTotalizerTone {
  if (percent == null || !Number.isFinite(percent)) return "neutral";
  if (percent >= 100) return "success";
  if (percent >= 80) return "warning";
  return "danger";
}

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

  const hasYearTarget = projection.yearTarget != null;

  return (
    <div className="space-y-4" data-testid="sales-order-result-projection-chart">
      <ExecutiveSummarySection
        title="Projeção comercial"
        eyebrow="Indicadores de realizado, meta e projeção"
        testId="sales-order-result-projection-summary"
      >
        <SummaryKpiGrid minColumnWidth={168} className={SYSTEM_TOTALIZER_GRID_CLASS}>
          <SystemTotalizerCard
            className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
            label="Média diária (mês)"
            amount={projection.averageBusinessDaySales}
            amountFormat="currency"
            tone="money"
            icon={CalendarDays}
            helperText="Média de venda por dia útil no mês corrente."
          />
          <SystemTotalizerCard
            className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
            label="Realizado no ano"
            amount={projection.yearRealized}
            amountFormat="currency"
            tone="success"
            icon={Wallet}
            helperText="Soma do valor realizado no ano até a data de referência."
          />
          <SystemTotalizerCard
            className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
            label="Meta no ano"
            amount={hasYearTarget ? projection.yearTarget : null}
            amountFormat={hasYearTarget ? "currency" : undefined}
            value={hasYearTarget ? undefined : "Sem meta cadastrada"}
            valueSize={hasYearTarget ? "default" : "text"}
            tone={hasYearTarget ? "info" : "neutral"}
            icon={Target}
            helperText={
              hasYearTarget
                ? "Meta comercial anual (quando disponível no sistema)."
                : "Nenhuma meta anual cadastrada para o período."
            }
          />
          <SystemTotalizerCard
            className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
            label="Projeção no ano"
            amount={projection.yearProjected}
            amountFormat="currency"
            tone="warning"
            icon={TrendingUp}
            helperText="Projeção anual com base na média por dia útil."
          />
          <SystemTotalizerCard
            className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
            label="% atingimento projetado"
            amount={projection.projectedAchievementPercent}
            amountFormat="percent"
            tone={resolveAchievementTone(projection.projectedAchievementPercent)}
            icon={Percent}
            helperText="Projeção no ano ÷ meta no ano."
          />
        </SummaryKpiGrid>
      </ExecutiveSummarySection>

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
