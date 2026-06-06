import React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DashboardChartPoint } from "@/src/lib/executiveDashboardTypes";
import { formatExecutiveCompactCurrency, formatExecutiveCurrency } from "@/src/lib/executiveDashboardFormatters";

type Props = {
  title: string;
  data: DashboardChartPoint[];
  showTarget?: boolean;
};

export function ExecutiveMonthlyChart({ title, data, showTarget = true }: Props) {
  const chartData = data.map((point) => ({
    name: point.label.split("/")[0],
    atual: point.currentYear ?? 0,
    anterior: point.previousYear ?? 0,
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
                    : "Meta",
              ]}
            />
            <Legend />
            <Bar dataKey="anterior" name="Ano anterior" fill="hsl(var(--muted-foreground) / 0.35)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="atual" name="Ano atual" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            {showTarget ? (
              <Bar dataKey="meta" name="Meta" fill="hsl(var(--chart-2, 142 76% 36%))" radius={[4, 4, 0, 0]} />
            ) : null}
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
