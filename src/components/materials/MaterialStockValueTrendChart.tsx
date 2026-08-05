/**
 * Flutuação semanal do valor de matéria-prima em estoque.
 *
 * Cada ponto é o valor com que a semana FECHOU — a última foto capturada
 * depois das conferências daquela semana. Semanas sem conferência não viram
 * ponto (a série não inventa dado); a linha simplesmente liga as semanas que
 * existem.
 *
 * Todos os números vêm prontos do backend (`/api/materials/stock-value/series`),
 * que agrega com a mesma fórmula do card "Valor em estoque (MP)".
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Loader2, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { formatCurrency } from "@/src/lib/utils";
import {
  MATERIAL_STOCK_VALUE_SERIES_PATH,
  formatWeekAxisLabel,
  type MaterialStockValueSeriesResponse,
  type MaterialStockValueWeekPoint,
} from "@/src/lib/materialStockValueSeries";
import { cn } from "@/src/lib/utils";

const WEEK_OPTIONS = [
  { value: 8, label: "8 semanas" },
  { value: 13, label: "13 semanas" },
  { value: 26, label: "26 semanas" },
  { value: 52, label: "52 semanas" },
];

type ChartRow = {
  weekStart: string;
  label: string;
  value: number;
  snapshotCount: number;
  deltaFromPreviousWeek: number | null;
  deltaPercentFromPreviousWeek: number | null;
  materialsWithStock: number;
};

function toChartRows(weeks: readonly MaterialStockValueWeekPoint[]): ChartRow[] {
  return weeks.map((w) => ({
    weekStart: w.weekStart,
    label: formatWeekAxisLabel(w.weekStart),
    value: w.totalValue,
    snapshotCount: w.snapshotCount,
    deltaFromPreviousWeek: w.deltaFromPreviousWeek,
    deltaPercentFromPreviousWeek: w.deltaPercentFromPreviousWeek,
    materialsWithStock: w.materialsWithStock,
  }));
}

function formatWeekRangeLabel(weekStart: string): string {
  const [y, m, d] = weekStart.split("-");
  return `semana de ${d}/${m}/${y}`;
}

function TrendTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: ChartRow }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  const delta = row.deltaFromPreviousWeek;
  const deltaPct = row.deltaPercentFromPreviousWeek;

  return (
    <div className="min-w-[240px] rounded-lg border border-border bg-card p-2.5 text-xs shadow-md">
      <p className="mb-1 font-bold uppercase tracking-wide text-muted-foreground">
        {formatWeekRangeLabel(row.weekStart)}
      </p>
      <p className="text-base font-extrabold tabular-nums text-foreground">
        {formatCurrency(row.value)}
      </p>
      {delta != null ? (
        <p
          className={cn(
            "mt-1 flex items-center gap-1 font-semibold tabular-nums",
            delta > 0 ? "text-emerald-600" : delta < 0 ? "text-red-600" : "text-muted-foreground"
          )}
        >
          {delta > 0 ? (
            <TrendingUp className="h-3.5 w-3.5" aria-hidden />
          ) : delta < 0 ? (
            <TrendingDown className="h-3.5 w-3.5" aria-hidden />
          ) : null}
          {delta > 0 ? "+" : ""}
          {formatCurrency(delta)}
          {deltaPct != null ? (
            <span className="text-[11px] font-normal">
              ({deltaPct > 0 ? "+" : ""}
              {deltaPct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%)
            </span>
          ) : null}
          <span className="text-[11px] font-normal text-muted-foreground">
            vs. semana anterior
          </span>
        </p>
      ) : (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Primeira semana da série — sem comparação.
        </p>
      )}
      <p className="mt-1.5 border-t border-border/60 pt-1.5 text-[11px] text-muted-foreground">
        {row.materialsWithStock} MP com quantidade ·{" "}
        {row.snapshotCount === 1
          ? "1 conferência na semana"
          : `${row.snapshotCount} conferências na semana`}
      </p>
    </div>
  );
}

export function MaterialStockValueTrendChart() {
  const [weeks, setWeeks] = useState(13);
  const [data, setData] = useState<MaterialStockValueSeriesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (weeksToLoad: number, signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<MaterialStockValueSeriesResponse>(
        `${MATERIAL_STOCK_VALUE_SERIES_PATH}?weeks=${weeksToLoad}`,
        { signal }
      );
      if (!signal?.aborted) setData(payload);
    } catch (err) {
      if (!signal?.aborted) {
        setData(null);
        setError(
          err instanceof Error
            ? err.message
            : "Não foi possível carregar o histórico do valor em estoque."
        );
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(weeks, controller.signal);
    return () => controller.abort();
  }, [load, weeks]);

  const rows = useMemo(() => (data ? toChartRows(data.weeks) : []), [data]);
  const summary = data?.summary ?? null;

  const hasData = rows.length > 0;
  const hasSinglePoint = rows.length === 1;

  return (
    <section
      className="rounded-xl border border-border bg-card p-4 shadow-sm"
      data-testid="material-stock-value-trend"
    >
      <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Valor em estoque (MP) — flutuação semanal
          </h2>
          <p className="text-xs text-muted-foreground">
            Cada ponto é o valor com que a semana fechou, após as conferências
            de estoque daquele período.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="inline-flex rounded-lg border border-border bg-background p-0.5"
            role="group"
            aria-label="Janela do histórico"
          >
            {WEEK_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setWeeks(opt.value)}
                className={cn(
                  "rounded px-2 py-1 text-[11px] font-semibold transition",
                  weeks === opt.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
                data-testid={`material-stock-value-weeks-${opt.value}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void load(weeks)}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 text-[11px] font-semibold hover:bg-accent disabled:opacity-50"
            data-testid="material-stock-value-refresh"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            )}
            Atualizar
          </button>
        </div>
      </header>

      {loading && !data ? (
        <p className="py-10 text-center text-xs text-muted-foreground">
          Carregando histórico…
        </p>
      ) : error ? (
        <div
          className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
          role="alert"
        >
          {error}
        </div>
      ) : !hasData ? (
        <div
          className="flex flex-col items-center justify-center gap-1 py-10 text-center"
          data-testid="material-stock-value-empty"
        >
          <p className="text-sm font-semibold text-foreground">
            Ainda não há histórico para montar o gráfico.
          </p>
          <p className="max-w-md text-xs text-muted-foreground">
            O valor em estoque passa a ser fotografado a cada conferência
            registrada em <strong>Conferência de estoque</strong>. Após a
            primeira semana de lançamentos, a flutuação aparece aqui.
          </p>
        </div>
      ) : (
        <>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={rows}
                margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11 }}
                  className="fill-muted-foreground"
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  className="fill-muted-foreground"
                  tickFormatter={(v: number) =>
                    v.toLocaleString("pt-BR", {
                      notation: "compact",
                      maximumFractionDigits: 1,
                    })
                  }
                />
                <Tooltip content={<TrendTooltip />} />
                <ReferenceLine y={0} className="stroke-border" />
                <Line
                  type="monotone"
                  dataKey="value"
                  name="Valor em estoque (MP)"
                  className="stroke-primary"
                  strokeWidth={2.5}
                  // Um único ponto não desenha linha — o dot garante que
                  // a primeira semana já apareça no gráfico.
                  dot={hasSinglePoint ? { r: 5 } : { r: 3 }}
                  activeDot={{ r: 5 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {summary ? (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <SummaryTile
                label="Última semana"
                value={summary.latestValue}
                delta={summary.latestDelta}
                deltaPercent={summary.latestDeltaPercent}
              />
              <SummaryTile label="Maior no período" value={summary.maxValue} />
              <SummaryTile label="Menor no período" value={summary.minValue} />
              <div className="rounded-lg border border-border bg-background px-3 py-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  Cobertura
                </p>
                <p className="mt-0.5 text-sm font-bold tabular-nums text-foreground">
                  {summary.weeksWithData}{" "}
                  {summary.weeksWithData === 1 ? "semana" : "semanas"}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {summary.totalSnapshots}{" "}
                  {summary.totalSnapshots === 1 ? "conferência" : "conferências"}
                </p>
              </div>
            </div>
          ) : null}

          {hasSinglePoint ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Só há uma semana com dado até agora — a linha de tendência aparece
              a partir da segunda semana de conferências.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

function SummaryTile({
  label,
  value,
  delta,
  deltaPercent,
}: {
  label: string;
  value: number | null;
  delta?: number | null;
  deltaPercent?: number | null;
}) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 truncate text-sm font-bold tabular-nums text-foreground">
        {value != null ? formatCurrency(value) : "—"}
      </p>
      {delta != null ? (
        <p
          className={cn(
            "text-[10px] font-semibold tabular-nums",
            delta > 0 ? "text-emerald-600" : delta < 0 ? "text-red-600" : "text-muted-foreground"
          )}
        >
          {delta > 0 ? "+" : ""}
          {formatCurrency(delta)}
          {deltaPercent != null
            ? ` (${deltaPercent > 0 ? "+" : ""}${deltaPercent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%)`
            : ""}
        </p>
      ) : null}
    </div>
  );
}
