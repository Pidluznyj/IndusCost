import React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
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
  DashboardChartSeriesConfig,
  DashboardCumulativeChartPoint,
  DashboardMonthlySeriesPoint,
} from "@/src/lib/executiveDashboardTypes";
import {
  formatExecutiveCompactCurrency,
  formatExecutiveCurrency,
  formatExecutivePercent,
} from "@/src/lib/executiveDashboardFormatters";

type ComboRow = DashboardMonthlySeriesPoint & {
  name: string;
  currentYearBar: number | null;
  projectedLine: number | null;
};

function buildComboRows(series: DashboardMonthlySeriesPoint[]): ComboRow[] {
  return series.map((point) => ({
    ...point,
    name: point.monthLabel,
    currentYearBar: point.currentYearValue,
    projectedLine: point.projectedValue,
  }));
}

function MonthlyExecutiveTooltip({
  active,
  payload,
  config,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload: ComboRow }>;
  config: DashboardChartSeriesConfig;
}) {
  if (!active || !payload?.[0]?.payload) return null;
  const point = payload[0].payload;

  const rows: Array<{ label: string; value: string }> = [
    { label: config.labels.previousYearBar, value: formatExecutiveCurrency(point.previousYearValue) },
  ];

  if (point.currentYearValue != null) {
    rows.push({
      label: config.labels.currentYearBar,
      value: formatExecutiveCurrency(point.currentYearValue),
    });
    rows.push({
      label: `${config.labels.targetLine} (vs ${config.previousYear} × 1,30)`,
      value: formatExecutiveCurrency(point.targetValue),
    });
    if (point.differenceToTarget != null) {
      rows.push({
        label: "Diferença vs meta",
        value: formatExecutiveCurrency(point.differenceToTarget),
      });
    }
    if (point.achievementPercent != null) {
      rows.push({
        label: "Atingimento",
        value: `${formatExecutivePercent(point.achievementPercent, 1)}%`,
      });
    }
  } else {
    rows.push({
      label: config.labels.targetLine,
      value: formatExecutiveCurrency(point.targetValue),
    });
  }

  if (point.projectedValue != null && config.labels.projectedLine) {
    rows.push({
      label: config.labels.projectedLine,
      value: formatExecutiveCurrency(point.projectedValue),
    });
  }

  return (
    <div className="max-w-xs rounded-lg border border-border bg-card p-3 text-xs shadow-lg">
      <p className="mb-2 font-bold text-foreground">{point.periodLabel}</p>
      <div className="space-y-1">
        {rows.map((row) => (
          <div key={row.label} className="flex items-start justify-between gap-3">
            <span className="text-muted-foreground">{row.label}</span>
            <span className="font-semibold text-foreground">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ExecutiveMonthlyComboChart({
  title,
  series,
  config,
}: {
  title: string;
  series: DashboardMonthlySeriesPoint[];
  config: DashboardChartSeriesConfig;
}) {
  const data = buildComboRows(series);

  return (
    <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
      <h3 className="mb-4 text-lg font-bold">{title}</h3>
      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => formatExecutiveCompactCurrency(Number(v)).replace("R$ ", "")}
            />
            <Tooltip content={<MonthlyExecutiveTooltip config={config} />} />
            <Legend />
            <Bar
              dataKey="previousYearValue"
              name={config.labels.previousYearBar}
              fill={config.colors.previousYearBar}
              radius={[4, 4, 0, 0]}
              maxBarSize={36}
            />
            <Bar
              dataKey="currentYearBar"
              name={config.labels.currentYearBar}
              fill={config.colors.currentYearBar}
              radius={[4, 4, 0, 0]}
              maxBarSize={36}
            />
            <Line
              type="monotone"
              dataKey="targetValue"
              name={config.labels.targetLine}
              stroke={config.colors.targetLine}
              strokeWidth={2.5}
              dot={false}
            />
            {config.kind === "billing" && config.colors.projectedLine ? (
              <Line
                type="monotone"
                dataKey="projectedLine"
                name={config.labels.projectedLine ?? "Projeção"}
                stroke={config.colors.projectedLine}
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={{ r: 3 }}
                connectNulls={false}
              />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

export function ExecutiveCumulativeChart({
  title,
  data,
  config,
}: {
  title: string;
  data: DashboardCumulativeChartPoint[];
  config: DashboardChartSeriesConfig;
}) {
  const chartData = data.map((point) => ({
    name: point.label.split("/")[0],
    anterior: point.previousYear ?? 0,
    atual: point.currentYear ?? null,
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
            <Line
              type="monotone"
              dataKey="anterior"
              name={config.labels.previousYearBar}
              stroke={config.colors.previousYearBar}
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="atual"
              name={config.labels.currentYearBar}
              stroke={config.colors.currentYearBar}
              strokeWidth={2.5}
              dot={false}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

export function ExecutiveRealizedVsProjectedChart({
  title,
  data,
  config,
}: {
  title: string;
  data: BillingRealizedVsProjected;
  config: DashboardChartSeriesConfig;
}) {
  const chartData = [
    { name: "Realizado", valor: data.realized ?? 0, fill: config.colors.currentYearBar },
    { name: "Projeção", valor: data.projected ?? 0, fill: config.colors.projectedLine ?? "#1565C0" },
    { name: "Meta", valor: data.target ?? 0, fill: config.colors.targetLine },
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
            <Bar dataKey="valor" name="Valor" radius={[4, 4, 0, 0]}>
              {chartData.map((entry) => (
                <Cell key={entry.name} fill={entry.fill} />
              ))}
            </Bar>
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
          { label: "Período anterior", value: target.formatted.previousPeriod },
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
