import React, { useCallback, useEffect, useState } from "react";
import { BarChart3, Loader2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import {
  MATERIAL_MARKET_QUOTE_ANALYTICS_PERIOD_LABELS,
  MATERIAL_MARKET_QUOTE_ANALYTICS_PERIODS,
  type MaterialMarketQuoteAnalyticsPeriod,
  type MaterialMarketQuoteAnalyticsResult,
} from "@/src/lib/materialMarketQuoteAnalytics";
import { getMaterialMarketIntelligenceAnalyticsApiPath } from "@/src/lib/materialsNavigation";
import { MaterialIntelligence360Section } from "@/src/components/materials/MaterialIntelligence360Section";
import { SummaryKpiCard } from "@/src/components/ui/SummaryKpiCard";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { formatCurrency } from "@/src/lib/utils";
import { cn } from "@/src/lib/utils";

type Props = {
  materialId: string;
};

function formatPercentValue(value: number | null, reason: string | null): string {
  if (value == null) return reason ?? "—";
  const formatted = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatted}%`;
}

function formatOptionalCurrency(value: number | null): string {
  return value != null ? formatCurrency(value) : "—";
}

function formatOptionalPercent(value: number | null): string {
  if (value == null) return "—";
  return `${new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value)}%`;
}

function trendVariant(
  trend: MaterialMarketQuoteAnalyticsResult["trend"]
): "default" | "success" | "warning" | "danger" {
  if (trend === "UP") return "danger";
  if (trend === "DOWN") return "success";
  return "default";
}

export function MaterialIntelligencePriceAnalyticsSection({ materialId }: Props) {
  const [period, setPeriod] = useState<MaterialMarketQuoteAnalyticsPeriod>("30d");
  const [analytics, setAnalytics] = useState<MaterialMarketQuoteAnalyticsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJsonOk<MaterialMarketQuoteAnalyticsResult>(
        `${getMaterialMarketIntelligenceAnalyticsApiPath(materialId)}?period=${period}`
      );
      setAnalytics(data);
    } catch (e: unknown) {
      setAnalytics(null);
      setError(e instanceof Error ? e.message : "Não foi possível carregar os indicadores.");
    } finally {
      setLoading(false);
    }
  }, [materialId, period]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <MaterialIntelligence360Section
      id="priceHistory"
      title="Indicadores de Mercado"
      description="Estatísticas e variações calculadas a partir do histórico de cotações."
    >
      <div className="flex flex-wrap gap-2" data-testid="material-intelligence-analytics-period-filter">
        {MATERIAL_MARKET_QUOTE_ANALYTICS_PERIODS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setPeriod(option)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
              period === option
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
            )}
            data-testid={`material-intelligence-analytics-period-${option}`}
          >
            {MATERIAL_MARKET_QUOTE_ANALYTICS_PERIOD_LABELS[option]}
          </button>
        ))}
      </div>

      {loading ? (
        <div
          className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"
          data-testid="material-intelligence-analytics-loading"
        >
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          Calculando indicadores…
        </div>
      ) : error ? (
        <div
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
          data-testid="material-intelligence-analytics-error"
        >
          {error}
        </div>
      ) : analytics?.empty ? (
        <div
          className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-4 py-8 text-center"
          data-testid="material-intelligence-analytics-empty"
        >
          <BarChart3 className="mb-2 h-7 w-7 text-muted-foreground opacity-60" aria-hidden="true" />
          <p className="text-sm font-medium text-muted-foreground">
            Nenhuma cotação no período selecionado.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Registre cotações manuais para visualizar os indicadores de mercado.
          </p>
        </div>
      ) : analytics ? (
        <div className="space-y-4" data-testid="material-intelligence-analytics-kpis">
          <p className="text-xs text-muted-foreground">
            {analytics.quoteCount} cotação(ões) em {analytics.periodLabel.toLowerCase()}.
          </p>

          <SummaryKpiGrid testId="material-intelligence-analytics-price-grid" minColumnWidth={180}>
            <SummaryKpiCard
              label="Preço atual"
              value={formatOptionalCurrency(analytics.currentPrice)}
              helperText="Cotação mais recente (BRL líquido)"
            />
            <SummaryKpiCard
              label="Média"
              value={formatOptionalCurrency(analytics.average)}
              helperText="Média aritmética no período"
            />
            <SummaryKpiCard
              label="Mediana"
              value={formatOptionalCurrency(analytics.median)}
              helperText="Valor central do período"
            />
            <SummaryKpiCard
              label="Mínimo"
              value={formatOptionalCurrency(analytics.minPrice)}
              helperText="Menor cotação"
            />
            <SummaryKpiCard
              label="Máximo"
              value={formatOptionalCurrency(analytics.maxPrice)}
              helperText="Maior cotação"
            />
            <SummaryKpiCard
              label="Amplitude"
              value={formatOptionalCurrency(analytics.amplitude)}
              helperText="Máximo − mínimo"
            />
            <SummaryKpiCard
              label="Desvio padrão"
              value={formatOptionalCurrency(analytics.standardDeviation)}
              helperText="Dispersão dos preços"
            />
            <SummaryKpiCard
              label="Volatilidade"
              value={formatOptionalPercent(analytics.volatility)}
              helperText="Coef. de variação (σ ÷ média)"
            />
          </SummaryKpiGrid>

          <SummaryKpiGrid testId="material-intelligence-analytics-variation-grid" minColumnWidth={180}>
            <SummaryKpiCard
              label="Variação semanal"
              value={formatPercentValue(
                analytics.weeklyVariation.percent,
                analytics.weeklyVariation.reason
              )}
              helperText="vs. cotação ~7 dias atrás"
            />
            <SummaryKpiCard
              label="Variação mensal"
              value={formatPercentValue(
                analytics.monthlyVariation.percent,
                analytics.monthlyVariation.reason
              )}
              helperText="vs. cotação ~30 dias atrás"
            />
            <SummaryKpiCard
              label="Variação anual"
              value={formatPercentValue(
                analytics.annualVariation.percent,
                analytics.annualVariation.reason
              )}
              helperText="vs. cotação ~365 dias atrás"
            />
            <SummaryKpiCard
              label="Tendência"
              value={analytics.trendLabel ?? analytics.trendReason ?? "—"}
              helperText={`Últimos 7 dias vs. anteriores (limiar ±${2}%)`}
              variant={trendVariant(analytics.trend)}
            />
          </SummaryKpiGrid>
        </div>
      ) : null}
    </MaterialIntelligence360Section>
  );
}
