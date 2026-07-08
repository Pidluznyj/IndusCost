import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Search, X } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";
import {
  MATERIAL_MARKET_CRITICALITY_LABELS,
  MATERIAL_MARKET_CRITICALITY_VALUES,
  type MaterialMarketCriticality,
} from "@/src/lib/materialMarketMonitoring";
import type { MonitoredMaterialListItem } from "@/src/lib/materialMarketIntelligenceMonitored";
import { MONITORED_MATERIALS_EMPTY_FILTER_MESSAGE } from "@/src/lib/materialMarketIntelligenceMonitored";
import {
  MATERIALS_MARKET_INTELLIGENCE_MONITORED_API,
} from "@/src/lib/materialsNavigation";
import { ContextualDashboardEmpty } from "@/src/components/contextual/ContextualDashboardEmpty";
import { MaterialMarketMonitoringBadge } from "@/src/components/materials/MaterialMarketMonitoringBadge";
import { MaterialMarketSituationBadge } from "@/src/components/materials/MaterialMarketSituationBadge";
import { MATERIALS_MARKET_INTELLIGENCE_EMPTY_MESSAGE } from "@/src/components/materials/MaterialsMarketIntelligencePage";

type MonitoredMaterialsApiResponse = {
  items: MonitoredMaterialListItem[];
  total: number;
  filters?: { q: string; criticality: MaterialMarketCriticality | null };
};

function formatLastQuoteDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

export function MaterialsMarketIntelligenceMonitoredList() {
  const [items, setItems] = useState<MonitoredMaterialListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [criticalityFilter, setCriticalityFilter] = useState<"" | MaterialMarketCriticality>("");
  const [baselineTotal, setBaselineTotal] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      const q = searchTerm.trim();
      if (q) params.set("q", q);
      if (criticalityFilter) params.set("criticality", criticalityFilter);
      const qs = params.toString();
      const url = qs
        ? `${MATERIALS_MARKET_INTELLIGENCE_MONITORED_API}?${qs}`
        : MATERIALS_MARKET_INTELLIGENCE_MONITORED_API;

      const data = await fetchJsonOk<MonitoredMaterialsApiResponse>(url);
      setItems(Array.isArray(data.items) ? data.items : []);
      if (!q && !criticalityFilter) {
        setBaselineTotal(data.total ?? 0);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar matérias monitoradas.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [searchTerm, criticalityFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const emptyMessage = useMemo(() => {
    if (baselineTotal === 0) return MATERIALS_MARKET_INTELLIGENCE_EMPTY_MESSAGE;
    if (searchTerm.trim() || criticalityFilter) return MONITORED_MATERIALS_EMPTY_FILTER_MESSAGE;
    return MATERIALS_MARKET_INTELLIGENCE_EMPTY_MESSAGE;
  }, [baselineTotal, searchTerm, criticalityFilter]);

  const clearFilters = () => {
    setSearchTerm("");
    setCriticalityFilter("");
  };

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
      <div className="space-y-3" data-testid="materials-market-intelligence-error">
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
    );
  }

  return (
    <div className="space-y-4" data-testid="materials-market-intelligence-monitored-list">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por código ou descrição..."
            className="w-full rounded-lg border border-border bg-card py-2 pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            data-testid="materials-market-intelligence-search"
          />
        </div>
        <select
          value={criticalityFilter}
          onChange={(e) =>
            setCriticalityFilter(e.target.value as "" | MaterialMarketCriticality)
          }
          className="min-w-[180px] rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
          data-testid="materials-market-intelligence-criticality-filter"
        >
          <option value="">Todas as criticidades</option>
          {MATERIAL_MARKET_CRITICALITY_VALUES.map((value) => (
            <option key={value} value={value}>
              {MATERIAL_MARKET_CRITICALITY_LABELS[value]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={clearFilters}
          disabled={!searchTerm.trim() && !criticalityFilter}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          <X className="h-4 w-4" />
          Limpar
        </button>
      </div>

      {items.length === 0 ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <ContextualDashboardEmpty message={emptyMessage} />
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left border-collapse">
              <thead>
                <tr className="border-b border-border bg-accent/40">
                  <th className="p-4 text-sm font-semibold">Código</th>
                  <th className="p-4 text-sm font-semibold">Descrição</th>
                  <th className="p-4 text-sm font-semibold">Família</th>
                  <th className="p-4 text-sm font-semibold">Unidade</th>
                  <th className="p-4 text-sm font-semibold">Criticidade</th>
                  <th className="p-4 text-sm font-semibold">Situação</th>
                  <th className="p-4 text-sm font-semibold">Última cotação</th>
                  <th className="p-4 text-sm font-semibold text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((mat) => (
                  <tr key={mat.id} className="hover:bg-accent/20 transition-colors">
                    <td className="p-4 text-sm font-mono font-medium">{mat.code}</td>
                    <td className="p-4 text-sm font-medium max-w-xs">{mat.description}</td>
                    <td className="p-4 text-sm text-muted-foreground">{mat.family}</td>
                    <td className="p-4 text-sm text-muted-foreground">{mat.unit}</td>
                    <td className="p-4">
                      <MaterialMarketMonitoringBadge
                        isMarketMonitored
                        marketCriticality={mat.marketCriticality}
                      />
                    </td>
                    <td className="p-4">
                      <MaterialMarketSituationBadge situation={mat.marketSituation} />
                    </td>
                    <td className="p-4 text-sm">
                      {mat.lastQuoteAmount != null ? (
                        <div>
                          <p className="font-medium">{formatCurrency(mat.lastQuoteAmount)}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatLastQuoteDate(mat.lastQuoteDate)}
                          </p>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-4 text-right">
                      <Link
                        to={mat.intelligencePath}
                        className="inline-flex items-center rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
                        data-testid={`material-market-intelligence-view-${mat.id}`}
                      >
                        Ver Inteligência
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
            Exibindo {formatNumber(items.length, 0)} matéria(s) monitorada(s)
          </p>
        </div>
      )}
    </div>
  );
}
