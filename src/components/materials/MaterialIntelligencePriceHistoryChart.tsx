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
import { History, Loader2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import {
  MATERIAL_MARKET_PRICE_HISTORY_PERIOD_OPTIONS,
  type MaterialMarketPriceHistoryPeriod,
  type MaterialMarketPriceHistoryPoint,
  type MaterialMarketPriceHistoryResponse,
  type MaterialMarketPriceHistorySeries,
} from "@/src/lib/materialMarketPriceHistory";
import { getMaterialMarketIntelligencePriceHistoryApiPath } from "@/src/lib/materialsNavigation";
import { formatCurrency, formatNumber } from "@/src/lib/utils";
import { MaterialIntelligence360Section } from "@/src/components/materials/MaterialIntelligence360Section";
import { MaterialMarketIntelligenceExportButtons } from "@/src/components/materials/MaterialMarketIntelligenceExportButtons";
import { FINANCE_BI_COLORS } from "@/src/lib/financeBiDashboardTheme";

type Props = {
  materialId: string;
  unit: string;
};

/** Cores das linhas por fornecedor — na ordem do ranking (melhor preço médio primeiro). */
const SUPPLIER_LINE_COLORS = [
  FINANCE_BI_COLORS.primary,
  FINANCE_BI_COLORS.warning,
  FINANCE_BI_COLORS.success,
];

/** Linha do gráfico após o pivô por data — uma coluna por supplierKey selecionado. */
type PivotRow = {
  date: string;
  dateLabel: string;
} & Record<string, string | number | undefined>;

function formatCompactBrl(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `R$ ${formatNumber(value / 1_000_000, 1)}M`;
  }
  if (abs >= 1_000) {
    return `R$ ${formatNumber(value / 1_000, 1)}k`;
  }
  return formatCurrency(value);
}

function formatOriginalPrice(point: MaterialMarketPriceHistoryPoint): string {
  if (point.originalCurrency === "BRL") {
    return formatCurrency(point.originalPrice);
  }
  return `${formatNumber(point.originalPrice)} ${point.originalCurrency}`;
}

/**
 * Monta o dataset "largo" que o Recharts precisa para várias linhas no
 * mesmo eixo X: uma linha por data (união das datas de todos os
 * fornecedores selecionados), uma coluna por supplierKey.
 */
function buildPivotRows(series: MaterialMarketPriceHistorySeries[]): PivotRow[] {
  const rowsByDate = new Map<string, PivotRow>();
  for (const s of series) {
    for (const point of s.points) {
      let row = rowsByDate.get(point.date);
      if (!row) {
        row = { date: point.date, dateLabel: point.dateLabel };
        rowsByDate.set(point.date, row);
      }
      row[s.supplierKey] = point.priceBRL;
    }
  }
  return [...rowsByDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function PriceHistoryTooltip({
  active,
  label,
  series,
  pointsByKeyAndDate,
}: {
  active?: boolean;
  label?: string;
  series: MaterialMarketPriceHistorySeries[];
  pointsByKeyAndDate: Map<string, Map<string, MaterialMarketPriceHistoryPoint>>;
}) {
  if (!active || !label) return null;
  const rows = series
    .map((s) => ({ series: s, point: pointsByKeyAndDate.get(s.supplierKey)?.get(label) }))
    .filter((r): r is { series: MaterialMarketPriceHistorySeries; point: MaterialMarketPriceHistoryPoint } =>
      Boolean(r.point)
    );
  if (rows.length === 0) return null;

  return (
    <div
      className="rounded-lg border border-border bg-card px-3 py-2 shadow-sm text-xs space-y-2 min-w-[220px]"
      data-testid="material-price-history-chart-tooltip"
    >
      <p className="font-semibold text-foreground">{rows[0]!.point.dateLabel}</p>
      {rows.map(({ series: s, point }, index) => (
        <div key={s.supplierKey} className="space-y-0.5">
          <p className="font-semibold" style={{ color: SUPPLIER_LINE_COLORS[index % SUPPLIER_LINE_COLORS.length] }}>
            {s.supplierName}
          </p>
          <p>
            <span className="text-muted-foreground">Preço original: </span>
            {formatOriginalPrice(point)}
          </p>
          <p>
            <span className="text-muted-foreground">Preço em BRL: </span>
            <span className="font-semibold">{formatCurrency(point.priceBRL)}</span>
          </p>
          <p>
            <span className="text-muted-foreground">Dólar usado: </span>
            {point.exchangeRateUsed != null ? formatNumber(point.exchangeRateUsed, 4) : "—"}
          </p>
          {point.notes?.trim() ? (
            <p>
              <span className="text-muted-foreground">Observação: </span>
              {point.notes}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function MaterialIntelligencePriceHistoryChart({ materialId, unit }: Props) {
  const [period, setPeriod] = useState<MaterialMarketPriceHistoryPeriod>("12m");
  const [customDateFrom, setCustomDateFrom] = useState("");
  const [customDateTo, setCustomDateTo] = useState("");
  const [data, setData] = useState<MaterialMarketPriceHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const canLoadCustom = period !== "custom" || (customDateFrom.trim() && customDateTo.trim());

  const load = useCallback(async () => {
    if (!canLoadCustom) {
      setData(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const response = await fetchJsonOk<MaterialMarketPriceHistoryResponse>(
        getMaterialMarketIntelligencePriceHistoryApiPath(materialId, {
          period,
          dateFrom: period === "custom" ? customDateFrom : undefined,
          dateTo: period === "custom" ? customDateTo : undefined,
        })
      );
      setData(response);
    } catch {
      setData({
        period: { preset: period, dateFrom: "", dateTo: "" },
        points: [],
        series: [],
        totalSuppliers: 0,
        total: 0,
      });
    } finally {
      setLoading(false);
    }
  }, [materialId, period, customDateFrom, customDateTo, canLoadCustom]);

  useEffect(() => {
    void load();
  }, [load]);

  const series = useMemo(() => data?.series ?? [], [data?.series]);
  const totalSuppliers = data?.totalSuppliers ?? 0;
  const hasPoints = series.some((s) => s.points.length > 0);
  const totalQuoteCount = useMemo(
    () => series.reduce((sum, s) => sum + s.points.length, 0),
    [series]
  );
  const pivotRows = useMemo(() => buildPivotRows(series), [series]);
  const pointsByKeyAndDate = useMemo(() => {
    const map = new Map<string, Map<string, MaterialMarketPriceHistoryPoint>>();
    for (const s of series) {
      const byDate = new Map<string, MaterialMarketPriceHistoryPoint>();
      for (const point of s.points) byDate.set(point.date, point);
      map.set(s.supplierKey, byDate);
    }
    return map;
  }, [series]);

  return (
    <MaterialIntelligence360Section
      id="priceHistory"
      title="Histórico de Preços"
      description="Evolução de custos e cotações ao longo do tempo."
      className="xl:col-span-2"
    >
      <div className="space-y-4" data-testid="material-intelligence-price-history-chart">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {MATERIAL_MARKET_PRICE_HISTORY_PERIOD_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setPeriod(option.value)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  period === option.value
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-muted-foreground hover:bg-accent"
                }`}
                data-testid={`material-price-history-period-${option.value}`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <MaterialMarketIntelligenceExportButtons
            scope="history"
            filters={{
              materialId,
              period,
              dateFrom: period === "custom" ? customDateFrom : null,
              dateTo: period === "custom" ? customDateTo : null,
            }}
            disabled={!canLoadCustom}
          />
        </div>

        {period === "custom" ? (
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1 text-sm">
              <span className="font-medium text-muted-foreground">De</span>
              <input
                type="date"
                value={customDateFrom}
                onChange={(e) => setCustomDateFrom(e.target.value)}
                className="block rounded-lg border border-border bg-background px-3 py-2"
                data-testid="material-price-history-date-from"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-muted-foreground">Até</span>
              <input
                type="date"
                value={customDateTo}
                onChange={(e) => setCustomDateTo(e.target.value)}
                className="block rounded-lg border border-border bg-background px-3 py-2"
                data-testid="material-price-history-date-to"
              />
            </label>
          </div>
        ) : null}

        {loading ? (
          <div
            className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-4 py-12"
            data-testid="material-price-history-chart-loading"
          >
            <Loader2 className="h-7 w-7 animate-spin text-primary" aria-hidden="true" />
            <p className="mt-2 text-sm text-muted-foreground">Carregando histórico de preços…</p>
          </div>
        ) : !canLoadCustom ? (
          <div
            className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-4 py-10 text-center"
            data-testid="material-price-history-chart-custom-hint"
          >
            <p className="text-sm text-muted-foreground">
              Selecione as datas inicial e final para visualizar o período personalizado.
            </p>
          </div>
        ) : !hasPoints ? (
          <div
            className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-4 py-10 text-center"
            data-testid="material-price-history-chart-empty"
          >
            <History className="mb-2 h-7 w-7 text-muted-foreground opacity-60" aria-hidden="true" />
            <p className="text-sm font-medium text-muted-foreground">
              Nenhuma cotação no período selecionado.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Registre cotações manuais ou amplie o intervalo para ver a evolução de preços.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-background/50 p-3">
            <p className="mb-2 text-xs text-muted-foreground">
              {totalQuoteCount} cotação(ões) · preço líquido em BRL por {unit}
              {totalSuppliers > series.length
                ? ` · exibindo os ${series.length} de ${totalSuppliers} fornecedores com melhor preço médio e cotação atualizada`
                : null}
            </p>
            <div style={{ width: "100%", height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={pivotRows} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={FINANCE_BI_COLORS.border} />
                  <XAxis
                    dataKey="dateLabel"
                    tick={{ fontSize: 11, fill: FINANCE_BI_COLORS.textSecondary }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: FINANCE_BI_COLORS.textSecondary }}
                    tickFormatter={(v: number) => formatCompactBrl(v)}
                    width={80}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    content={
                      <PriceHistoryTooltip series={series} pointsByKeyAndDate={pointsByKeyAndDate} />
                    }
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 11, color: FINANCE_BI_COLORS.textSecondary }}
                  />
                  {series.map((s, index) => (
                    <Line
                      key={s.supplierKey}
                      type="monotone"
                      dataKey={s.supplierKey}
                      name={s.supplierName}
                      stroke={SUPPLIER_LINE_COLORS[index % SUPPLIER_LINE_COLORS.length]}
                      strokeWidth={2}
                      dot={{
                        r: s.points.length <= 3 ? 5 : 3,
                        fill: SUPPLIER_LINE_COLORS[index % SUPPLIER_LINE_COLORS.length],
                      }}
                      activeDot={{ r: 6 }}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </MaterialIntelligence360Section>
  );
}
