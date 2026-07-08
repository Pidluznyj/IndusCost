import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  BarChart3,
  Clock,
  DollarSign,
  Droplets,
  Factory,
  FileSearch,
  History,
  Loader2,
  Truck,
} from "lucide-react";
import { fetchJsonOk, fetchOk } from "@/src/lib/http";
import type { MaterialIntelligenceDetailItem } from "@/src/lib/materialMarketIntelligenceDetail";
import type { MaterialMarketCriticality } from "@/src/lib/materialMarketMonitoring";
import { MATERIAL_INTELLIGENCE_360_PLACEHOLDER_SECTIONS } from "@/src/lib/materialIntelligence360Sections";
import {
  getMaterialMarketIntelligenceDetailApiPath,
  MATERIALS_SECTION_PATHS,
} from "@/src/lib/materialsNavigation";
import {
  MaterialIntelligenceActivatePanel,
  DEFAULT_MATERIAL_MARKET_CRITICALITY,
  DEFAULT_MATERIAL_MARKET_MONITORING_FREQUENCY_DAYS,
} from "@/src/components/materials/MaterialIntelligenceActivatePanel";
import { MaterialIntelligence360Header } from "@/src/components/materials/MaterialIntelligence360Header";
import { MaterialIntelligenceRecentQuotesSection } from "@/src/components/materials/MaterialIntelligenceRecentQuotesSection";
import { MaterialIntelligence360SectionPlaceholder } from "@/src/components/materials/MaterialIntelligence360Section";

const PLACEHOLDER_ICONS: Record<string, React.ReactNode> = {
  priceHistory: <History className="h-7 w-7" aria-hidden="true" />,
  suppliers: <Truck className="h-7 w-7" aria-hidden="true" />,
  dollar: <DollarSign className="h-7 w-7" aria-hidden="true" />,
  brent: <Droplets className="h-7 w-7" aria-hidden="true" />,
  impactedProducts: <Factory className="h-7 w-7" aria-hidden="true" />,
  timeline: <Clock className="h-7 w-7" aria-hidden="true" />,
  audit: <FileSearch className="h-7 w-7" aria-hidden="true" />,
};

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
          <p className="mt-2 text-sm text-muted-foreground">Carregando visão 360º…</p>
        </div>
      ) : error && !item ? (
        <div
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
          data-testid="materials-market-intelligence-detail-error"
        >
          {error}
        </div>
      ) : item ? (
        <div className="space-y-6" data-testid="material-intelligence-360-page">
          <MaterialIntelligence360Header item={item} />

          {!item.isMarketMonitored ? (
            <MaterialIntelligenceActivatePanel
              criticality={activationCriticality}
              frequency={activationFrequency}
              activating={activating}
              error={error}
              onCriticalityChange={setActivationCriticality}
              onFrequencyChange={setActivationFrequency}
              onActivate={() => void handleActivateMonitoring()}
            />
          ) : null}

          <div
            className="grid gap-4 xl:grid-cols-2"
            data-testid="material-intelligence-360-sections"
          >
            <MaterialIntelligenceRecentQuotesSection quotes={item.recentQuotes} />

            {MATERIAL_INTELLIGENCE_360_PLACEHOLDER_SECTIONS.map((section) => (
              <MaterialIntelligence360SectionPlaceholder
                key={section.id}
                id={section.id}
                title={section.title}
                description={section.description}
                message={section.emptyMessage}
                icon={PLACEHOLDER_ICONS[section.id] ?? <BarChart3 className="h-7 w-7" />}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
