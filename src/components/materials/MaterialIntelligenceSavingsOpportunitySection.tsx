import React, { useEffect, useRef, useState } from "react";
import { PiggyBank } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import type { MaterialMarketSavingsOpportunityResult } from "@/src/lib/materialMarketSavingsOpportunity";
import { getMaterialMarketIntelligenceSavingsApiPath } from "@/src/lib/materialsNavigation";
import { formatMaterialIntelligenceQuoteDate } from "@/src/lib/materialIntelligence360Sections";
import { formatCurrency, formatNumber } from "@/src/lib/utils";
import { MaterialIntelligence360Section } from "@/src/components/materials/MaterialIntelligence360Section";

const SAVINGS_DEBOUNCE_MS = 300;
const DEFAULT_ESTIMATED_VOLUME = 1000;

type Props = {
  materialId: string;
  unit: string;
};

export function MaterialIntelligenceSavingsOpportunitySection({ materialId, unit }: Props) {
  const [estimatedVolume, setEstimatedVolume] = useState(String(DEFAULT_ESTIMATED_VOLUME));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MaterialMarketSavingsOpportunityResult | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      void (async () => {
        setLoading(true);
        setError(null);
        try {
          const volume = estimatedVolume.trim() || String(DEFAULT_ESTIMATED_VOLUME);
          const data = await fetchJsonOk<MaterialMarketSavingsOpportunityResult>(
            getMaterialMarketIntelligenceSavingsApiPath(materialId, {
              volume,
              period: "90d",
            })
          );
          setResult(data);
        } catch (e: unknown) {
          setError(e instanceof Error ? e.message : "Não foi possível calcular a economia.");
          setResult(null);
        } finally {
          setLoading(false);
        }
      })();
    }, SAVINGS_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [materialId, estimatedVolume]);

  return (
    <MaterialIntelligence360Section
      id="suppliers"
      title="Economia potencial"
      description="Comparação entre o preço atual e a melhor cotação registrada no período. Apenas informativo — não altera o fornecedor cadastrado."
    >
      <div className="space-y-4" data-testid="material-intelligence-savings-opportunity">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          Esta análise é apenas uma recomendação por preço. O fornecedor oficial do material não é
          alterado automaticamente.
        </div>

        <label className="block space-y-1">
          <span className="text-xs font-semibold text-muted-foreground">Volume estimado</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              step="any"
              value={estimatedVolume}
              onChange={(e) => setEstimatedVolume(e.target.value)}
              className="w-full max-w-[200px] rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              data-testid="material-intelligence-savings-volume-input"
            />
            <span className="text-sm text-muted-foreground">{unit}</span>
          </div>
        </label>

        {loading ? (
          <p className="text-sm text-muted-foreground py-2">Calculando economia…</p>
        ) : error ? (
          <p className="text-sm text-red-700" data-testid="material-intelligence-savings-error">
            {error}
          </p>
        ) : result?.empty ? (
          <div
            className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-4 py-8 text-center"
            data-testid="material-intelligence-savings-empty"
          >
            <PiggyBank className="mb-2 h-7 w-7 text-muted-foreground opacity-60" aria-hidden="true" />
            <p className="text-sm font-medium text-muted-foreground">{result.message}</p>
          </div>
        ) : result ? (
          <div className="grid gap-3 sm:grid-cols-2" data-testid="material-intelligence-savings-results">
            <div className="rounded-lg border border-border bg-muted/10 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Preço atual
              </p>
              <p className="text-lg font-semibold">
                {result.currentPrice != null ? formatCurrency(result.currentPrice) : "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                {result.currentPriceSource === "currentCost"
                  ? "Custo oficial cadastrado"
                  : "Última cotação manual"}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-muted/10 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Melhor preço ({result.periodLabel})
              </p>
              <p className="text-lg font-semibold">
                {result.bestPrice != null ? formatCurrency(result.bestPrice) : "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                {result.recommendedSupplier ?? "—"}
                {result.bestPriceDate
                  ? ` · ${formatMaterialIntelligenceQuoteDate(result.bestPriceDate)}`
                  : ""}
              </p>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-800">
                Economia unitária
              </p>
              <p className="text-lg font-semibold text-emerald-900">
                {result.hasSavings ? formatCurrency(result.unitSavings) : "Sem economia"}
              </p>
              {result.savingsPercent != null ? (
                <p className="text-xs text-emerald-800">
                  {formatNumber(result.savingsPercent, 2)}% sobre o preço atual
                </p>
              ) : null}
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-800">
                Economia total
              </p>
              <p className="text-lg font-semibold text-emerald-900">
                {result.hasSavings
                  ? formatCurrency(result.totalSavings)
                  : (result.message ?? "Sem economia")}
              </p>
              <p className="text-xs text-emerald-800">
                Para {formatNumber(result.estimatedVolume, 0)} {unit}
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </MaterialIntelligence360Section>
  );
}
