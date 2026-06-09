import React, { useMemo } from "react";
import {
  Bar,
  CartesianGrid,
  Legend,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BillingMultiYearMonthlyPoint } from "@/src/lib/financeBillingChartData";
import {
  FINANCE_BILLING_SERIES_COLORS,
  getFinanceBillingYearColor,
  resolveFinanceBillingComparisonYears,
} from "@/src/lib/financeBillingChartTheme";
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
          Sem dados para exibir com os filtros atuais.
        </p>
      ) : (
        <div className="flex-1 min-h-[260px]">{children}</div>
      )}
    </div>
  );
}

export function FinanceBillingMonthlyComparisonChart({
  points,
  selectedYear,
  showTarget = true,
}: {
  points: BillingMultiYearMonthlyPoint[];
  selectedYear: number;
  showTarget?: boolean;
}) {
  const years = useMemo(
    () => resolveFinanceBillingComparisonYears(selectedYear, 3),
    [selectedYear]
  );

  const data = useMemo(
    () =>
      points.map((p) => {
        const row: Record<string, string | number | null> = {
          name: p.monthLabel,
        };
        for (const year of years) {
          row[`y${year}`] = p.values[year] ?? null;
        }
        if (showTarget) row.target = p.targetValue;
        return row;
      }),
    [points, years, showTarget]
  );

  const empty = data.every((d) =>
    years.every((y) => d[`y${y}`] == null || d[`y${y}`] === 0)
  );

  return (
    <ChartShell
      title="Faturamento Mês a Mês"
      subtitle="Comparativo por ano — venda de mercado (SalesOrder)"
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
          <Tooltip
            formatter={(value: number, name: string) => {
              if (value == null) return "—";
              if (name === "target") return formatExecutiveCurrency(value);
              return formatExecutiveCurrency(value);
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {years.map((year) => (
            <Bar
              key={year}
              dataKey={`y${year}`}
              name={`${year}`}
              fill={getFinanceBillingYearColor(year)}
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
            />
          ))}
          {showTarget ? (
            <Line
              type="monotone"
              dataKey="target"
              name={`Meta ${selectedYear} (+30%)`}
              stroke={FINANCE_BILLING_SERIES_COLORS.target}
              strokeWidth={2}
              dot={false}
            />
          ) : null}
        </ComposedChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
