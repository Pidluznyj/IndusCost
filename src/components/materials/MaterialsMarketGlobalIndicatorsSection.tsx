import React, { useCallback, useEffect, useState } from "react";
import { DollarSign, Droplets, Loader2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { formatNumber } from "@/src/lib/utils";
import {
  MARKET_GLOBAL_INDICATORS_API,
  type MarketGlobalIndicatorsDto,
} from "@/src/lib/marketGlobalIndicators";
import { SummaryKpiCard } from "@/src/components/ui/SummaryKpiCard";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { SYSTEM_TOTALIZER_GRID_CLASS } from "@/src/components/ui/SystemTotalizerCard";
import { ExecutiveSummarySection } from "@/src/components/ui/ExecutiveSummarySection";
import { ContextualDashboardEmpty } from "@/src/components/contextual/ContextualDashboardEmpty";

export const MARKET_GLOBAL_INDICATORS_EMPTY_MESSAGE =
  "Ainda não há indicadores globais registrados. Os valores de Dólar PTAX e Brent aparecerão aqui após a primeira coleta bem-sucedida.";

export const MARKET_GLOBAL_INDICATORS_ERROR_MESSAGE =
  "Não foi possível carregar os indicadores globais de mercado. Tente novamente em instantes.";

function formatDateTimePt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatUsdRate(value: number): string {
  return `R$ ${formatNumber(value, 4)}`;
}

function formatBrentPrice(value: number): string {
  return `US$ ${formatNumber(value, 2)}`;
}

function formatVariation(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value, 2)}%`;
}

function variationVariant(
  value: number | null | undefined
): "success" | "danger" | "neutral" {
  if (value == null || !Number.isFinite(value) || value === 0) return "neutral";
  return value > 0 ? "success" : "danger";
}

export function MaterialsMarketGlobalIndicatorsSection() {
  const [data, setData] = useState<MarketGlobalIndicatorsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<MarketGlobalIndicatorsDto>(
        MARKET_GLOBAL_INDICATORS_API
      );
      setData(payload);
    } catch {
      setError(MARKET_GLOBAL_INDICATORS_ERROR_MESSAGE);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ExecutiveSummarySection
      title="Indicadores globais"
      eyebrow="Mercado"
      testId="materials-market-intelligence-kpis-section"
      footer={
        data?.hasData ? (
          <p className="text-xs text-muted-foreground" data-testid="market-global-indicators-meta">
            Última atualização: {formatDateTimePt(data.lastUpdate)}
            {data.sourcesLabel ? ` · Fonte: ${data.sourcesLabel}` : null}
          </p>
        ) : null
      }
    >
      {loading ? (
        <div
          className="flex flex-col items-center justify-center rounded-xl border border-border bg-card px-6 py-12"
          data-testid="market-global-indicators-loading"
        >
          <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
          <p className="mt-2 text-sm text-muted-foreground">Carregando indicadores globais…</p>
        </div>
      ) : null}

      {!loading && error ? (
        <div className="space-y-3" data-testid="market-global-indicators-error">
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            {error}
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="text-sm font-semibold text-primary hover:underline"
          >
            Tentar novamente
          </button>
        </div>
      ) : null}

      {!loading && !error && (!data || !data.hasData) ? (
        <div data-testid="market-global-indicators-empty">
          <ContextualDashboardEmpty message={MARKET_GLOBAL_INDICATORS_EMPTY_MESSAGE} />
        </div>
      ) : null}

      {!loading && !error && data?.hasData ? (
        <SummaryKpiGrid testId="market-global-indicators-grid" minColumnWidth={200} className={SYSTEM_TOTALIZER_GRID_CLASS}>
          <SummaryKpiCard
            label="Dólar PTAX venda"
            value={data.ptax ? formatUsdRate(data.ptax.sellRate) : "—"}
            description={data.ptax ? "Cotação de venda (USD/BRL)" : "Sem cotação PTAX"}
            variant="money"
            icon={<DollarSign className="h-4 w-4" aria-hidden="true" />}
          />
          <SummaryKpiCard
            label="Dólar PTAX compra"
            value={data.ptax ? formatUsdRate(data.ptax.buyRate) : "—"}
            description={data.ptax ? "Cotação de compra (USD/BRL)" : "Sem cotação PTAX"}
            variant="money"
            icon={<DollarSign className="h-4 w-4" aria-hidden="true" />}
          />
          <SummaryKpiCard
            label="Brent USD/barril"
            value={data.brent ? formatBrentPrice(data.brent.price) : "—"}
            description={data.brent ? "Preço mais recente" : "Sem cotação Brent"}
            variant="info"
            icon={<Droplets className="h-4 w-4" aria-hidden="true" />}
          />
          <SummaryKpiCard
            label="Variação Brent"
            value={formatVariation(data.brent?.variationFromPrevious)}
            description="Vs. coleta anterior"
            variant={variationVariant(data.brent?.variationFromPrevious)}
          />
        </SummaryKpiGrid>
      ) : null}
    </ExecutiveSummarySection>
  );
}
