import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import { AlertTriangle, LineChart as LineChartIcon, Loader2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import {
  formatMaterialIntelligenceQuoteDate,
} from "@/src/lib/materialIntelligence360Sections";
import {
  MATERIAL_MARKET_COMPARATIVE_CHART_PERIOD_OPTIONS,
  mergeComparativeChartSeriesForDisplay,
  type MaterialMarketComparativeChartPeriod,
  type MaterialMarketComparativeChartResponse,
} from "@/src/lib/materialMarketComparativeChart";
import { getMaterialMarketIntelligenceComparativeChartApiPath } from "@/src/lib/materialsNavigation";
import { formatCurrency, formatNumber } from "@/src/lib/utils";
import { MaterialIntelligence360Section } from "@/src/components/materials/MaterialIntelligence360Section";
import { FINANCE_BI_COLORS } from "@/src/lib/financeBiDashboardTheme";

type Props = {
  materialId: string;
  unit: string;
};

type ChartRow = ReturnType<typeof mergeComparativeChartSeriesForDisplay>[number];

const SERIES_COLORS = {
  material: FINANCE_BI_COLORS.primary,
  ptax: FINANCE_BI_COLORS.success,
  brent: FINANCE_BI_COLORS.warning,
} as const;

function formatChartYAxis(value: number, normalized: boolean): string {
  if (normalized) return formatNumber(value, 0);
  if (value >= 1_000) return formatNumber(value / 1_000, 1) + "k";
  return formatNumber(value, 1);
}

function ComparativeChartTooltip({
  active,
  payload,
  normalized,
}: {
  active?: boolean;
  payload?: Array<{ payload?: ChartRow }>;
  normalized: boolean;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div
      className="rounded-lg border border-border bg-card px-3 py-2 shadow-sm text-xs space-y-1 min-w-[220px]"
      data-testid="material-comparative-chart-tooltip"
    >
      <p className="font-semibold text-foreground">{point.dateLabel}</p>
      <p>
        <span className="text-muted-foreground">Matéria-prima (BRL): </span>
        <span className="font-semibold" style={{ color: SERIES_COLORS.material }}>
          {point.materialBRL != null ? formatCurrency(point.materialBRL) : "—"}
        </span>
      </p>
      <p>
        <span className="text-muted-foreground">Dólar PTAX venda: </span>
        <span className="font-semibold" style={{ color: SERIES_COLORS.ptax }}>
          {point.ptaxSell != null ? formatNumber(point.ptaxSell, 4) : "—"}
        </span>
      </p>
      <p>
        <span className="text-muted-foreground">Brent (USD/bbl): </span>
        <span className="font-semibold" style={{ color: SERIES_COLORS.brent }}>
          {point.brentUSD != null ? `US$ ${formatNumber(point.brentUSD, 2)}` : "—"}
        </span>
      </p>
      {normalized ? (
        <p className="text-[10px] text-muted-foreground pt-1 border-t border-border">
          Gráfico em índice base 100 — valores acima são originais.
        </p>
      ) : null}
    </div>
  );
}

function pickSparseChartRows(rows: ChartRow[]): ChartRow[] {
  if (rows.length <= 60) return rows;
  const step = Math.ceil(rows.length / 60);
  return rows.filter((_, index) => index % step === 0 || index === rows.length - 1);
}

export function MaterialIntelligenceComparativeChart({ materialId, unit }: Props) {
  const [period, setPeriod] = useState<MaterialMarketComparativeChartPeriod>("90d");
  const [data, setData] = useState<MaterialMarketComparativeChartResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetchJsonOk<MaterialMarketComparativeChartResponse>(
        getMaterialMarketIntelligenceComparativeChartApiPath(materialId, { period })
      );
      setData(response);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [materialId, period]);

  useEffect(() => {
    void load();
  }, [load]);

  const chartRows = useMemo(() => {
    if (!data) return [];
    const merged = mergeComparativeChartSeriesForDisplay(
      data,
      formatMaterialIntelligenceQuoteDate
    );
    return pickSparseChartRows(merged);
  }, [data]);

  const normalized = data?.normalizationApplied ?? false;
  const materialKey = normalized ? "materialBRLIndexed" : "materialBRL";
  const ptaxKey = normalized ? "ptaxSellIndexed" : "ptaxSell";
  const brentKey = normalized ? "brentUSDIndexed" : "brentUSD";

  const hasAnySeries = useMemo(
    () =>
      chartRows.some(
        (row) =>
          row.materialBRL != null || row.ptaxSell != null || row.brentUSD != null
      ),
    [chartRows]
  );

  const quoteCount = useMemo(
    () => data?.series.materialBRL.filter((p) => p.value != null).length ?? 0,
    [data]
  );

  return (
    <MaterialIntelligence360Section
      id="marketComparison"
      title="Comparativo de mercado"
      description="Evolução da matéria-prima em BRL frente ao dólar (PTAX) e ao Brent."
      className="xl:col-span-2"
    >
      <div className="space-y-4" data-testid="material-intelligence-comparative-chart">
        <div className="flex flex-wrap items-center gap-2">
          {MATERIAL_MARKET_COMPARATIVE_CHART_PERIOD_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setPeriod(option.value)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                period === option.value
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground hover:bg-accent"
              }`}
              data-testid={`material-comparative-period-${option.value}`}
            >
              {option.label}
            </button>
          ))}
          {normalized ? (
            <span
              className="rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-primary"
              data-testid="material-comparative-normalization-badge"
            >
              Índice base 100
            </span>
          ) : null}
        </div>

        {data?.hasFewDataPoints ? (
          <div
            className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
            data-testid="material-comparative-few-data-warning"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
            <p>
              Poucas cotações no período ({quoteCount} registrada
              {quoteCount === 1 ? "" : "s"}) — a comparação pode não ser representativa.
            </p>
          </div>
        ) : null}

        {data?.warnings?.length ? (
          <div className="space-y-1" data-testid="material-comparative-warnings">
            {data.warnings
              .filter((w) => !/Poucas cotações/i.test(w))
              .map((warning) => (
                <p key={warning} className="text-xs text-muted-foreground">
                  {warning}
                </p>
              ))}
          </div>
        ) : null}

        {loading ? (
          <div
            className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-4 py-12"
            data-testid="material-comparative-chart-loading"
          >
            <Loader2 className="h-7 w-7 animate-spin text-primary" aria-hidden="true" />
            <p className="mt-2 text-sm text-muted-foreground">Carregando comparativo de mercado…</p>
          </div>
        ) : !hasAnySeries ? (
          <div
            className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-4 py-10 text-center"
            data-testid="material-comparative-chart-empty"
          >
            <LineChartIcon
              className="mb-2 h-7 w-7 text-muted-foreground opacity-60"
              aria-hidden="true"
            />
            <p className="text-sm font-medium text-muted-foreground">
              Sem dados suficientes para o comparativo no período.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Registre cotações ou amplie o intervalo para correlacionar preço, câmbio e Brent.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-background/50 p-3">
            <p className="mb-2 text-xs text-muted-foreground">
              {quoteCount} cotação(ões) · preço líquido em BRL por {unit}
              {normalized ? " · séries indexadas para comparação" : ""}
            </p>
            <div style={{ width: "100%", height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartRows} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={FINANCE_BI_COLORS.border} />
                  <XAxis
                    dataKey="dateLabel"
                    tick={{ fontSize: 11, fill: FINANCE_BI_COLORS.textSecondary }}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: FINANCE_BI_COLORS.textSecondary }}
                    tickFormatter={(v: number) => formatChartYAxis(v, normalized)}
                    width={normalized ? 48 : 64}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<ComparativeChartTooltip normalized={normalized} />} />
                  <Legend
                    wrapperStyle={{ fontSize: 11 }}
                    formatter={(value: string) => (
                      <span className="text-muted-foreground">{value}</span>
                    )}
                  />
                  <Line
                    type="monotone"
                    dataKey={materialKey}
                    name="Matéria-prima (BRL)"
                    stroke={SERIES_COLORS.material}
                    strokeWidth={2}
                    dot={{ r: 3, fill: SERIES_COLORS.material }}
                    activeDot={{ r: 5 }}
                    connectNulls={false}
                  />
                  <Line
                    type="monotone"
                    dataKey={ptaxKey}
                    name="Dólar PTAX venda"
                    stroke={SERIES_COLORS.ptax}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 5 }}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey={brentKey}
                    name="Brent (USD/bbl)"
                    stroke={SERIES_COLORS.brent}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 5 }}
                    connectNulls={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </MaterialIntelligence360Section>
  );
}
