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
  SalesOrdersAccumulatedPoint,
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
            {config.colors.projectedLine ? (
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

type AccumulatedRow = SalesOrdersAccumulatedPoint & {
  name: string;
  projectedLine: number | null;
};

function AccumulatedExecutiveTooltip({
  active,
  payload,
  config,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload: AccumulatedRow }>;
  config: DashboardChartSeriesConfig;
}) {
  if (!active || !payload?.[0]?.payload) return null;
  const point = payload[0].payload;

  const rows: Array<{ label: string; value: string }> = [
    {
      label: `${config.labels.previousYearBar} (acum.)`,
      value: formatExecutiveCurrency(point.previousYearAccumulated),
    },
  ];

  if (point.currentYearAccumulated != null) {
    rows.push({
      label: `${config.labels.currentYearBar} (acum.)`,
      value: formatExecutiveCurrency(point.currentYearAccumulated),
    });
    rows.push({
      label: `${config.labels.targetLine} (acum.)`,
      value: formatExecutiveCurrency(point.accumulatedTarget),
    });
    if (point.differenceToTarget != null) {
      rows.push({
        label: "Diferença vs meta acumulada",
        value: formatExecutiveCurrency(point.differenceToTarget),
      });
    }
    if (point.achievementPercent != null) {
      rows.push({
        label: "Atingimento acumulado",
        value: `${formatExecutivePercent(point.achievementPercent, 1)}%`,
      });
    }
  } else {
    rows.push({
      label: `${config.labels.targetLine} (acum.)`,
      value: formatExecutiveCurrency(point.accumulatedTarget),
    });
  }

  if (point.projectedAccumulated != null && config.labels.projectedLine) {
    rows.push({
      label: config.labels.projectedLine,
      value: formatExecutiveCurrency(point.projectedAccumulated),
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

export function ExecutiveAccumulatedComboChart({
  title,
  subtitle,
  series,
  config,
}: {
  title: string;
  subtitle?: string;
  series: SalesOrdersAccumulatedPoint[];
  config: DashboardChartSeriesConfig;
}) {
  const data: AccumulatedRow[] = series.map((point) => ({
    ...point,
    name: point.monthLabel,
    projectedLine: point.projectedAccumulated,
  }));

  return (
    <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
      <h3 className="text-lg font-bold">{title}</h3>
      {subtitle ? <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p> : null}
      <div className="mt-4 h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => formatExecutiveCompactCurrency(Number(v)).replace("R$ ", "")}
            />
            <Tooltip content={<AccumulatedExecutiveTooltip config={config} />} />
            <Legend />
            <Line
              type="monotone"
              dataKey="previousYearAccumulated"
              name={config.labels.previousYearBar}
              stroke={config.colors.previousYearBar}
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="currentYearAccumulated"
              name={config.labels.currentYearBar}
              stroke={config.colors.currentYearBar}
              strokeWidth={2.5}
              dot={false}
              connectNulls={false}
            />
            <Line
              type="monotone"
              dataKey="accumulatedTarget"
              name={config.labels.targetLine}
              stroke={config.colors.targetLine}
              strokeWidth={2.5}
              strokeDasharray="4 2"
              dot={false}
            />
            {config.colors.projectedLine ? (
              <Line
                type="monotone"
                dataKey="projectedLine"
                name={config.labels.projectedLine ?? "Projeção"}
                stroke={config.colors.projectedLine}
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={false}
              />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

export function ExecutiveAdministrativeIndicatorsPanel({
  targets,
  projection,
}: {
  targets: import("@/src/lib/executiveDashboardTypes").SalesOrdersTargetsBlock;
  projection: import("@/src/lib/executiveDashboardTypes").SalesOrdersProjectionBlock;
}) {
  const sections = [
    {
      title: "Meta anual",
      hint: targets.annual.hint,
      items: [
        { label: "Meta", value: targets.annual.formatted.target },
        { label: "Base ano anterior", value: targets.annual.formatted.previousPeriod },
        { label: "Realizado YTD", value: targets.annual.formatted.actual },
        { label: "Atingimento", value: targets.annual.formatted.achievementPercent },
        { label: "Crescimento aplicado", value: targets.growthRateLabel },
      ],
    },
    {
      title: `Meta do mês (${targets.monthly.periodLabel})`,
      hint: targets.monthly.hint,
      items: [
        { label: "Meta", value: targets.monthly.formatted.target },
        { label: `Base ${targets.monthly.basePreviousYearLabel}`, value: targets.monthly.formatted.previousPeriod },
        { label: "Realizado", value: targets.monthly.formatted.actual },
        { label: "Diferença vs meta", value: targets.monthly.formattedRealizedMinusTarget },
        { label: "Atingimento", value: targets.monthly.formatted.achievementPercent },
      ],
    },
    {
      title: "Projeção (média YTD)",
      hint: projection.hint,
      items: [
        { label: "Média/dia útil YTD", value: projection.formatted.ytdDailyAverage },
        { label: "Projeção anual", value: projection.formatted.annualProjection },
        { label: "Projeção do mês", value: projection.formatted.monthlyProjection },
        {
          label: "Dias úteis",
          value: `${projection.ytdBusinessDaysElapsed}/${projection.totalBusinessDaysInYear}`,
        },
      ],
    },
  ];

  return (
    <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
      <h3 className="mb-1 text-lg font-bold">Indicadores administrativos</h3>
      <p className="mb-4 text-xs text-muted-foreground">
        Definições de meta, realizado, projeção e atingimento — passe o mouse nos blocos para ver a regra.
      </p>
      <div className="grid gap-4 lg:grid-cols-3">
        {sections.map((section) => (
          <div
            key={section.title}
            className="rounded-2xl border border-border bg-accent/20 p-4"
            title={section.hint}
          >
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {section.title}
            </p>
            <div className="mt-3 space-y-2">
              {section.items.map((item) => (
                <div key={item.label} className="flex items-start justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">{item.label}</span>
                  <span className="font-semibold text-foreground">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
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
  const projectedFill = config.colors.projectedLine ?? config.colors.targetLine;
  const chartData = [
    { name: "Realizado", valor: data.realized ?? 0, fill: config.colors.currentYearBar },
    { name: "Projeção", valor: data.projected ?? 0, fill: projectedFill },
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
