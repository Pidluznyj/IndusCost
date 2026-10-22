import React, { useId } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TrendingUp } from "lucide-react";
import {
  BRENT_PRICE_KIND_LABEL,
  formatBrentPricePt,
  formatCollectedAtPt,
  formatMarketPercentPt,
  formatPtaxRatePt,
  formatQuoteDatePt,
  MARKET_HISTORY_ACCUMULATED_NOTE,
  MARKET_HISTORY_RANGE_OPTIONS,
  MARKET_TRENDS_EMPTY_MESSAGE,
  MARKET_TRENDS_PARTIAL_NOTE,
  MARKET_TRENDS_SINGLE_POINT_MESSAGE,
  type MarketBrentHistoryPoint,
  type MarketGlobalIndicatorsHistoryDto,
  type MarketHistoryRange,
  type MarketHistorySummary,
  type MarketPtaxHistoryPoint,
} from "@/src/lib/marketGlobalIndicatorsHistory";

const SELL_COLOR = "#2563EB";
const BUY_COLOR = "#64748B";
const BRENT_COLOR = "#0F766E";

export type MarketTrendsPanelProps = {
  range: MarketHistoryRange;
  onRangeChange: (range: MarketHistoryRange) => void;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  data: MarketGlobalIndicatorsHistoryDto | null;
};

function variationClass(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value === 0) return "text-muted-foreground";
  return value > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400";
}

function yDomain(values: number[]): [number, number] | ["auto", "auto"] {
  if (values.length === 0) return ["auto", "auto"];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    const pad = Math.max(Math.abs(min) * 0.01, 0.0001);
    return [min - pad, max + pad];
  }
  const pad = (max - min) * 0.12;
  return [min - pad, max + pad];
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`truncate text-sm font-semibold tabular-nums ${tone ?? "text-foreground"}`}>{value}</p>
    </div>
  );
}

function summaryValue(summary: MarketHistorySummary, format: (value: number) => string): string {
  return summary.lastValue == null ? "—" : format(summary.lastValue);
}

function TrendChartFrame({
  title,
  subtitle,
  testId,
  summary,
  children,
  singlePoint,
}: {
  title: string;
  subtitle: string;
  testId: string;
  summary: MarketHistorySummary;
  children: React.ReactNode;
  singlePoint: boolean;
}) {
  return (
    <article
      className="min-w-0 space-y-3 overflow-hidden rounded-xl border border-border bg-card p-4"
      data-testid={testId}
    >
      <div>
        <h4 className="text-sm font-semibold text-foreground">{title}</h4>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {summary.observationCount === 0 ? (
        <p className="py-10 text-sm text-muted-foreground" data-testid={`${testId}-empty`}>
          {MARKET_TRENDS_EMPTY_MESSAGE}
        </p>
      ) : (
        <>
          {children}
          {singlePoint ? (
            <p className="text-xs text-muted-foreground" data-testid={`${testId}-single`}>
              {MARKET_TRENDS_SINGLE_POINT_MESSAGE}
            </p>
          ) : null}
        </>
      )}
    </article>
  );
}

function PtaxTooltip({
  active,
  label,
  points,
}: {
  active?: boolean;
  label?: string | number;
  points: MarketPtaxHistoryPoint[];
}) {
  if (!active || label == null) return null;
  const point = points.find((item) => item.quoteDate === String(label));
  if (!point) return null;
  return (
    <div className="min-w-[220px] space-y-1 rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-sm" data-testid="market-trends-ptax-tooltip">
      <p className="font-semibold text-foreground">{formatQuoteDatePt(point.quoteDate)}</p>
      <p>PTAX venda: {formatPtaxRatePt(point.sellRate)}</p>
      <p>PTAX compra: {formatPtaxRatePt(point.buyRate)}</p>
      <p>Variação diária da venda: {formatMarketPercentPt(point.sellDailyChangePct) ?? "—"}</p>
      <p>Fonte: {point.source}</p>
      <p>Coleta: {formatCollectedAtPt(point.collectedAt)}</p>
    </div>
  );
}

function BrentTooltip({
  active,
  label,
  points,
}: {
  active?: boolean;
  label?: string | number;
  points: MarketBrentHistoryPoint[];
}) {
  if (!active || label == null) return null;
  const point = points.find((item) => item.quoteDate === String(label));
  if (!point) return null;
  return (
    <div className="min-w-[220px] space-y-1 rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-sm" data-testid="market-trends-brent-tooltip">
      <p className="font-semibold text-foreground">{formatQuoteDatePt(point.quoteDate)}</p>
      <p>Preço: {formatBrentPricePt(point.priceUsd)} / barril</p>
      <p>Variação diária: {formatMarketPercentPt(point.dailyChangePct) ?? "—"}</p>
      <p>{BRENT_PRICE_KIND_LABEL}</p>
      <p>Fonte: {point.source}</p>
      <p>Coleta: {formatCollectedAtPt(point.collectedAt)}</p>
    </div>
  );
}

function axisTick(value: string): string {
  return formatQuoteDatePt(value).slice(0, 5);
}

export function MarketGlobalIndicatorsTrendsPanel({
  range,
  onRangeChange,
  loading,
  error,
  onRetry,
  data,
}: MarketTrendsPanelProps) {
  const titleId = useId();
  const ptaxPoints = data?.ptax.points ?? [];
  const brentPoints = data?.brent.points ?? [];
  const ptaxDomain = yDomain(ptaxPoints.flatMap((point) => [point.sellRate, point.buyRate]));
  const brentDomain = yDomain(brentPoints.map((point) => point.priceUsd));

  return (
    <section
      className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-sm"
      data-testid="market-trends-section"
      aria-labelledby={titleId}
    >
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Mercado</p>
          <h3 id={titleId} className="text-sm font-bold text-foreground">Tendências de Mercado</h3>
        </div>
        <div className="inline-flex rounded-lg border border-border p-0.5" role="group" aria-label="Período do histórico" data-testid="market-trends-range">
          {MARKET_HISTORY_RANGE_OPTIONS.map((option) => {
            const selected = option.id === range;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={selected}
                onClick={() => onRangeChange(option.id)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                  selected ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "text-muted-foreground hover:bg-accent"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </header>
      <div className="space-y-1">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <TrendingUp className="h-4 w-4 shrink-0" aria-hidden="true" />
          Acompanhe a evolução diária do dólar PTAX e do petróleo Brent para apoiar decisões de compras, custos e planejamento industrial.
        </p>
        {data ? (
          <p className="text-xs text-muted-foreground" data-testid="market-trends-window">
            {formatQuoteDatePt(data.windowStart)} – {formatQuoteDatePt(data.windowEnd)} · {data.timezone}
          </p>
        ) : null}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2" data-testid="market-trends-loading" aria-busy="true">
          <div className="h-72 animate-pulse rounded-xl border border-border bg-muted/40" />
          <div className="h-72 animate-pulse rounded-xl border border-border bg-muted/40" />
        </div>
      ) : null}

      {!loading && error ? (
        <div className="space-y-3" data-testid="market-trends-error">
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</div>
          <button type="button" onClick={onRetry} className="text-sm font-semibold text-primary hover:underline">
            Tentar novamente
          </button>
        </div>
      ) : null}

      {!loading && !error && data ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <TrendChartFrame
            title="Dólar PTAX — evolução diária"
            subtitle="Compra e venda em R$ por US$"
            testId="market-trends-ptax"
            summary={data.ptax.sell}
            singlePoint={data.ptax.sell.observationCount === 1}
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="market-trends-ptax-stats">
              <Stat label="Venda" value={summaryValue(data.ptax.sell, formatPtaxRatePt)} />
              <Stat label="Compra" value={summaryValue(data.ptax.buy, formatPtaxRatePt)} />
              <Stat
                label="Variação diária"
                value={formatMarketPercentPt(data.ptax.sell.dailyChangePct) ?? "—"}
                tone={variationClass(data.ptax.sell.dailyChangePct)}
              />
              <Stat
                label="Acumulado"
                value={formatMarketPercentPt(data.ptax.sell.accumulatedChangePct) ?? "—"}
                tone={variationClass(data.ptax.sell.accumulatedChangePct)}
              />
            </div>
            <div className="h-64 w-full min-w-0" role="img" aria-label="Gráfico diário da PTAX compra e venda">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <LineChart data={ptaxPoints} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#94a3b8" strokeOpacity={0.35} vertical={false} />
                  <XAxis dataKey="quoteDate" tickFormatter={axisTick} minTickGap={28} tick={{ fontSize: 11 }} />
                  <YAxis
                    domain={ptaxDomain}
                    tickFormatter={(value: number) => formatPtaxRatePt(value).replace("R$ ", "")}
                    width={64}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip content={(props) => <PtaxTooltip active={props.active} label={props.label} points={ptaxPoints} />} />
                  <Legend />
                  <Line type="linear" dataKey="sellRate" name="PTAX venda" stroke={SELL_COLOR} strokeWidth={2} dot={{ r: 2.5 }} connectNulls={false} isAnimationActive={false} />
                  <Line type="linear" dataKey="buyRate" name="PTAX compra" stroke={BUY_COLOR} strokeWidth={1.5} strokeDasharray="4 3" dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </TrendChartFrame>

          <TrendChartFrame
            title="Petróleo Brent — evolução diária"
            subtitle={`${BRENT_PRICE_KIND_LABEL}, em US$ por barril`}
            testId="market-trends-brent"
            summary={data.brent.summary}
            singlePoint={data.brent.summary.observationCount === 1}
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="market-trends-brent-stats">
              <Stat label="Último preço" value={summaryValue(data.brent.summary, formatBrentPricePt)} />
              <Stat
                label="Variação diária"
                value={formatMarketPercentPt(data.brent.summary.dailyChangePct) ?? "—"}
                tone={variationClass(data.brent.summary.dailyChangePct)}
              />
              <Stat
                label="Acumulado"
                value={formatMarketPercentPt(data.brent.summary.accumulatedChangePct) ?? "—"}
                tone={variationClass(data.brent.summary.accumulatedChangePct)}
              />
              <Stat
                label="Máximo"
                value={data.brent.summary.max ? `${formatBrentPricePt(data.brent.summary.max.value)} · ${formatQuoteDatePt(data.brent.summary.max.quoteDate)}` : "—"}
              />
              <Stat
                label="Mínimo"
                value={data.brent.summary.min ? `${formatBrentPricePt(data.brent.summary.min.value)} · ${formatQuoteDatePt(data.brent.summary.min.quoteDate)}` : "—"}
              />
            </div>
            <div className="h-64 w-full min-w-0" role="img" aria-label="Gráfico diário do petróleo Brent em dólar por barril">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <LineChart data={brentPoints} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#94a3b8" strokeOpacity={0.35} vertical={false} />
                  <XAxis dataKey="quoteDate" tickFormatter={axisTick} minTickGap={28} tick={{ fontSize: 11 }} />
                  <YAxis
                    domain={brentDomain}
                    tickFormatter={(value: number) => formatBrentPricePt(value).replace("US$ ", "")}
                    width={64}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip content={(props) => <BrentTooltip active={props.active} label={props.label} points={brentPoints} />} />
                  <Legend />
                  <Line type="linear" dataKey="priceUsd" name="USD/barril" stroke={BRENT_COLOR} strokeWidth={2} dot={{ r: 2.5 }} connectNulls={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </TrendChartFrame>
        </div>
      ) : null}
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {MARKET_HISTORY_ACCUMULATED_NOTE} {MARKET_TRENDS_PARTIAL_NOTE}
      </p>
    </section>
  );
}
