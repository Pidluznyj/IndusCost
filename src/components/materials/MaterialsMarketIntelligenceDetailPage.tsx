import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import {
  MATERIALS_MARKET_INTELLIGENCE_MONITORED_API,
  MATERIALS_SECTION_PATHS,
} from "@/src/lib/materialsNavigation";
import type { MonitoredMaterialListItem } from "@/src/lib/materialMarketIntelligenceMonitored";
import { MaterialMarketMonitoringBadge } from "@/src/components/materials/MaterialMarketMonitoringBadge";

type MonitoredMaterialsApiResponse = {
  items: MonitoredMaterialListItem[];
  total: number;
};

export function MaterialsMarketIntelligenceDetailPage() {
  const { materialId } = useParams<{ materialId: string }>();
  const [item, setItem] = useState<MonitoredMaterialListItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!materialId) {
      setError("Material não informado.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJsonOk<MonitoredMaterialsApiResponse>(
        MATERIALS_MARKET_INTELLIGENCE_MONITORED_API
      );
      const found = data.items.find((row) => row.id === materialId) ?? null;
      if (!found) {
        setError("Matéria-prima monitorada não encontrada ou monitoramento desativado.");
        setItem(null);
        return;
      }
      setItem(found);
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

  const title = useMemo(() => item?.description ?? "Inteligência de Mercado", [item]);

  return (
    <div className="space-y-6" data-testid="materials-market-intelligence-detail-page">
      <Link
        to={MATERIALS_SECTION_PATHS.marketIntelligence}
        className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline w-fit"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar para Inteligência de Mercado
      </Link>

      {loading ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card px-6 py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="mt-2 text-sm text-muted-foreground">Carregando inteligência…</p>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
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
              isMarketMonitored
              marketCriticality={item.marketCriticality}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            Painel individual em construção. Os sinais de mercado e histórico detalhado serão
            exibidos nesta rota nas próximas entregas.
          </p>
        </div>
      ) : null}
    </div>
  );
}
