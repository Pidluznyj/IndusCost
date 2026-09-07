/**
 * Compras → Performance — dashboard de performance de fornecedores.
 *
 * Container (fetch/estado) + View (apresentação). O frontend NÃO recalcula
 * métricas: consome o read model de /api/purchases/performance.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { PurchaseChainViewNav } from "@/src/components/supply-chain/PurchaseChainViewNav";
import { ContextualDashboardEmpty } from "@/src/components/contextual/ContextualDashboardEmpty";
import { OverlaySection } from "@/src/components/ui/overlay";
import {
  SUPPLIER_PERFORMANCE_DASHBOARD_DEFAULT_FILTERS,
  SUPPLIER_PERFORMANCE_DASHBOARD_DEFAULT_PRESET,
  type DashboardMaterialOption,
  type SupplierPerformanceDashboardFilters,
  type SupplierPerformanceDashboardReadModel,
} from "@/src/lib/purchasing/supplierPerformanceDashboard";
import {
  fetchSupplierPerformanceDashboard,
  searchSupplierPerformanceMaterialOptions,
} from "@/src/lib/purchasing/supplierPerformanceDashboardClient";
import {
  DASHBOARD_PERIOD_PRESET_OPTIONS,
  describeDashboardPeriodSelection,
  formatDashboardDateTime,
  formatDashboardInteger,
  periodSelectionCustom,
  periodSelectionFromPreset,
  periodSelectionFromYear,
  type DashboardPeriodSelection,
} from "@/src/lib/purchasing/supplierPerformanceDashboardUi";
import { PurchaseTrendChart } from "./SupplierPerformanceCharts";
import {
  AdvancedMetricsSection,
  ConcentrationSection,
  DashboardNotice,
  DashboardSection,
  DataRulesPanel,
  EvaluationSection,
  ExecutiveKpisSection,
  PricingSection,
  SupplierRankingsSection,
} from "./SupplierPerformanceSections";
import { SupplierMaterialMatrixSection } from "./SupplierMaterialMatrixSection";
import { SupplierScorecardOverlay } from "./SupplierScorecardOverlay";
import { MaterialDetailOverlay } from "./MaterialDetailOverlay";

export type SupplierPerformanceDashboardViewState =
  | { status: "loading"; data: SupplierPerformanceDashboardReadModel | null }
  | { status: "error"; message: string; data: SupplierPerformanceDashboardReadModel | null }
  | { status: "success"; data: SupplierPerformanceDashboardReadModel };

const CONTROL_CLASS = "rounded-md border border-border bg-white px-3 py-2 text-sm text-foreground";

/* ------------------------------------------------------------------ *
 * Filtros
 * ------------------------------------------------------------------ */

export function SupplierPerformanceFilters({
  selection,
  filters,
  data,
  materialOption,
  onSelectionChange,
  onFiltersChange,
  onMaterialOptionChange,
  onRefresh,
  loading,
}: {
  selection: DashboardPeriodSelection;
  filters: SupplierPerformanceDashboardFilters;
  data: SupplierPerformanceDashboardReadModel | null;
  materialOption: DashboardMaterialOption | null;
  onSelectionChange: (next: DashboardPeriodSelection) => void;
  onFiltersChange: (next: Partial<SupplierPerformanceDashboardFilters>) => void;
  onMaterialOptionChange: (next: DashboardMaterialOption | null) => void;
  onRefresh: () => void;
  loading: boolean;
}) {
  const [materialTerm, setMaterialTerm] = useState("");
  const [materialOptions, setMaterialOptions] = useState<DashboardMaterialOption[]>([]);
  const [materialSearching, setMaterialSearching] = useState(false);
  const years = data?.metadata.availableYears ?? [];
  const suppliers = data?.filterOptions.suppliers ?? [];
  const groups = data?.filterOptions.materialGroups ?? [];
  const currencies = data?.filterOptions.currencies ?? [];

  useEffect(() => {
    const term = materialTerm.trim();
    if (term.length < 2) {
      setMaterialOptions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setMaterialSearching(true);
      searchSupplierPerformanceMaterialOptions(filters, term, controller.signal)
        .then((payload) => {
          if (!controller.signal.aborted) setMaterialOptions(payload.materials);
        })
        .catch(() => {
          if (!controller.signal.aborted) setMaterialOptions([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setMaterialSearching(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialTerm, filters.period.from, filters.period.to, filters.includeCanceled]);

  const periodValue = selection.mode === "preset" ? selection.preset : selection.mode === "year" ? `year:${selection.year}` : "custom";

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-muted/30 p-3" data-testid="performance-filters">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Período
        <select
          value={periodValue}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "custom") onSelectionChange(periodSelectionCustom(filters.period));
            else if (value.startsWith("year:")) onSelectionChange(periodSelectionFromYear(Number(value.slice(5))));
            else onSelectionChange(periodSelectionFromPreset(value as Exclude<typeof selection, { mode: "custom" | "year" }>["preset"]));
          }}
          className={CONTROL_CLASS}
          data-testid="performance-filter-period"
        >
          {DASHBOARD_PERIOD_PRESET_OPTIONS.map((preset) => (
            <option key={preset.id} value={preset.id}>{preset.label}</option>
          ))}
          {years.map((year) => (
            <option key={year} value={`year:${year}`}>Ano {year}</option>
          ))}
          <option value="custom">Personalizado</option>
        </select>
      </label>
      {selection.mode === "custom" ? (
        <>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            De
            <input type="date" value={filters.period.from ?? ""} onChange={(event) => onSelectionChange(periodSelectionCustom({ from: event.target.value || null, to: filters.period.to }))} className={CONTROL_CLASS} data-testid="performance-filter-from" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Até
            <input type="date" value={filters.period.to ?? ""} onChange={(event) => onSelectionChange(periodSelectionCustom({ from: filters.period.from, to: event.target.value || null }))} className={CONTROL_CLASS} data-testid="performance-filter-to" />
          </label>
        </>
      ) : null}
      <label className="flex min-w-[14rem] flex-col gap-1 text-xs text-muted-foreground">
        Fornecedor
        <select
          value={filters.supplierExternalId ?? ""}
          onChange={(event) => onFiltersChange({ supplierExternalId: event.target.value ? Number(event.target.value) : null })}
          className={CONTROL_CLASS}
          data-testid="performance-filter-supplier"
        >
          <option value="">Todos os fornecedores</option>
          {suppliers.map((supplier) => (
            <option key={supplier.supplierExternalId} value={supplier.supplierExternalId}>
              {supplier.name} ({supplier.orderCount})
            </option>
          ))}
        </select>
      </label>
      <div className="flex min-w-[16rem] flex-col gap-1 text-xs text-muted-foreground">
        Matéria-prima
        {materialOption ? (
          <div className="flex items-center gap-2 rounded-md border border-border bg-white px-3 py-2 text-sm text-foreground">
            <span className="truncate" title={materialOption.description ?? undefined}>{materialOption.productCode ?? materialOption.description ?? materialOption.materialKey}</span>
            <button type="button" className="text-xs text-primary hover:underline" onClick={() => onMaterialOptionChange(null)} data-testid="performance-filter-material-clear">limpar</button>
          </div>
        ) : (
          <div className="relative">
            <input value={materialTerm} onChange={(event) => setMaterialTerm(event.target.value)} placeholder="Código ou descrição (mín. 2 letras)" className={`${CONTROL_CLASS} w-full`} data-testid="performance-filter-material" />
            {materialSearching ? <Loader2 className="absolute right-2 top-2.5 h-4 w-4 animate-spin text-muted-foreground" /> : null}
            {materialOptions.length > 0 ? (
              <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-white text-sm shadow-lg" role="listbox">
                {materialOptions.map((option) => (
                  <li key={option.materialKey}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      className="flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-primary/5"
                      onClick={() => {
                        onMaterialOptionChange(option);
                        setMaterialTerm("");
                        setMaterialOptions([]);
                      }}
                    >
                      <span className="font-medium">{option.productCode ?? option.materialKey}</span>
                      <span className="text-xs text-muted-foreground">{option.description ?? "—"} · {option.lineCount} linhas</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
      </div>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Grupo de material
        <select value={filters.materialGroup ?? ""} onChange={(event) => onFiltersChange({ materialGroup: event.target.value || null })} className={CONTROL_CLASS} data-testid="performance-filter-group">
          <option value="">Todos os grupos</option>
          {groups.map((group) => (
            <option key={group.group} value={group.group}>{group.group} ({group.lineCount})</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground" title="Fonte oficial não identificada no espelho de Pedido Nomus: idEmpresa existe apenas no payload bruto, sem cadastro de empresas vinculado.">
        Empresa
        <select disabled className={`${CONTROL_CLASS} cursor-not-allowed opacity-60`} data-testid="performance-filter-company">
          <option>Indisponível — fonte não identificada</option>
        </select>
      </label>
      {currencies.length > 1 ? (
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Moeda
          <select value={filters.currency ?? data?.metadata.currency.selected ?? ""} onChange={(event) => onFiltersChange({ currency: event.target.value || null })} className={CONTROL_CLASS} data-testid="performance-filter-currency">
            {currencies.map((currency) => (
              <option key={currency.currency} value={currency.currency}>{currency.currency} ({currency.orderCount})</option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="flex items-center gap-2 pb-2 text-sm">
        <input type="checkbox" checked={filters.includeCanceled} onChange={(event) => onFiltersChange({ includeCanceled: event.target.checked })} data-testid="performance-filter-canceled" />
        Incluir cancelados
      </label>
      <button type="button" onClick={onRefresh} disabled={loading} className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-3 py-2 text-sm disabled:opacity-60" data-testid="performance-refresh">
        <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
        Atualizar
      </button>
      <span className="pb-2 text-[11px] text-muted-foreground">{describeDashboardPeriodSelection(selection)}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * View
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
}) {
  const data = state.data;
  const loading = state.status === "loading";
  const empty = state.status === "success" && data.kpis.purchaseOrderCount === 0;

  return (
    <div className="space-y-6" data-testid="supplier-performance-dashboard">
      <PurchaseChainViewNav current="performance" variant="nomus" />
      <header>
        <h1 className="text-xl font-bold tracking-tight text-foreground">Performance de Fornecedores</h1>
        <p className="text-sm text-muted-foreground">
          Compras, concentração, mix, avaliação e competitividade da base de fornecedores. Espelho somente leitura do Nomus; toda métrica declara fórmula, fonte e escopo.
        </p>
      </header>

      <SupplierPerformanceFilters selection={selection} filters={filters} data={data} materialOption={materialOption} onSelectionChange={onSelectionChange} onFiltersChange={onFiltersChange} onMaterialOptionChange={onMaterialOptionChange} onRefresh={onRefresh} loading={loading} />

      {state.status === "error" ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-700" role="alert" data-testid="performance-error">
          <p className="font-semibold">Não foi possível carregar a performance de fornecedores.</p>
          <p>{state.message}</p>
          <button type="button" onClick={onRefresh} className="mt-2 rounded-md border border-rose-300 bg-white px-3 py-1 text-xs">Tentar novamente</button>
        </div>
      ) : null}

      {loading && !data ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-white px-4 py-10 text-sm text-muted-foreground" data-testid="performance-loading">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando performance de fornecedores…
        </div>
      ) : null}

      {data ? (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" data-testid="performance-meta">
            <span>Última sincronização Nomus: {formatDashboardDateTime(data.metadata.lastSyncedAt)}</span>
            <span>·</span>
            <span>Gerado em {formatDashboardDateTime(data.metadata.generatedAt)}</span>
            <span>·</span>
            <span>{formatDashboardInteger(data.metadata.population.orderCount)} pedidos · {formatDashboardInteger(data.metadata.population.lineCount)} linhas · {formatDashboardInteger(data.metadata.population.supplierCount)} fornecedores</span>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          </div>

          {data.metadata.currency.multiCurrency ? (
            <DashboardNotice tone="warning" title="Base multimoeda" testId="performance-notice-currency">
              Exibindo apenas {data.metadata.currency.selected}. Pedidos em outras moedas ({data.metadata.currency.available.filter((c) => c.currency !== data.metadata.currency.selected).map((c) => `${c.currency}: ${c.orderCount}`).join(", ")}) não são somados — não há câmbio oficial. Use o filtro de moeda para analisá-los.
            </DashboardNotice>
          ) : null}
          {data.evaluation.available === false ? (
            <DashboardNotice tone="info" title="Avaliação de fornecedor indisponível" testId="performance-notice-evaluation">{data.evaluation.reason}</DashboardNotice>
          ) : null}
          {data.metadata.population.unresolvedSupplierOrders > 0 || data.metadata.population.unresolvedMaterialLines > 0 ? (
            <DashboardNotice tone="info" title="Dados parciais" testId="performance-notice-partial">
              {data.metadata.population.unresolvedSupplierOrders > 0 ? `${formatDashboardInteger(data.metadata.population.unresolvedSupplierOrders)} pedidos sem ID de fornecedor entram no total, mas não em rankings por fornecedor. ` : ""}
              {data.metadata.population.unresolvedMaterialLines > 0 ? `${formatDashboardInteger(data.metadata.population.unresolvedMaterialLines)} linhas sem ID/código de produto ficam fora das análises por matéria-prima.` : ""}
            </DashboardNotice>
          ) : null}

          {empty ? (
            <ContextualDashboardEmpty message="Nenhuma compra encontrada para o período e filtros selecionados." />
          ) : (
            <>
              <ExecutiveKpisSection data={data} onSelectSupplier={onSelectSupplier} />
              <ConcentrationSection data={data} onSelectSupplier={onSelectSupplier} onSelectMaterial={onSelectMaterial} />
              <SupplierRankingsSection data={data} onSelectSupplier={onSelectSupplier} />
              <DashboardSection title="Compras ao longo do tempo" eyebrow="Seção 4" description="Agrupado por mês da data operacional do pedido (emissão; firstSeenAt quando ausente). Barras: valor comprado. Linhas: nº de pedidos e fornecedores ativos." testId="performance-trend-section">
                <OverlaySection title="Evolução das compras" testId="performance-trend">
                  <PurchaseTrendChart points={data.charts.monthly} currency={data.metadata.currency.selected} />
                </OverlaySection>
              </DashboardSection>
              {matrix}
              <PricingSection data={data} onSelectSupplier={onSelectSupplier} onSelectMaterial={onSelectMaterial} />
              <EvaluationSection data={data} onSelectSupplier={onSelectSupplier} />
            </>
          )}
          <AdvancedMetricsSection data={data} />
          <DataRulesPanel data={data} />
        </>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Container
 * ------------------------------------------------------------------ */

export function SupplierPerformanceDashboardPage() {
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

  useEffect(() => {
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
  }, [filterKey, reloadToken]);

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
        matrix={<SupplierMaterialMatrixSection filters={filters} onSelectSupplier={setSelectedSupplier} onSelectMaterial={setSelectedMaterial} />}
      />
      <SupplierScorecardOverlay supplierExternalId={selectedSupplier} filters={filters} onClose={() => setSelectedSupplier(null)} onSelectMaterial={(key) => { setSelectedSupplier(null); setSelectedMaterial(key); }} />
      <MaterialDetailOverlay materialKey={selectedMaterial} filters={filters} onClose={() => setSelectedMaterial(null)} onSelectSupplier={(id) => { setSelectedMaterial(null); setSelectedSupplier(id); }} />
    </>
  );
}
