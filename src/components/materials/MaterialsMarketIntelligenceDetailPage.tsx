import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  BarChart3,
  FileSearch,
  Loader2,
} from "lucide-react";
import { fetchJsonOk, fetchOk } from "@/src/lib/http";
import type { MaterialIntelligenceDetailItem } from "@/src/lib/materialMarketIntelligenceDetail";
import type { MaterialMarketQuoteApiItem } from "@/src/lib/materialMarketQuote";
import type { MaterialMarketCriticality } from "@/src/lib/materialMarketMonitoring";
import { MATERIAL_INTELLIGENCE_360_PLACEHOLDER_SECTIONS } from "@/src/lib/materialIntelligence360Sections";
import {
  getMaterialMarketIntelligenceDetailApiPath,
  getMaterialMarketIntelligenceQuotesApiPath,
  MATERIALS_SECTION_PATHS,
} from "@/src/lib/materialsNavigation";
import {
  MaterialIntelligenceActivatePanel,
  DEFAULT_MATERIAL_MARKET_CRITICALITY,
  DEFAULT_MATERIAL_MARKET_MONITORING_FREQUENCY_DAYS,
} from "@/src/components/materials/MaterialIntelligenceActivatePanel";
import { MaterialIntelligence360Header } from "@/src/components/materials/MaterialIntelligence360Header";
import { MaterialIntelligenceRecentQuotesSection } from "@/src/components/materials/MaterialIntelligenceRecentQuotesSection";
import { MaterialIntelligencePriceHistoryChart } from "@/src/components/materials/MaterialIntelligencePriceHistoryChart";
import { MaterialIntelligenceComparativeChart } from "@/src/components/materials/MaterialIntelligenceComparativeChart";
import { MaterialIntelligencePriceAnalyticsSection } from "@/src/components/materials/MaterialIntelligencePriceAnalyticsSection";
import { MaterialIntelligenceFxDecompositionSection } from "@/src/components/materials/MaterialIntelligenceFxDecompositionSection";
import { MaterialIntelligenceSavingsOpportunitySection } from "@/src/components/materials/MaterialIntelligenceSavingsOpportunitySection";
import { MaterialIntelligenceSuppliersSection } from "@/src/components/materials/MaterialIntelligenceSuppliersSection";
import { MaterialIntelligenceAlertsSection } from "@/src/components/materials/MaterialMarketAlertsList";
import { MaterialIntelligenceImpactedProductsSection } from "@/src/components/materials/MaterialIntelligenceImpactedProductsSection";
import { MaterialIntelligenceSimulationPanel } from "@/src/components/materials/MaterialIntelligenceSimulationPanel";
import { MaterialIntelligence360SectionPlaceholder } from "@/src/components/materials/MaterialIntelligence360Section";

const PLACEHOLDER_ICONS: Record<string, React.ReactNode> = {
  audit: <FileSearch className="h-7 w-7" aria-hidden="true" />,
};

export function MaterialsMarketIntelligenceDetailPage() {
  const { materialId } = useParams<{ materialId: string }>();
  const [item, setItem] = useState<MaterialIntelligenceDetailItem | null>(null);
  const [quotes, setQuotes] = useState<MaterialMarketQuoteApiItem[]>([]);
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const [activationCriticality, setActivationCriticality] = useState<MaterialMarketCriticality>(
    DEFAULT_MATERIAL_MARKET_CRITICALITY
  );
  const [activationFrequency, setActivationFrequency] = useState(
    DEFAULT_MATERIAL_MARKET_MONITORING_FREQUENCY_DAYS
  );

  const loadQuotes = useCallback(async () => {
    if (!materialId) return;
    setQuotesLoading(true);
    try {
      const data = await fetchJsonOk<{ items: MaterialMarketQuoteApiItem[] }>(
        getMaterialMarketIntelligenceQuotesApiPath(materialId)
      );
      setQuotes(Array.isArray(data.items) ? data.items : []);
    } catch {
      setQuotes([]);
    } finally {
      setQuotesLoading(false);
    }
  }, [materialId]);

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
      await loadQuotes();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar a inteligência.");
      setItem(null);
    } finally {
      setLoading(false);
    }
  }, [materialId, loadQuotes]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleQuoteCreated = async () => {
    await loadQuotes();
    await load();
  };

  const headerItem = useMemo(() => {
    if (!item) return null;
    const latest = quotes[0];
    if (!latest) return item;
    return {
      ...item,
      lastQuoteAmount: latest.netPrice,
      lastQuoteDate: latest.quoteDate,
      recentQuotes: quotes,
    };
  }, [item, quotes]);

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
          <MaterialIntelligence360Header item={headerItem ?? item} />

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

          <MaterialIntelligenceSimulationPanel materialId={item.id} unit={item.unit} />

          <div
            className="grid gap-4 xl:grid-cols-2"
            data-testid="material-intelligence-360-sections"
          >
            <MaterialIntelligenceRecentQuotesSection
              materialId={item.id}
              defaultUnit={item.unit}
              quotes={quotes}
              loading={quotesLoading}
              onQuoteCreated={() => void handleQuoteCreated()}
            />

            <MaterialIntelligencePriceHistoryChart materialId={item.id} unit={item.unit} />

            <MaterialIntelligenceComparativeChart materialId={item.id} unit={item.unit} />

            <MaterialIntelligencePriceAnalyticsSection materialId={item.id} />

            <MaterialIntelligenceFxDecompositionSection
              materialId={item.id}
              materialName={item.description}
            />

            <MaterialIntelligenceSavingsOpportunitySection
              materialId={item.id}
              unit={item.unit}
            />

            <MaterialIntelligenceSuppliersSection materialId={item.id} />

            <MaterialIntelligenceAlertsSection materialId={item.id} />

            <MaterialIntelligenceImpactedProductsSection materialId={item.id} />

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
