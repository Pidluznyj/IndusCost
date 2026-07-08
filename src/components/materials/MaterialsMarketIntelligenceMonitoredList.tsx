import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import type { Material } from "@/src/types/material";
import { ContextualDashboardEmpty } from "@/src/components/contextual/ContextualDashboardEmpty";
import { MaterialMarketMonitoringBadge } from "@/src/components/materials/MaterialMarketMonitoringBadge";
import { MATERIALS_MARKET_INTELLIGENCE_EMPTY_MESSAGE } from "@/src/components/materials/MaterialsMarketIntelligencePage";
import { formatNumber } from "@/src/lib/utils";

export function MaterialsMarketIntelligenceMonitoredList() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJsonOk<Material[]>("/api/materials");
      setMaterials(Array.isArray(data) ? data : []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar matérias-primas.");
      setMaterials([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const monitored = useMemo(
    () => materials.filter((m) => m.isMarketMonitored === true),
    [materials]
  );

  if (loading) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-xl border border-border bg-card px-6 py-12"
        data-testid="materials-market-intelligence-loading"
      >
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="mt-2 text-sm text-muted-foreground">Carregando matérias monitoradas…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
        data-testid="materials-market-intelligence-error"
      >
        {error}
      </div>
    );
  }

  if (monitored.length === 0) {
    return (
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <ContextualDashboardEmpty message={MATERIALS_MARKET_INTELLIGENCE_EMPTY_MESSAGE} />
      </div>
    );
  }

  return (
    <div
      className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"
      data-testid="materials-market-intelligence-monitored-list"
    >
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border bg-accent/40">
              <th className="p-4 text-sm font-semibold">Material</th>
              <th className="p-4 text-sm font-semibold">Criticidade</th>
              <th className="p-4 text-sm font-semibold">Frequência</th>
              <th className="p-4 text-sm font-semibold">Observações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {monitored.map((mat) => (
              <tr key={mat.id} className="hover:bg-accent/20 transition-colors">
                <td className="p-4">
                  <p className="text-sm font-medium">{mat.description}</p>
                  <p className="text-xs text-muted-foreground">{mat.code}</p>
                </td>
                <td className="p-4">
                  <MaterialMarketMonitoringBadge
                    isMarketMonitored
                    marketCriticality={mat.marketCriticality}
                  />
                </td>
                <td className="p-4 text-sm text-muted-foreground">
                  {mat.marketMonitoringFrequencyDays != null
                    ? `${formatNumber(mat.marketMonitoringFrequencyDays, 0)} dias`
                    : "—"}
                </td>
                <td className="p-4 text-sm text-muted-foreground max-w-xs truncate">
                  {mat.marketNotes?.trim() || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
