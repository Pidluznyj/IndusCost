/**
 * Compras → Performance — dashboard de performance de fornecedores.
 *
 * Container (fetch/estado) + View (apresentação). O frontend NÃO recalcula
 * métricas: consome o read model de /api/purchases/performance e, na sub-aba de
 * classificação, o read model de /api/purchases/performance/classification.
 *
 * Sub-abas: [ Visão geral ] [ Classificação de fornecedores ], com o estado
 * refletido em `?view=` para o deep link sobreviver a refresh/back/forward.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { ContextualDashboardEmpty } from "@/src/components/contextual/ContextualDashboardEmpty";
import { OverlaySection } from "@/src/components/ui/overlay";
import {
  SUPPLIER_PERFORMANCE_DASHBOARD_DEFAULT_FILTERS,
  SUPPLIER_PERFORMANCE_DASHBOARD_DEFAULT_PRESET,
  type DashboardMaterialOption,
  type SupplierPerformanceDashboardFilters,
  type SupplierPerformanceDashboardReadModel,
} from "@/src/lib/purchasing/supplierPerformanceDashboard";
import { fetchSupplierPerformanceDashboard } from "@/src/lib/purchasing/supplierPerformanceDashboardClient";
import {
  SUPPLIER_PERFORMANCE_VIEW_PARAM,
  formatDashboardInteger,
  parseSupplierPerformanceViewParam,
  periodSelectionFromPreset,
  type DashboardPeriodSelection,
  type SupplierPerformanceViewId,
} from "@/src/lib/purchasing/supplierPerformanceDashboardUi";
import { PurchaseTrendChart } from "./SupplierPerformanceCharts";
import {
  AdvancedMetricsSection,
  ConcentrationSection,
  DashboardNotice,
  DashboardSection,
  DataQualityBar,
  DataRulesPanel,
  EvaluationSection,
  ExecutiveKpisSection,
  PricingSection,
  SupplierRankingsSection,
} from "./SupplierPerformanceSections";
import { SupplierMaterialMatrixSection } from "./SupplierMaterialMatrixSection";
import { SupplierClassificationPage } from "./SupplierClassificationSection";
import { SupplierScorecardOverlay } from "./SupplierScorecardOverlay";
import { MaterialDetailOverlay } from "./MaterialDetailOverlay";
import {
  SupplierPerformanceFilters,
  SupplierPerformanceShell,
  filterOptionsFromDashboard,
} from "./SupplierPerformanceShell";

/** Reexportado para os consumidores/testes que já apontavam para este módulo. */
export {
  EMPTY_PERFORMANCE_FILTER_OPTIONS,
  SupplierPerformanceFilters,
  SupplierPerformanceShell,
  SupplierPerformanceViewNav,
  filterOptionsFromDashboard,
  type PerformanceFilterOptions,
} from "./SupplierPerformanceShell";

export type SupplierPerformanceDashboardViewState =
  | { status: "loading"; data: SupplierPerformanceDashboardReadModel | null }
  | { status: "error"; message: string; data: SupplierPerformanceDashboardReadModel | null }
  | { status: "success"; data: SupplierPerformanceDashboardReadModel };

/* ------------------------------------------------------------------ *
 * View — Visão geral
 * ------------------------------------------------------------------ */

export function SupplierPerformanceDashboardView({
  state,
  filters,
  selection,
  materialOption,
  onSelectionChange,
  onFiltersChange,
  onMaterialOptionChange,
  onRefresh,
  onSelectSupplier,
  onSelectMaterial,
  matrix,
  view = "overview",
  onViewChange,
}: {
  state: SupplierPerformanceDashboardViewState;
  filters: SupplierPerformanceDashboardFilters;
  selection: DashboardPeriodSelection;
  materialOption: DashboardMaterialOption | null;
  onSelectionChange: (next: DashboardPeriodSelection) => void;
  onFiltersChange: (next: Partial<SupplierPerformanceDashboardFilters>) => void;
  onMaterialOptionChange: (next: DashboardMaterialOption | null) => void;
  onRefresh: () => void;
  onSelectSupplier: (id: number) => void;
  onSelectMaterial: (key: string) => void;
  /** Slot da matriz (container com fetch próprio) — opcional em testes. */
  matrix?: React.ReactNode;
  view?: SupplierPerformanceViewId;
  onViewChange?: (next: SupplierPerformanceViewId) => void;
}) {
  const data = state.data;
  const loading = state.status === "loading";
  const empty = state.status === "success" && data.kpis.purchaseOrderCount === 0;

  return (
    <SupplierPerformanceShell
      view={view}
      onViewChange={onViewChange ?? (() => undefined)}
      title="Performance de fornecedores"
      description="Compras, concentração, risco e desempenho da base de fornecedores."
      filtersSlot={
        <SupplierPerformanceFilters
          selection={selection}
          filters={filters}
          options={filterOptionsFromDashboard(data)}
          materialOption={materialOption}
          onSelectionChange={onSelectionChange}
          onFiltersChange={onFiltersChange}
          onMaterialOptionChange={onMaterialOptionChange}
          onRefresh={onRefresh}
          loading={loading}
        />
      }
    >
      {state.status === "error" ? (
        <div
          className="rounded-md border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-700"
          role="alert"
          data-testid="performance-error"
        >
          <p className="font-semibold">Não foi possível carregar a performance de fornecedores.</p>
          <p>{state.message}</p>
          <button
            type="button"
            onClick={onRefresh}
            className="mt-2 rounded-md border border-rose-300 bg-white px-3 py-1 text-xs"
          >
            Tentar novamente
          </button>
        </div>
      ) : null}

      {loading && !data ? (
        <div
          className="flex items-center gap-2 rounded-md border border-border bg-white px-4 py-10 text-sm text-muted-foreground"
          data-testid="performance-loading"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Carregando performance de fornecedores…
        </div>
      ) : null}

      {data ? (
        <div className="space-y-6">
          <DataQualityBar data={data} />
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden /> : null}

          {data.metadata.currency.multiCurrency ? (
            <DashboardNotice tone="warning" title="Base multimoeda" testId="performance-notice-currency">
              Exibindo apenas {data.metadata.currency.selected}. Pedidos em outras moedas (
              {data.metadata.currency.available
                .filter((c) => c.currency !== data.metadata.currency.selected)
                .map((c) => `${c.currency}: ${c.orderCount}`)
                .join(", ")}
              ) não são somados — não há câmbio oficial. Use o filtro de moeda para analisá-los.
            </DashboardNotice>
          ) : null}
          {data.evaluation.available === false ? (
            <DashboardNotice tone="info" title="Avaliação de fornecedor indisponível" testId="performance-notice-evaluation">
              {data.evaluation.reason}
            </DashboardNotice>
          ) : null}
          {data.metadata.population.unresolvedSupplierOrders > 0 ||
          data.metadata.population.unresolvedMaterialLines > 0 ? (
            <DashboardNotice tone="info" title="Identidade parcial" testId="performance-notice-partial">
              {data.metadata.population.unresolvedSupplierOrders > 0
                ? `${formatDashboardInteger(data.metadata.population.unresolvedSupplierOrders)} pedidos sem ID de fornecedor entram no total, mas não em rankings por fornecedor. `
                : ""}
              {data.metadata.population.unresolvedMaterialLines > 0
                ? `${formatDashboardInteger(data.metadata.population.unresolvedMaterialLines)} linhas sem ID/código de produto ficam fora das análises por matéria-prima.`
                : ""}
            </DashboardNotice>
          ) : null}

          {empty ? (
            <ContextualDashboardEmpty message="Nenhuma compra encontrada para o período e filtros selecionados." />
          ) : (
            <>
              <ExecutiveKpisSection data={data} onSelectSupplier={onSelectSupplier} />
              <ConcentrationSection data={data} onSelectSupplier={onSelectSupplier} onSelectMaterial={onSelectMaterial} />
              <SupplierRankingsSection data={data} onSelectSupplier={onSelectSupplier} />
              <DashboardSection
                title="Compras ao longo do tempo"
                description="Agrupado por mês da data operacional do pedido (emissão; firstSeenAt quando ausente)."
                testId="performance-trend-section"
              >
                <OverlaySection title="Evolução das compras" testId="performance-trend">
                  <PurchaseTrendChart
                    points={data.charts.monthly}
                    currency={data.metadata.currency.selected}
                    hideSpend={data.metadata.population.financialDataStatus === "UNAVAILABLE"}
                  />
                </OverlaySection>
              </DashboardSection>
              {matrix}
              <PricingSection data={data} onSelectSupplier={onSelectSupplier} onSelectMaterial={onSelectMaterial} />
              <EvaluationSection data={data} onSelectSupplier={onSelectSupplier} />
            </>
          )}
          <AdvancedMetricsSection data={data} />
          <DataRulesPanel data={data} />
        </div>
      ) : null}
    </SupplierPerformanceShell>
  );
}

/* ------------------------------------------------------------------ *
 * Container
 * ------------------------------------------------------------------ */

export function SupplierPerformanceDashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = parseSupplierPerformanceViewParam(searchParams.get(SUPPLIER_PERFORMANCE_VIEW_PARAM));

  const [selection, setSelection] = useState<DashboardPeriodSelection>(() =>
    periodSelectionFromPreset(SUPPLIER_PERFORMANCE_DASHBOARD_DEFAULT_PRESET)
  );
  const [filters, setFilters] = useState<SupplierPerformanceDashboardFilters>(() => ({
    ...SUPPLIER_PERFORMANCE_DASHBOARD_DEFAULT_FILTERS,
    period: periodSelectionFromPreset(SUPPLIER_PERFORMANCE_DASHBOARD_DEFAULT_PRESET).period,
  }));
  const [materialOption, setMaterialOption] = useState<DashboardMaterialOption | null>(null);
  const [state, setState] = useState<SupplierPerformanceDashboardViewState>({ status: "loading", data: null });
  const [reloadToken, setReloadToken] = useState(0);
  const [selectedSupplier, setSelectedSupplier] = useState<number | null>(null);
  const [selectedMaterial, setSelectedMaterial] = useState<string | null>(null);

  const filterKey = useMemo(() => JSON.stringify(filters), [filters]);

  // A visão geral é a única consumidora deste read model; a classificação tem o
  // seu próprio (mesma população, mesmo motor) e não paga por esta consulta.
  useEffect(() => {
    if (view !== "overview") return;
    const controller = new AbortController();
    setState((prev) => ({ status: "loading", data: prev.data }));
    fetchSupplierPerformanceDashboard(filters, controller.signal)
      .then((payload) => {
        if (!controller.signal.aborted) setState({ status: "success", data: payload });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setState((prev) => ({
          status: "error",
          message: err instanceof Error ? err.message : "Falha ao carregar o dashboard.",
          data: prev.data,
        }));
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, reloadToken, view]);

  const handleViewChange = useCallback(
    (next: SupplierPerformanceViewId) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next === "overview") params.delete(SUPPLIER_PERFORMANCE_VIEW_PARAM);
          else params.set(SUPPLIER_PERFORMANCE_VIEW_PARAM, next);
          return params;
        },
        { replace: false }
      );
    },
    [setSearchParams]
  );

  const handleSelectionChange = useCallback((next: DashboardPeriodSelection) => {
    setSelection(next);
    setFilters((prev) => ({ ...prev, period: next.period }));
  }, []);

  const handleFiltersChange = useCallback((next: Partial<SupplierPerformanceDashboardFilters>) => {
    setFilters((prev) => ({ ...prev, ...next }));
  }, []);

  const handleMaterialOptionChange = useCallback((next: DashboardMaterialOption | null) => {
    setMaterialOption(next);
    setFilters((prev) => ({ ...prev, materialKey: next?.materialKey ?? null }));
  }, []);

  const refresh = useCallback(() => setReloadToken((token) => token + 1), []);

  return (
    <>
      {view === "classification" ? (
        <SupplierClassificationPage
          view={view}
          onViewChange={handleViewChange}
          filters={filters}
          selection={selection}
          materialOption={materialOption}
          onSelectionChange={handleSelectionChange}
          onFiltersChange={handleFiltersChange}
          onMaterialOptionChange={handleMaterialOptionChange}
          onSelectSupplier={setSelectedSupplier}
          reloadToken={reloadToken}
          onRefresh={refresh}
        />
      ) : (
        <SupplierPerformanceDashboardView
          state={state}
          filters={filters}
          selection={selection}
          materialOption={materialOption}
          onSelectionChange={handleSelectionChange}
          onFiltersChange={handleFiltersChange}
          onMaterialOptionChange={handleMaterialOptionChange}
          onRefresh={refresh}
          onSelectSupplier={setSelectedSupplier}
          onSelectMaterial={setSelectedMaterial}
          view={view}
          onViewChange={handleViewChange}
          matrix={
            <SupplierMaterialMatrixSection
              filters={filters}
              onSelectSupplier={setSelectedSupplier}
              onSelectMaterial={setSelectedMaterial}
            />
          }
        />
      )}
      <SupplierScorecardOverlay
        supplierExternalId={selectedSupplier}
        filters={filters}
        onClose={() => setSelectedSupplier(null)}
        onSelectMaterial={(key) => {
          setSelectedSupplier(null);
          setSelectedMaterial(key);
        }}
      />
      <MaterialDetailOverlay
        materialKey={selectedMaterial}
        filters={filters}
        onClose={() => setSelectedMaterial(null)}
        onSelectSupplier={(id) => {
          setSelectedMaterial(null);
          setSelectedSupplier(id);
        }}
      />
    </>
  );
}
