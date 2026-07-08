import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, TrendingDown } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import type { MaterialMarketSavingsOpportunitiesResponse } from "@/src/lib/materialMarketSavingsOpportunity";
import { MATERIALS_MARKET_INTELLIGENCE_OPPORTUNITIES_API } from "@/src/lib/materialsNavigation";
import { formatCurrency, formatNumber } from "@/src/lib/utils";

export function MaterialsMarketIntelligenceTopOpportunityCard() {
  const [data, setData] = useState<MaterialMarketSavingsOpportunitiesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<MaterialMarketSavingsOpportunitiesResponse>(
        MATERIALS_MARKET_INTELLIGENCE_OPPORTUNITIES_API
      );
      setData(payload);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar oportunidades.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div
        className="flex items-center justify-center rounded-2xl border border-border bg-card px-6 py-8"
        data-testid="materials-market-intelligence-top-opportunity-loading"
      >
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
        data-testid="materials-market-intelligence-top-opportunity-error"
      >
        {error}
      </div>
    );
  }

  const top = data?.topOpportunity;

  if (!top) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/20 px-6 py-10 text-center"
        data-testid="materials-market-intelligence-top-opportunity-empty"
      >
        <TrendingDown className="mb-3 h-8 w-8 text-muted-foreground opacity-60" aria-hidden="true" />
        <p className="text-sm font-medium text-muted-foreground">
          Nenhuma oportunidade de economia identificada nas matérias monitoradas.
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Registre cotações de mercado para habilitar a comparação ({data?.periodLabel ?? "90 dias"}).
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-card p-5 shadow-sm"
      data-testid="materials-market-intelligence-top-opportunity-card"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">
            Maior oportunidade
          </p>
          <h5 className="text-base font-bold text-foreground">
            {top.code} — {top.description}
          </h5>
          <p className="text-sm text-muted-foreground">
            Melhor fornecedor por preço:{" "}
            <span className="font-medium text-foreground">{top.recommendedSupplier ?? "—"}</span>
          </p>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-2xl font-bold text-emerald-900">
            {top.savingsPercent != null
              ? `${formatNumber(top.savingsPercent, 1)}%`
              : formatCurrency(top.unitSavings)}
          </p>
          <p className="text-xs text-emerald-800">
            Economia de {formatCurrency(top.unitSavings)}/{top.unit}
            {data?.defaultVolume === 1
              ? ""
              : ` · total ${formatCurrency(top.totalSavings)} (${formatNumber(data?.defaultVolume ?? 1, 0)} ${top.unit})`}
          </p>
        </div>
      </div>
      <div className="mt-4">
        <Link
          to={top.intelligencePath}
          className="inline-flex items-center rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
          data-testid="materials-market-intelligence-top-opportunity-link"
        >
          Ver inteligência
        </Link>
      </div>
    </div>
  );
}
