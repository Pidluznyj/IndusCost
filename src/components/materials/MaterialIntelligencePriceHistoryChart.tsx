import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
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
} from "@/src/lib/materialMarketPriceHistory";
import { getMaterialMarketIntelligencePriceHistoryApiPath } from "@/src/lib/materialsNavigation";
import { formatCurrency, formatNumber } from "@/src/lib/utils";
import { MaterialIntelligence360Section } from "@/src/components/materials/MaterialIntelligence360Section";
import { FINANCE_BI_COLORS } from "@/src/lib/financeBiDashboardTheme";

type Props = {
  materialId: string;
  unit: string;
};

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

function PriceHistoryTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: MaterialMarketPriceHistoryPoint }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div
      className="rounded-lg border border-border bg-card px-3 py-2 shadow-sm text-xs space-y-1 min-w-[200px]"
      data-testid="material-price-history-chart-tooltip"
    >
      <p className="font-semibold text-foreground">{point.dateLabel}</p>
      <p>
        <span className="text-muted-foreground">Fornecedor: </span>
        {point.supplierName ?? "—"}
      </p>
      <p>
        <span className="text-muted-foreground">Preço original: </span>
        {formatOriginalPrice(point)}
      </p>
      <p>
        <span className="text-muted-foreground">Preço em BRL: </span>
        <span className="font-semibold text-primary">{formatCurrency(point.priceBRL)}</span>
      </p>
      <p>
        <span className="text-muted-foreground">Dólar usado: </span>
        {point.exchangeRateUsed != null
          ? formatNumber(point.exchangeRateUsed, 4)
          : "—"}
      </p>
      <p>
        <span className="text-muted-foreground">Observação: </span>
        {point.notes?.trim() ? point.notes : "—"}
      </p>
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
      setData({ period: { preset: period, dateFrom: "", dateTo: "" }, points: [], total: 0 });
    } finally {
      setLoading(false);
    }
  }, [materialId, period, customDateFrom, customDateTo, canLoadCustom]);

  useEffect(() => {
    void load();
  }, [load]);

  const chartPoints = useMemo(() => data?.points ?? [], [data?.points]);
  const hasPoints = chartPoints.length > 0;

  return (
    <MaterialIntelligence360Section
      id="priceHistory"
      title="Histórico de Preços"
      description="Evolução de custos e cotações ao longo do tempo."
      className="xl:col-span-2"
    >
      <div className="space-y-4" data-testid="material-intelligence-price-history-chart">
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
              {chartPoints.length} cotação(ões) · preço líquido em BRL por {unit}
            </p>
            <div style={{ width: "100%", height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartPoints} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
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
                  <Tooltip content={<PriceHistoryTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="priceBRL"
                    name="Preço em BRL"
                    stroke={FINANCE_BI_COLORS.primary}
                    strokeWidth={2}
                    dot={{ r: chartPoints.length <= 3 ? 5 : 3, fill: FINANCE_BI_COLORS.primary }}
                    activeDot={{ r: 6 }}
                    connectNulls
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
