import React from "react";
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SalesOrdersAccumulatedPoint } from "@/src/lib/executiveDashboardTypes";
import type { DashboardChartSeriesConfig } from "@/src/lib/executiveDashboardTypes";
import {
  formatExecutiveCompactCurrency,
  formatExecutiveCurrency,
} from "@/src/lib/executiveDashboardFormatters";

function ChartShell({
  title,
  subtitle,
  children,
  empty,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  empty?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-white dark:bg-card shadow-sm p-5 space-y-3 min-h-[320px] flex flex-col">
      <div>
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
        {subtitle ? <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p> : null}
      </div>
      {empty ? (
        <p className="text-sm text-muted-foreground flex-1 flex items-center justify-center">
          Sem dados acumulados para exibir.
        </p>
      ) : (
        <div className="flex-1 min-h-[260px]">{children}</div>
      )}
    </div>
  );
}

export function FinanceBillingAccumulatedChart({
  series,
  config,
}: {
  series: SalesOrdersAccumulatedPoint[];
  config: DashboardChartSeriesConfig;
}) {
  const data = series.map((p) => ({
    name: p.monthLabel,
    previous: p.previousYearAccumulated,
    current: p.currentYearAccumulated,
    target: p.accumulatedTarget,
    projected: p.projectedAccumulated,
  }));

  const empty = data.every(
    (d) => d.previous === 0 && d.current == null && d.target === 0
  );

  return (
    <ChartShell
      title="Faturamento Acumulado NF-e"
      subtitle="Evolução acumulada YTD com meta e projeção"
      empty={empty}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis
            tick={{ fontSize: 11 }}
            tickFormatter={(v: number) => formatExecutiveCompactCurrency(v).replace("R$ ", "")}
            width={72}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip formatter={(v: number) => formatExecutiveCurrency(v)} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line
            type="monotone"
            dataKey="previous"
            name={config.labels.previousYearBar}
            stroke={config.colors.previousYearBar}
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="current"
            name={config.labels.currentYearBar}
            stroke={config.colors.currentYearBar}
            strokeWidth={2.5}
            dot={false}
            connectNulls={false}
          />
          <Line
            type="monotone"
            dataKey="target"
            name={config.labels.targetLine}
            stroke={config.colors.targetLine}
            strokeWidth={2}
            strokeDasharray="4 2"
            dot={false}
          />
          {config.colors.projectedLine ? (
            <Line
              type="monotone"
              dataKey="projected"
              name={config.labels.projectedLine ?? "Projeção"}
              stroke={config.colors.projectedLine}
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
            />
          ) : null}
        </ComposedChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
