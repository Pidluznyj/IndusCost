import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Radar } from "lucide-react";
import { fetchJsonOk, fetchOk } from "@/src/lib/http";
import {
  DEFAULT_MATERIAL_MARKET_CRITICALITY,
  DEFAULT_MATERIAL_MARKET_MONITORING_FREQUENCY_DAYS,
  MATERIAL_MARKET_CRITICALITY_LABELS,
  MATERIAL_MARKET_CRITICALITY_VALUES,
  type MaterialMarketCriticality,
} from "@/src/lib/materialMarketMonitoring";
import type { MaterialIntelligenceDetailItem } from "@/src/lib/materialMarketIntelligenceDetail";
import {
  getMaterialMarketIntelligenceDetailApiPath,
  MATERIALS_SECTION_PATHS,
} from "@/src/lib/materialsNavigation";
import { MaterialMarketMonitoringBadge } from "@/src/components/materials/MaterialMarketMonitoringBadge";
import { formatCurrency } from "@/src/lib/utils";

export function MaterialsMarketIntelligenceDetailPage() {
  const { materialId } = useParams<{ materialId: string }>();
  const [item, setItem] = useState<MaterialIntelligenceDetailItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const [activationCriticality, setActivationCriticality] = useState<MaterialMarketCriticality>(
    DEFAULT_MATERIAL_MARKET_CRITICALITY
  );
  const [activationFrequency, setActivationFrequency] = useState(
    DEFAULT_MATERIAL_MARKET_MONITORING_FREQUENCY_DAYS
  );

  const load = useCallback(async () => {
    if (!materialId) {
      setError("Material não informado.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJsonOk<MaterialIntelligenceDetailItem>(
        getMaterialMarketIntelligenceDetailApiPath(materialId)
      );
      setItem(data);
      if (!data.isMarketMonitored && data.marketCriticality) {
        setActivationCriticality(data.marketCriticality);
      }
      if (data.marketMonitoringFrequencyDays) {
        setActivationFrequency(data.marketMonitoringFrequencyDays);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar a inteligência.");
      setItem(null);
    } finally {
      setLoading(false);
    }
  }, [materialId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleActivateMonitoring = async () => {
    if (!materialId) return;
    setActivating(true);
    setError(null);
    try {
      await fetchOk(`/api/materials/${materialId}/market-monitoring`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isMarketMonitored: true,
          marketCriticality: activationCriticality,
          marketMonitoringFrequencyDays: activationFrequency,
        }),
      });
      await load();
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : "Não foi possível ativar o monitoramento."
      );
    } finally {
      setActivating(false);
    }
  };

  const title = useMemo(() => item?.description ?? "Inteligência de Mercado", [item]);

  return (
    <div className="space-y-6" data-testid="materials-market-intelligence-detail-page">
      <div className="flex flex-wrap items-center gap-4">
        <Link
          to={MATERIALS_SECTION_PATHS.marketIntelligence}
          className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline w-fit"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar para Inteligência de Mercado
        </Link>
        <Link
          to={MATERIALS_SECTION_PATHS.catalog}
          className="text-sm font-medium text-muted-foreground hover:text-primary hover:underline"
        >
          Matérias-primas
        </Link>
      </div>

      {loading ? (
        <div
          className="flex flex-col items-center justify-center rounded-xl border border-border bg-card px-6 py-12"
          data-testid="materials-market-intelligence-detail-loading"
        >
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="mt-2 text-sm text-muted-foreground">Carregando inteligência…</p>
        </div>
      ) : error && !item ? (
        <div
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
          data-testid="materials-market-intelligence-detail-error"
        >
          {error}
        </div>
      ) : item ? (
        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {item.code}
              </p>
              <h3 className="text-lg font-bold tracking-tight">{title}</h3>
              <p className="text-sm text-muted-foreground">
                {item.family} · {item.unit}
              </p>
            </div>
            <MaterialMarketMonitoringBadge
              isMarketMonitored={item.isMarketMonitored}
              marketCriticality={item.marketCriticality}
            />
          </div>

          {item.isMarketMonitored ? (
            <>
              {item.lastQuoteAmount != null ? (
                <p className="text-sm text-muted-foreground">
                  Última cotação:{" "}
                  <span className="font-semibold text-foreground">
                    {formatCurrency(item.lastQuoteAmount)}
                  </span>
                </p>
              ) : null}
              <p className="text-sm text-muted-foreground">
                Painel individual em construção. Os sinais de mercado e histórico detalhado serão
                exibidos nesta rota nas próximas entregas.
              </p>
            </>
          ) : (
            <div
              className="rounded-lg border border-dashed border-border bg-accent/20 p-4 space-y-4"
              data-testid="materials-market-intelligence-activate-panel"
            >
              <div className="flex items-start gap-3">
                <Radar className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold">Ativar monitoramento de mercado</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Esta matéria-prima ainda não está no radar de Inteligência de Mercado. Ative o
                    monitoramento para acompanhá-la na home e receber sinais nas próximas entregas.
                  </p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 max-w-xl">
                <label className="space-y-1.5 text-sm">
                  <span className="font-medium">Criticidade</span>
                  <select
                    value={activationCriticality}
                    onChange={(e) =>
                      setActivationCriticality(e.target.value as MaterialMarketCriticality)
                    }
                    className="w-full rounded-lg border border-border bg-background px-3 py-2"
                    data-testid="material-intelligence-activate-criticality"
                  >
                    {MATERIAL_MARKET_CRITICALITY_VALUES.map((value) => (
                      <option key={value} value={value}>
                        {MATERIAL_MARKET_CRITICALITY_LABELS[value]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5 text-sm">
                  <span className="font-medium">Frequência (dias)</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={activationFrequency}
                    onChange={(e) =>
                      setActivationFrequency(parseInt(e.target.value, 10) || 1)
                    }
                    className="w-full rounded-lg border border-border bg-background px-3 py-2"
                    data-testid="material-intelligence-activate-frequency"
                  />
                </label>
              </div>

              {error ? (
                <p className="text-sm text-red-700">{error}</p>
              ) : null}

              <button
                type="button"
                onClick={() => void handleActivateMonitoring()}
                disabled={activating}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
                data-testid="material-intelligence-activate-button"
              >
                {activating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Radar className="h-4 w-4" />
                )}
                Ativar monitoramento
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
