/**
 * Gráficos da aba Performance (recharts). Recebem séries prontas do read model;
 * não recalculam valores — apenas formatam eixos e tooltips.
 */
import React, { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { FINANCE_BI_COLORS } from "@/src/lib/financeBiDashboardTheme";
import type {
  DashboardEvaluationBand,
  DashboardMonthlyPoint,
  DashboardParetoRow,
  DashboardPriceSeries,
  DashboardScoreVsSpendPoint,
} from "@/src/lib/purchasing/supplierPerformanceDashboard";
import {
  formatDashboardInteger,
  formatDashboardMoney,
  formatDashboardMoneyCompact,
  formatDashboardMonth,
  formatDashboardPercent,
  formatDashboardPrice,
  formatDashboardScore,
} from "@/src/lib/purchasing/supplierPerformanceDashboardUi";

const CHART_HEIGHT = 280;
const SERIES_COLORS = [
  FINANCE_BI_COLORS.primary,
  FINANCE_BI_COLORS.success,
  FINANCE_BI_COLORS.warning,
  "#7C3AED",
  "#0891B2",
  "#DB2777",
  "#4B5563",
  "#65A30D",
];

function ChartTooltipBox({ title, rows }: { title: string; rows: Array<{ label: string; value: string }> }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-semibold text-foreground">{title}</p>
      {rows.map((row) => (
        <p key={row.label} className="text-muted-foreground">
          {row.label}: <span className="font-medium text-foreground">{row.value}</span>
        </p>
      ))}
    </div>
  );
}

function ChartEmpty({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center rounded-md border border-dashed border-border bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

function truncate(text: string, max = 22): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/* ------------------------------------------------------------------ */

export const PARETO_LIMIT_OPTIONS = [
  { id: 10, label: "Top 10" },
  { id: 20, label: "Top 20" },
  { id: 0, label: "Todos" },
] as const;

export function SupplierParetoChart({
  rows,
  currency,
  onSelectSupplier,
}: {
  rows: DashboardParetoRow[];
  currency: string;
  onSelectSupplier?: (supplierExternalId: number) => void;
}) {
  const [limit, setLimit] = useState<number>(10);
  const data = useMemo(() => {
    const visible = limit === 0 ? rows : rows.slice(0, limit);
    return visible.map((row) => ({
      ...row,
      label: truncate(row.name),
      cumulativePct: row.cumulativeShare == null ? null : row.cumulativeShare * 100,
    }));
  }, [rows, limit]);

  if (rows.length === 0) return <ChartEmpty message="Sem fornecedores com valor comprado na população filtrada." />;

  return (
    <div className="space-y-2" data-testid="supplier-pareto-chart">
      <div className="flex flex-wrap items-center justify-end gap-1">
        {PARETO_LIMIT_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setLimit(option.id)}
            aria-pressed={limit === option.id}
            className={
              limit === option.id
                ? "rounded-md bg-white px-2 py-1 text-xs font-semibold text-foreground shadow-sm ring-1 ring-border"
                : "rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-white/70 hover:text-foreground"
            }
          >
            {option.label}
          </button>
        ))}
      </div>
      <div style={{ width: "100%", height: CHART_HEIGHT }}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 48, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={FINANCE_BI_COLORS.border} />
            <XAxis dataKey="label" interval={0} angle={-35} textAnchor="end" tick={{ fontSize: 10 }} height={60} />
            <YAxis yAxisId="spend" tickFormatter={(value: number) => formatDashboardMoneyCompact(value, currency)} tick={{ fontSize: 10 }} width={80} />
            <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} tickFormatter={(value: number) => `${value}%`} tick={{ fontSize: 10 }} width={40} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0]!.payload as (typeof data)[number];
                return (
                  <ChartTooltipBox
                    title={row.name}
                    rows={[
                      { label: "Valor comprado", value: formatDashboardMoney(row.spend, currency) },
                      { label: "Share", value: formatDashboardPercent(row.share) },
                      { label: "Acumulado", value: formatDashboardPercent(row.cumulativeShare) },
                      { label: "Pedidos", value: formatDashboardInteger(row.orderCount) },
                      { label: "Mix de MPs", value: formatDashboardInteger(row.mixCount) },
                    ]}
                  />
                );
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar
              yAxisId="spend"
              dataKey="spend"
              name="Valor comprado"
              fill={FINANCE_BI_COLORS.primary}
              radius={[3, 3, 0, 0]}
              cursor={onSelectSupplier ? "pointer" : undefined}
              onClick={(entry: unknown) => {
                const row = (entry as { payload?: DashboardParetoRow })?.payload ?? (entry as DashboardParetoRow);
                if (row?.supplierExternalId != null) onSelectSupplier?.(row.supplierExternalId);
              }}
            />
            <Line yAxisId="pct" type="monotone" dataKey="cumulativePct" name="% acumulado" stroke={FINANCE_BI_COLORS.warning} strokeWidth={2} dot={{ r: 2 }} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function SupplierSpendChart({
  rows,
  currency,
  onSelectSupplier,
}: {
  rows: DashboardParetoRow[];
  currency: string;
  onSelectSupplier?: (supplierExternalId: number) => void;
}) {
  const data = useMemo(() => rows.slice(0, 10).map((row) => ({ ...row, label: truncate(row.name, 28) })), [rows]);
  if (data.length === 0) return <ChartEmpty message="Sem fornecedores com valor comprado na população filtrada." />;
  return (
    <div style={{ width: "100%", height: Math.max(200, data.length * 30) }} data-testid="supplier-spend-chart">
      <ResponsiveContainer>
        <ComposedChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={FINANCE_BI_COLORS.border} horizontal={false} />
          <XAxis type="number" tickFormatter={(value: number) => formatDashboardMoneyCompact(value, currency)} tick={{ fontSize: 10 }} />
          <YAxis type="category" dataKey="label" width={170} tick={{ fontSize: 10 }} />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0]!.payload as DashboardParetoRow;
              return (
                <ChartTooltipBox
                  title={row.name}
                  rows={[
                    { label: "Valor", value: formatDashboardMoney(row.spend, currency) },
                    { label: "Share", value: formatDashboardPercent(row.share) },
                    { label: "Pedidos", value: formatDashboardInteger(row.orderCount) },
                    { label: "Mix", value: formatDashboardInteger(row.mixCount) },
                  ]}
                />
              );
            }}
          />
          <Bar
            dataKey="spend"
            name="Valor comprado"
            fill={FINANCE_BI_COLORS.primary}
            radius={[0, 3, 3, 0]}
            cursor={onSelectSupplier ? "pointer" : undefined}
            onClick={(entry: unknown) => {
              const row = (entry as { payload?: DashboardParetoRow })?.payload ?? (entry as DashboardParetoRow);
              if (row?.supplierExternalId != null) onSelectSupplier?.(row.supplierExternalId);
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PurchaseTrendChart({
  points,
  currency,
  showSuppliers = true,
}: {
  points: Array<Pick<DashboardMonthlyPoint, "month" | "spend" | "orderCount"> & Partial<DashboardMonthlyPoint>>;
  currency: string;
  showSuppliers?: boolean;
}) {
  const data = useMemo(() => points.map((point) => ({ ...point, label: formatDashboardMonth(point.month) })), [points]);
  if (data.length === 0 || data.every((point) => point.orderCount === 0)) {
    return <ChartEmpty message="Sem compras no período para montar a evolução mensal." />;
  }
  return (
    <div style={{ width: "100%", height: CHART_HEIGHT }} data-testid="purchase-trend-chart">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={FINANCE_BI_COLORS.border} />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} />
          <YAxis yAxisId="spend" tickFormatter={(value: number) => formatDashboardMoneyCompact(value, currency)} tick={{ fontSize: 10 }} width={80} />
          <YAxis yAxisId="count" orientation="right" allowDecimals={false} tick={{ fontSize: 10 }} width={40} />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0]!.payload as (typeof data)[number];
              const rows = [
                { label: "Valor comprado", value: formatDashboardMoney(row.spend, currency) },
                { label: "Pedidos", value: formatDashboardInteger(row.orderCount) },
              ];
              if (row.activeSuppliers != null) rows.push({ label: "Fornecedores ativos", value: formatDashboardInteger(row.activeSuppliers) });
              if (row.materialCount != null) rows.push({ label: "MPs distintas", value: formatDashboardInteger(row.materialCount) });
              return <ChartTooltipBox title={row.label} rows={rows} />;
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar yAxisId="spend" dataKey="spend" name="Valor comprado" fill={FINANCE_BI_COLORS.primary} radius={[3, 3, 0, 0]} />
          <Line yAxisId="count" type="monotone" dataKey="orderCount" name="Pedidos" stroke={FINANCE_BI_COLORS.warning} strokeWidth={2} dot={{ r: 2 }} />
          {showSuppliers && data.some((point) => point.activeSuppliers != null) ? (
            <Line yAxisId="count" type="monotone" dataKey="activeSuppliers" name="Fornecedores ativos" stroke={FINANCE_BI_COLORS.success} strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
          ) : null}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function EvaluationDistributionChart({ bands }: { bands: DashboardEvaluationBand[] }) {
  const data = bands;
  if (data.every((band) => band.orders === 0 && band.suppliers === 0)) {
    return <ChartEmpty message="Sem avaliações V2 (escala 1–5) no período." />;
  }
  return (
    <div style={{ width: "100%", height: 220 }} data-testid="evaluation-distribution-chart">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={FINANCE_BI_COLORS.border} />
          <XAxis dataKey="band" tick={{ fontSize: 10 }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={40} />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0]!.payload as DashboardEvaluationBand;
              return (
                <ChartTooltipBox
                  title={`Faixa ${row.band}`}
                  rows={[
                    { label: "Avaliações (pedidos)", value: formatDashboardInteger(row.orders) },
                    { label: "Fornecedores (média)", value: formatDashboardInteger(row.suppliers) },
                  ]}
                />
              );
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="orders" name="Avaliações (pedidos)" fill={FINANCE_BI_COLORS.primary} radius={[3, 3, 0, 0]} />
          <Bar dataKey="suppliers" name="Fornecedores (nota média)" fill={FINANCE_BI_COLORS.success} radius={[3, 3, 0, 0]} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ScoreVsSpendChart({
  points,
  currency,
  scaleMax,
  onSelectSupplier,
}: {
  points: DashboardScoreVsSpendPoint[];
  currency: string;
  scaleMax: number;
  onSelectSupplier?: (supplierExternalId: number) => void;
}) {
  if (points.length === 0) return <ChartEmpty message="Sem fornecedores com nota V2 e valor comprado no período." />;
  return (
    <div style={{ width: "100%", height: CHART_HEIGHT }} data-testid="score-vs-spend-chart">
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={FINANCE_BI_COLORS.border} />
          <XAxis type="number" dataKey="spend" name="Valor comprado" tickFormatter={(value: number) => formatDashboardMoneyCompact(value, currency)} tick={{ fontSize: 10 }} />
          <YAxis type="number" dataKey="score" name="Nota" domain={[1, scaleMax]} tick={{ fontSize: 10 }} width={40} />
          <ZAxis type="number" dataKey="orderCount" range={[40, 400]} name="Pedidos" />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0]!.payload as DashboardScoreVsSpendPoint;
              return (
                <ChartTooltipBox
                  title={row.name}
                  rows={[
                    { label: "Nota V2", value: formatDashboardScore(row.score, scaleMax) },
                    { label: "Valor comprado", value: formatDashboardMoney(row.spend, currency) },
                    { label: "Pedidos", value: formatDashboardInteger(row.orderCount) },
                    { label: "Pedidos avaliados", value: formatDashboardInteger(row.evaluatedOrders) },
                  ]}
                />
              );
            }}
          />
          <Scatter
            data={points}
            fill={FINANCE_BI_COLORS.primary}
            fillOpacity={0.7}
            cursor={onSelectSupplier ? "pointer" : undefined}
            onClick={(entry: unknown) => {
              const row = (entry as { payload?: DashboardScoreVsSpendPoint })?.payload ?? (entry as DashboardScoreVsSpendPoint);
              if (row?.supplierExternalId != null) onSelectSupplier?.(row.supplierExternalId);
            }}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PriceEvolutionChart({ series, currency }: { series: DashboardPriceSeries[]; currency: string }) {
  const { data, keys } = useMemo(() => {
    const months = new Set<string>();
    for (const line of series) for (const point of line.points) months.add(point.month);
    const sorted = [...months].sort();
    const keys = series.map((line, index) => ({
      key: `s${index}`,
      label: `${line.supplierName}${line.unit ? ` (${line.unit})` : ""}`,
      unit: line.unit,
      color: SERIES_COLORS[index % SERIES_COLORS.length]!,
    }));
    const data = sorted.map((month) => {
      const row: Record<string, number | string | null> = { month, label: formatDashboardMonth(month) };
      series.forEach((line, index) => {
        const point = line.points.find((p) => p.month === month);
        row[`s${index}`] = point ? point.weightedAveragePrice : null;
      });
      return row;
    });
    return { data, keys };
  }, [series]);

  if (series.length === 0) return <ChartEmpty message="Sem preço comparável (linha com valor e quantidade) para esta matéria-prima." />;
  const units = new Set(series.map((line) => line.unit ?? "—"));
  return (
    <div className="space-y-1" data-testid="price-evolution-chart">
      {units.size > 1 ? (
        <p className="text-[11px] text-amber-700">
          Unidades diferentes observadas ({[...units].join(", ")}): cada série mantém a própria unidade; não são comparáveis entre si.
        </p>
      ) : null}
      <div style={{ width: "100%", height: CHART_HEIGHT }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={FINANCE_BI_COLORS.border} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis tickFormatter={(value: number) => formatDashboardPrice(value, currency, null)} tick={{ fontSize: 10 }} width={90} />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                return (
                  <ChartTooltipBox
                    title={String(label)}
                    rows={payload
                      .filter((entry) => entry.value != null)
                      .map((entry) => {
                        const meta = keys.find((k) => k.key === entry.dataKey);
                        return { label: meta?.label ?? String(entry.name), value: formatDashboardPrice(Number(entry.value), currency, meta?.unit ?? null) };
                      })}
                  />
                );
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {keys.map((meta) => (
              <Line key={meta.key} type="monotone" dataKey={meta.key} name={meta.label} stroke={meta.color} strokeWidth={2} dot={{ r: 2 }} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
