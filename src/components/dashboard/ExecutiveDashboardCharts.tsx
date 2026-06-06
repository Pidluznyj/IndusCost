import React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  BillingRealizedVsProjected,
  DashboardChartPoint,
  DashboardCumulativeChartPoint,
} from "@/src/lib/executiveDashboardTypes";
import { formatExecutiveCompactCurrency, formatExecutiveCurrency } from "@/src/lib/executiveDashboardFormatters";

type MonthlyProps = {
  title: string;
  data: DashboardChartPoint[];
  showTarget?: boolean;
  showTwoYearsAgo?: boolean;
};

export function ExecutiveMonthlyChart({
  title,
  data,
  showTarget = true,
  showTwoYearsAgo = false,
}: MonthlyProps) {
  const chartData = data.map((point) => ({
    name: point.label.split("/")[0],
    atual: point.currentYear ?? 0,
    anterior: point.previousYear ?? 0,
    retrasado: showTwoYearsAgo ? (point.twoYearsAgo ?? 0) : undefined,
    meta: showTarget ? (point.target ?? 0) : undefined,
  }));

  return (
    <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
      <h3 className="mb-4 text-lg font-bold">{title}</h3>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => formatExecutiveCompactCurrency(Number(v)).replace("R$ ", "")}
            />
            <Tooltip
              formatter={(value: number, name: string) => [
                formatExecutiveCurrency(value),
                name === "atual"
                  ? "Ano atual"
                  : name === "anterior"
                    ? "Ano anterior"
                    : name === "retrasado"
                      ? "Ano retrasado"
                      : "Meta",
              ]}
            />
            <Legend />
            {showTwoYearsAgo ? (
              <Bar dataKey="retrasado" name="Ano retrasado" fill="hsl(var(--muted-foreground) / 0.2)" radius={[4, 4, 0, 0]} />
            ) : null}
            <Bar dataKey="anterior" name="Ano anterior" fill="hsl(var(--muted-foreground) / 0.35)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="atual" name="Ano atual" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            {showTarget ? (
              <Bar dataKey="meta" name="Meta (+30%)" fill="hsl(var(--chart-2, 142 76% 36%))" radius={[4, 4, 0, 0]} />
            ) : null}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

export function ExecutiveCumulativeChart({
  title,
  data,
}: {
  title: string;
  data: DashboardCumulativeChartPoint[];
}) {
  const chartData = data.map((point) => ({
    name: point.label.split("/")[0],
    atual: point.currentYear ?? null,
    anterior: point.previousYear ?? 0,
    retrasado: point.twoYearsAgo ?? null,
  }));

  return (
    <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
      <h3 className="mb-4 text-lg font-bold">{title}</h3>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => formatExecutiveCompactCurrency(Number(v)).replace("R$ ", "")}
            />
            <Tooltip formatter={(value: number) => formatExecutiveCurrency(value)} />
            <Legend />
            <Line type="monotone" dataKey="anterior" name="Ano anterior" stroke="hsl(var(--muted-foreground))" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="retrasado" name="Ano retrasado" stroke="hsl(var(--muted-foreground) / 0.5)" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="atual" name="Ano atual" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

export function ExecutiveRealizedVsProjectedChart({
  title,
  data,
}: {
  title: string;
  data: BillingRealizedVsProjected;
}) {
  const chartData = [
    { name: "Realizado", valor: data.realized ?? 0 },
    { name: "Projeção", valor: data.projected ?? 0 },
    { name: "Meta", valor: data.target ?? 0 },
  ];

  return (
    <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
      <h3 className="mb-4 text-lg font-bold">{title}</h3>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => formatExecutiveCompactCurrency(Number(v)).replace("R$ ", "")}
            />
            <Tooltip formatter={(value: number) => formatExecutiveCurrency(value)} />
            <Bar dataKey="valor" name="Valor" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

export function ExecutiveTargetPanel({
  title,
  target,
}: {
  title: string;
  target: {
    formatted: {
      actual: string;
      previousPeriod: string;
      target: string;
      gap: string;
      achievementPercent: string;
    };
  };
}) {
  return (
    <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
      <h3 className="mb-4 text-lg font-bold">{title}</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { label: "Realizado", value: target.formatted.actual },
          { label: "Ano/mês anterior", value: target.formatted.previousPeriod },
          { label: "Meta (+30%)", value: target.formatted.target },
          { label: "Diferença p/ meta", value: target.formatted.gap },
          { label: "% atingimento", value: target.formatted.achievementPercent },
        ].map((item) => (
          <div key={item.label} className="rounded-2xl border border-border bg-accent/20 p-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{item.label}</p>
            <p className="mt-1 truncate text-lg font-black" title={item.value}>
              {item.value}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
