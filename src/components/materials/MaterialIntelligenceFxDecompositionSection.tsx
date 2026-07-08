import React, { useCallback, useEffect, useState } from "react";
import { Info, Loader2, TrendingUp } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import type { MaterialMarketFxDecompositionResult } from "@/src/lib/materialMarketFxDecomposition";
import { getMaterialMarketIntelligenceFxDecompositionApiPath } from "@/src/lib/materialsNavigation";
import { MaterialIntelligence360Section } from "@/src/components/materials/MaterialIntelligence360Section";

type Props = {
  materialId: string;
  materialName: string;
  period?: string;
};

export function MaterialIntelligenceFxDecompositionSection({
  materialId,
  materialName,
  period = "30d",
}: Props) {
  const [data, setData] = useState<MaterialMarketFxDecompositionResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const result = await fetchJsonOk<MaterialMarketFxDecompositionResult>(
        `${getMaterialMarketIntelligenceFxDecompositionApiPath(materialId)}?period=${encodeURIComponent(period)}`
      );
      setData(result);
    } catch {
      setData(null);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [materialId, period]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <MaterialIntelligence360Section
        id="fxDecomposition"
        title="Análise de variação"
        description="Separação entre efeito cambial (dólar) e variação de preço/fornecedor."
      >
        <div
          className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground"
          data-testid="material-intelligence-fx-decomposition-loading"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Carregando análise…
        </div>
      </MaterialIntelligence360Section>
    );
  }

  if (error || !data || !data.hasSufficientData) {
    return (
      <MaterialIntelligence360Section
        id="fxDecomposition"
        title="Análise de variação"
        description="Separação entre efeito cambial (dólar) e variação de preço/fornecedor."
      >
        <p
          className="text-sm text-muted-foreground"
          data-testid="material-intelligence-fx-decomposition-insufficient"
        >
          Dados insuficientes para análise.
        </p>
      </MaterialIntelligence360Section>
    );
  }

  return (
    <MaterialIntelligence360Section
      id="fxDecomposition"
      title="Análise de variação"
      description="Separação entre efeito cambial (dólar) e variação de preço/fornecedor."
    >
      <div
        className="space-y-3"
        data-testid="material-intelligence-fx-decomposition-content"
      >
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/20 px-4 py-3">
          <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <p className="flex-1 text-sm text-foreground leading-relaxed">{data.explanation}</p>
          <button
            type="button"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            title={data.calculationBasis}
            aria-label="Base de cálculo da análise de variação"
            data-testid="material-intelligence-fx-decomposition-info"
          >
            <Info className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Período: {data.periodLabel}
          {materialName && data.materialName !== materialName ? ` · ${data.materialName}` : ""}
        </p>
      </div>
    </MaterialIntelligence360Section>
  );
}
