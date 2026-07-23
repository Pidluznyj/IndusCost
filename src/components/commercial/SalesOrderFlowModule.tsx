import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";
import {
  Ban,
  CircleDollarSign,
  Clock3,
  FolderKanban,
  Loader2,
  PackageCheck,
  ShieldAlert,
  Truck,
  WalletCards,
} from "lucide-react";
import { SalesOrderFlowAnalyticsPanel } from "@/src/components/commercial/SalesOrderFlowAnalyticsPanel";
import { SalesOrderFlowFiltersBar } from "@/src/components/commercial/SalesOrderFlowFiltersBar";
import { buildSalesOrderFlowKanbanColumnViews } from "@/src/components/commercial/SalesOrderFlowKanbanBoard";
import { SalesOrderFlowKanbanFullscreen } from "@/src/components/commercial/SalesOrderFlowKanbanFullscreen";
import { SalesOrderFlowDetailDrawer } from "@/src/components/commercial/SalesOrderFlowDetailDrawer";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import {
  SYSTEM_TOTALIZER_GRID_CLASS,
  SystemTotalizerCard,
} from "@/src/components/ui/SystemTotalizerCard";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { fetchJsonOk } from "@/src/lib/http";
import { getSalesOrderSellerFilterOptionsUrl } from "@/src/lib/salesOrderListReportExportUi";
import type { SalesOrderSellerFilterOption } from "@/src/lib/salesOrderNomusSellerDisplay";
import {
  fetchSalesOrderFlowFeatureStatus,
  fetchSalesOrderFlowList,
  fetchSalesOrderFlowSummary,
  type SalesOrderFlowClientQuery,
  type SalesOrderFlowSummaryPayload,
} from "@/src/lib/salesOrderFlowClient";
import { buildSalesOrderFlowAnalyticsModel } from "@/src/lib/salesOrderFlowAnalytics";
import {
  applySalesOrderFlowColumnError,
  applySalesOrderFlowColumnPage,
  buildSalesOrderFlowIndicatorListFromColumns,
  createSalesOrderFlowColumnLoadingState,
  createSalesOrderFlowColumnStates,
  markSalesOrderFlowColumnLoadingMore,
  patchSalesOrderFlowKanbanCard,
  resolveSalesOrderFlowVisibleKanbanStages,
  SALES_ORDER_FLOW_COLUMN_PAGE_SIZE,
  salesOrderFlowColumnStatesAllSettled,
  type SalesOrderFlowColumnPageState,
} from "@/src/lib/salesOrderFlowKanbanPagination";
import {
  areSalesOrderFlowFilterDateRangesInvalid,
  areSalesOrderFlowSearchParamsEqual,
  areSalesOrderFlowUiFiltersEqual,
  buildSalesOrderFlowSearchParams,
  canViewSalesOrderFlow,
  classifySalesOrderFlowListError,
  collectSalesOrderFlowCardsFromColumnStates,
  EMPTY_SALES_ORDER_FLOW_FILTERS,
  hasActiveSalesOrderFlowFilters,
  parseSalesOrderFlowDrawerFromSearchParams,
  parseSalesOrderFlowFiltersFromSearchParams,
  resolveSalesOrderFlowDrawerFromCards,
  resolveSalesOrderFlowExecutiveIndicators,
  SALES_ORDER_FLOW_BREADCRUMB,
  salesOrderFlowFiltersToClientQuery,
  type SalesOrderFlowUiFilters,
} from "@/src/lib/salesOrderFlowUi";
import type { SalesOrderFlowStage } from "@/src/lib/sales/salesOrderFlowCatalog";

/**
 * Fluxo de Pedidos Comercial (OP-64..OP-69).
 * Colunas read-only, paginadas de forma independente; drawer de Resumo/Itens.
 */
export function SalesOrderFlowModule() {
  const auth = useAuth();
  const permissions = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();
  const canView = canViewSalesOrderFlow({
    canPerformAction: permissions.canPerformAction,
    hasPermission: auth.hasPermission,
  });

  const initialFilters = useMemo(
    () => parseSalesOrderFlowFiltersFromSearchParams(searchParams),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot inicial da URL
    []
  );
  const initialDrawer = useMemo(
    () => parseSalesOrderFlowDrawerFromSearchParams(searchParams),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot inicial da URL
    []
  );

  const [draftFilters, setDraftFilters] =
    useState<SalesOrderFlowUiFilters>(initialFilters);
  const [filters, setFilters] = useState<SalesOrderFlowUiFilters>(initialFilters);

  const [sellerOptions, setSellerOptions] = useState<
    SalesOrderSellerFilterOption[]
  >([]);
  const [sellerOptionsLoading, setSellerOptionsLoading] = useState(false);

  const [summary, setSummary] = useState<SalesOrderFlowSummaryPayload | null>(
    null
  );
  const [columnStates, setColumnStates] = useState<
    Record<string, SalesOrderFlowColumnPageState>
  >({});
  const [valuesVisible, setValuesVisible] = useState(true);
  const [inconsistenciesVisible, setInconsistenciesVisible] = useState(true);
  const [loading, setLoading] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [columnRetry, setColumnRetry] = useState<{
    stage: SalesOrderFlowStage;
    token: number;
  } | null>(null);
  const [featureEnabled, setFeatureEnabled] = useState<boolean | null>(null);
  const [errorKind, setErrorKind] = useState<
    "access_denied" | "feature_disabled" | "api_unavailable" | "generic" | null
  >(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<{
    id: string;
    code: string;
  } | null>(() =>
    initialDrawer.orderId
      ? { id: initialDrawer.orderId, code: initialDrawer.orderCode ?? "" }
      : null
  );
  const [pendingDrawerCode, setPendingDrawerCode] = useState<string | null>(
    () =>
      !initialDrawer.orderId && initialDrawer.orderCode
        ? initialDrawer.orderCode
        : null
  );
  const [drawerDeepLinkError, setDrawerDeepLinkError] = useState<string | null>(
    () =>
      initialDrawer.invalidOrderId
        ? "Deep link inválido: orderId precisa ser um UUID."
        : null
  );
  const [kanbanOpen, setKanbanOpen] = useState(false);
  const [cardsMinimized, setCardsMinimized] = useState(true);

  const filterGenerationRef = useRef(0);
  const columnAbortRef = useRef<Map<SalesOrderFlowStage, AbortController>>(
    new Map()
  );
  const kanbanScrollRef = useRef<HTMLDivElement | null>(null);
  const kanbanScrollLeftRef = useRef(0);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const dateRangesInvalid = areSalesOrderFlowFilterDateRangesInvalid(filters);
  const draftDateRangesInvalid =
    areSalesOrderFlowFilterDateRangesInvalid(draftFilters);
  const visibleStages = useMemo(
    () => resolveSalesOrderFlowVisibleKanbanStages(filters.stages),
    [filters.stages]
  );
  const hasPendingFilterChanges = !areSalesOrderFlowUiFiltersEqual(
    draftFilters,
    filters
  );

  // Sync URL canônica (filtros aplicados + drawer). replace evita loop no histórico.
  useEffect(() => {
    const next = buildSalesOrderFlowSearchParams(
      filters,
      selectedOrder
        ? { orderId: selectedOrder.id, orderCode: selectedOrder.code }
        : pendingDrawerCode
          ? { orderCode: pendingDrawerCode }
          : null
    );
    if (areSalesOrderFlowSearchParamsEqual(next, searchParams)) return;
    setSearchParams(next, { replace: true });
  }, [filters, selectedOrder, pendingDrawerCode, searchParams, setSearchParams]);

  // Deep link por código: resolve contra cards carregados (sem navegar de novo).
  useEffect(() => {
    if (!pendingDrawerCode || selectedOrder) return;
    const cards = collectSalesOrderFlowCardsFromColumnStates(columnStates);
    const resolved = resolveSalesOrderFlowDrawerFromCards(cards, {
      orderCode: pendingDrawerCode,
    });
    if (!resolved) return;
    setSelectedOrder(resolved);
    setPendingDrawerCode(null);
    setDrawerDeepLinkError(null);
  }, [columnStates, pendingDrawerCode, selectedOrder]);

  // Fallback: busca lista com q=código quando o card ainda não está nas colunas.
  useEffect(() => {
    if (!pendingDrawerCode || selectedOrder || !canView || featureEnabled !== true) {
      return;
    }
    if (!salesOrderFlowColumnStatesAllSettled(visibleStages, columnStates)) {
      return;
    }
    const controller = new AbortController();
    void fetchSalesOrderFlowList(
      {
        ...salesOrderFlowFiltersToClientQuery(filtersRef.current),
        q: pendingDrawerCode,
        limit: 20,
      },
      controller.signal
    )
      .then((payload) => {
        if (controller.signal.aborted) return;
        const cards = (payload.columns ?? []).flatMap((col) => col.cards ?? []);
        const resolved = resolveSalesOrderFlowDrawerFromCards(cards, {
          orderCode: pendingDrawerCode,
        });
        if (resolved) {
          setSelectedOrder(resolved);
          setPendingDrawerCode(null);
          setDrawerDeepLinkError(null);
          return;
        }
        setDrawerDeepLinkError(
          `Pedido "${pendingDrawerCode}" não encontrado no fluxo.`
        );
        setPendingDrawerCode(null);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setDrawerDeepLinkError(
          `Não foi possível abrir o pedido "${pendingDrawerCode}".`
        );
        setPendingDrawerCode(null);
      });
    return () => controller.abort();
  }, [
    pendingDrawerCode,
    selectedOrder,
    canView,
    featureEnabled,
    columnStates,
    visibleStages,
  ]);

  const openOrderDrawer = useCallback((id: string, code: string) => {
    if (kanbanScrollRef.current) {
      kanbanScrollLeftRef.current = kanbanScrollRef.current.scrollLeft;
    }
    setDrawerDeepLinkError(null);
    setPendingDrawerCode(null);
    setSelectedOrder({ id, code });
  }, []);

  const closeOrderDrawer = useCallback(() => {
    setSelectedOrder(null);
    setPendingDrawerCode(null);
    requestAnimationFrame(() => {
      if (kanbanScrollRef.current) {
        kanbanScrollRef.current.scrollLeft = kanbanScrollLeftRef.current;
      }
    });
  }, []);

  const handleOrderCodeResolved = useCallback((code: string) => {
    setSelectedOrder((current) =>
      current && current.code !== code ? { ...current, code } : current
    );
  }, []);

  const handleOrderRecomputed = useCallback(() => {
    setRetryToken((token) => token + 1);
  }, []);

  // Feature flag — uma vez por sessão de view (não refaz a cada filtro).
  useEffect(() => {
    if (!canView) return;
    const controller = new AbortController();
    setLoading(true);
    void fetchSalesOrderFlowFeatureStatus(controller.signal)
      .then((status) => {
        if (controller.signal.aborted) return;
        setFeatureEnabled(status.enabled);
        if (!status.enabled) {
          setErrorKind("feature_disabled");
          setErrorMessage(
            "Fluxo de Pedidos não está habilitado neste ambiente."
          );
          setSummary(null);
          setColumnStates({});
          setHasLoadedOnce(true);
          setLoading(false);
        }
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
        const classified = classifySalesOrderFlowListError(error);
        setFeatureEnabled(false);
        setErrorKind(classified.kind);
        setErrorMessage(classified.message);
        setHasLoadedOnce(true);
        setLoading(false);
      });
    return () => controller.abort();
  }, [canView]);

  // Opções de vendedor (dados existentes da listagem de pedidos).
  useEffect(() => {
    if (!canView) return;
    const controller = new AbortController();
    setSellerOptionsLoading(true);
    void fetchJsonOk<{ options: SalesOrderSellerFilterOption[] }>(
      getSalesOrderSellerFilterOptionsUrl(),
      { signal: controller.signal }
    )
      .then((data) => {
        if (!controller.signal.aborted) {
          setSellerOptions(data.options ?? []);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setSellerOptions([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setSellerOptionsLoading(false);
      });
    return () => controller.abort();
  }, [canView]);

  const abortAllColumnRequests = useCallback(() => {
    for (const controller of columnAbortRef.current.values()) {
      controller.abort();
    }
    columnAbortRef.current.clear();
  }, []);

  const loadColumnPage = useCallback(
    async (input: {
      stage: SalesOrderFlowStage;
      generation: number;
      cursor: string | null;
      mode: "replace" | "append";
      baseQuery: SalesOrderFlowClientQuery;
    }) => {
      const previous = columnAbortRef.current.get(input.stage);
      previous?.abort();
      const controller = new AbortController();
      columnAbortRef.current.set(input.stage, controller);

      try {
        const payload = await fetchSalesOrderFlowList(
          {
            ...input.baseQuery,
            stages: [input.stage],
            limit: SALES_ORDER_FLOW_COLUMN_PAGE_SIZE,
            cursor: input.cursor,
          },
          controller.signal
        );
        if (
          controller.signal.aborted ||
          input.generation !== filterGenerationRef.current
        ) {
          return;
        }
        setValuesVisible(payload.valuesVisible);
        setInconsistenciesVisible(payload.inconsistenciesVisible);
        const page = payload.columns[0];
        if (!page) {
          setColumnStates((current) => {
            const state = current[input.stage];
            if (!state) return current;
            const next = applySalesOrderFlowColumnError({
              state,
              expectedGeneration: input.generation,
              message: "Coluna sem dados na resposta.",
              keepCards: input.mode === "append",
            });
            if (!next) return current;
            return { ...current, [input.stage]: next };
          });
          return;
        }
        setColumnStates((current) => {
          const state = current[input.stage];
          if (!state) return current;
          const next = applySalesOrderFlowColumnPage({
            state,
            page,
            expectedGeneration: input.generation,
            mode: input.mode,
          });
          if (!next) return current;
          return { ...current, [input.stage]: next };
        });
      } catch (error: unknown) {
        if (
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError") ||
          input.generation !== filterGenerationRef.current
        ) {
          return;
        }
        const classified = classifySalesOrderFlowListError(error);
        setColumnStates((current) => {
          const state = current[input.stage];
          if (!state) return current;
          const next = applySalesOrderFlowColumnError({
            state,
            expectedGeneration: input.generation,
            message: classified.message,
            keepCards: input.mode === "append",
          });
          if (!next) return current;
          return { ...current, [input.stage]: next };
        });
      } finally {
        if (columnAbortRef.current.get(input.stage) === controller) {
          columnAbortRef.current.delete(input.stage);
        }
      }
    },
    []
  );

  // Summary + carga inicial limitada por coluna (isolada).
  useEffect(() => {
    if (!canView || featureEnabled !== true) return;
    if (dateRangesInvalid) {
      setLoading(false);
      setErrorKind(null);
      setErrorMessage(null);
      return;
    }

    const generation = filterGenerationRef.current + 1;
    filterGenerationRef.current = generation;

    const summaryController = new AbortController();
    const baseQuery = salesOrderFlowFiltersToClientQuery(filters);
    const stages = resolveSalesOrderFlowVisibleKanbanStages(filters.stages);

    setLoading(true);
    setErrorKind(null);
    setErrorMessage(null);
    setColumnStates(createSalesOrderFlowColumnStates(stages, generation));

    void fetchSalesOrderFlowSummary(baseQuery, summaryController.signal)
      .then((summaryPayload) => {
        if (
          summaryController.signal.aborted ||
          generation !== filterGenerationRef.current
        ) {
          return;
        }
        setSummary(summaryPayload);
        setHasLoadedOnce(true);
      })
      .catch((error: unknown) => {
        if (
          summaryController.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError") ||
          generation !== filterGenerationRef.current
        ) {
          return;
        }
        const classified = classifySalesOrderFlowListError(error);
        setErrorKind(classified.kind);
        setErrorMessage(classified.message);
        // Mantém o último Kanban/indicadores válidos durante falha de atualização.
        setHasLoadedOnce(true);
      })
      .finally(() => {
        if (
          !summaryController.signal.aborted &&
          generation === filterGenerationRef.current
        ) {
          setLoading(false);
        }
      });

    for (const stage of stages) {
      void loadColumnPage({
        stage,
        generation,
        cursor: null,
        mode: "replace",
        baseQuery,
      });
    }

    return () => {
      summaryController.abort();
      abortAllColumnRequests();
    };
  }, [
    canView,
    featureEnabled,
    filters,
    dateRangesInvalid,
    retryToken,
    abortAllColumnRequests,
    loadColumnPage,
  ]);

  // Retry isolado de uma coluna (não recarrega as demais).
  useEffect(() => {
    if (!columnRetry || featureEnabled !== true) return;
    const generation = filterGenerationRef.current;
    const baseQuery = salesOrderFlowFiltersToClientQuery(filtersRef.current);
    setColumnStates((current) => ({
      ...current,
      [columnRetry.stage]: createSalesOrderFlowColumnLoadingState(
        columnRetry.stage,
        generation
      ),
    }));
    void loadColumnPage({
      stage: columnRetry.stage,
      generation,
      cursor: null,
      mode: "replace",
      baseQuery,
    });
  }, [columnRetry, featureEnabled, loadColumnPage]);

  const handleLoadMore = useCallback(
    (stage: SalesOrderFlowStage) => {
      const generation = filterGenerationRef.current;
      const state = columnStates[stage];
      if (!state) return;
      const marked = markSalesOrderFlowColumnLoadingMore(state, generation);
      if (!marked || !marked.nextCursor) return;
      setColumnStates((current) => ({ ...current, [stage]: marked }));
      void loadColumnPage({
        stage,
        generation,
        cursor: marked.nextCursor,
        mode: "append",
        baseQuery: salesOrderFlowFiltersToClientQuery(filtersRef.current),
      });
    },
    [columnStates, loadColumnPage]
  );

  const handleRetryColumn = useCallback((stage: SalesOrderFlowStage) => {
    setColumnRetry({ stage, token: Date.now() });
  }, []);

  const clearFilters = () => {
    setDraftFilters({ ...EMPTY_SALES_ORDER_FLOW_FILTERS });
    setFilters({ ...EMPTY_SALES_ORDER_FLOW_FILTERS });
  };

  const patchDraftFilters = (patch: Partial<SalesOrderFlowUiFilters>) => {
    setDraftFilters((current) => ({ ...current, ...patch }));
  };

  const normalizeFlowFilters = (
    input: SalesOrderFlowUiFilters
  ): SalesOrderFlowUiFilters => ({
    ...input,
    q: input.q.trim(),
    customerId: input.customerId.trim(),
    sellerKey: input.sellerKey.trim(),
    company: input.company.trim(),
    product: input.product.trim(),
    sector: input.sector.trim(),
  });

  const applyFilters = () => {
    if (areSalesOrderFlowFilterDateRangesInvalid(draftFilters)) return;
    const next = normalizeFlowFilters(draftFilters);
    setDraftFilters(next);
    setFilters(next);
  };

  /** Aplica patch + refetch (Kanban fullscreen: pedido/cliente). */
  const applyFilterPatch = (patch: Partial<SalesOrderFlowUiFilters> = {}) => {
    setDraftFilters((current) => {
      const next = normalizeFlowFilters({ ...current, ...patch });
      if (!areSalesOrderFlowFilterDateRangesInvalid(next)) {
        setFilters(next);
      }
      return next;
    });
  };

  if (!canView) {
    return (
      <div
        className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground"
        data-testid="sales-order-flow-denied"
      >
        Você não possui permissão para acessar o Fluxo de Pedidos.
      </div>
    );
  }

  const filtersActive = hasActiveSalesOrderFlowFilters(filters);
  const indicatorList = buildSalesOrderFlowIndicatorListFromColumns({
    stages: visibleStages,
    columns: columnStates,
    inconsistenciesVisible,
  });
  const totalOrders =
    indicatorList.columns.reduce((sum, column) => sum + column.total, 0) ||
    summary?.columns
      .filter((column) => visibleStages.includes(column.stage))
      .reduce((sum, column) => sum + column.orderCount, 0) ||
    0;
  const columnsSettled = salesOrderFlowColumnStatesAllSettled(
    visibleStages,
    columnStates
  );
  const showEmptyCatalog =
    hasLoadedOnce &&
    !loading &&
    columnsSettled &&
    !errorMessage &&
    featureEnabled === true &&
    totalOrders === 0 &&
    !filtersActive;
  const showEmptyFilters =
    hasLoadedOnce &&
    !loading &&
    columnsSettled &&
    !errorMessage &&
    featureEnabled === true &&
    totalOrders === 0 &&
    filtersActive;
  const initialLoading = loading && !hasLoadedOnce;
  const draftFiltersActive = hasActiveSalesOrderFlowFilters(draftFilters);
  const indicators =
    summary != null
      ? resolveSalesOrderFlowExecutiveIndicators(summary, indicatorList)
      : null;
  const indicatorsLoading = loading || featureEnabled === null;
  const showIndicators =
    featureEnabled !== false &&
    !dateRangesInvalid &&
    (indicatorsLoading || indicators != null);
  const kanbanColumns =
    indicators != null
      ? buildSalesOrderFlowKanbanColumnViews({
          stages: visibleStages,
          columns: columnStates,
          indicators: indicators.columns,
        })
      : [];
  const showKanban =
    !initialLoading &&
    !dateRangesInvalid &&
    featureEnabled === true &&
    indicators != null &&
    !showEmptyCatalog &&
    !showEmptyFilters &&
    kanbanColumns.length > 0;
  const analyticsModel =
    summary != null
      ? buildSalesOrderFlowAnalyticsModel({
          columns: summary.columns,
          totals: summary.totals,
        })
      : null;
  const showAnalytics =
    featureEnabled === true &&
    !dateRangesInvalid &&
    (indicatorsLoading || analyticsModel != null);

  return (
    <div className="space-y-4" data-testid="sales-order-flow-module">
      <p
        className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
        data-testid="sales-order-flow-breadcrumb"
      >
        {SALES_ORDER_FLOW_BREADCRUMB}
      </p>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Acompanhe o fluxo pelos gráficos e abra o kanban em tela cheia quando
          for operar.
        </p>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
          data-testid="sales-order-flow-open-kanban"
          disabled={!showKanban}
          onClick={() => setKanbanOpen(true)}
        >
          <FolderKanban className="h-4 w-4" aria-hidden="true" />
          Abrir kanban
        </button>
      </div>

      <SalesOrderFlowFiltersBar
        draftFilters={draftFilters}
        sellerOptions={sellerOptions}
        sellerOptionsLoading={sellerOptionsLoading}
        hasPendingFilterChanges={hasPendingFilterChanges}
        draftDateRangesInvalid={draftDateRangesInvalid}
        filtersActive={filtersActive}
        draftFiltersActive={draftFiltersActive}
        loading={loading}
        onPatchDraft={patchDraftFilters}
        onApply={applyFilters}
        onClear={clearFilters}
      />

      {showIndicators ? (
        <section
          className="space-y-3"
          aria-label="Indicadores do Fluxo de Pedidos"
          data-testid="sales-order-flow-indicators"
        >
          <SummaryKpiGrid
            minColumnWidth={150}
            className={SYSTEM_TOTALIZER_GRID_CLASS}
            testId="sales-order-flow-indicator-grid"
          >
            <SystemTotalizerCard
              testId="sales-order-flow-indicator-active-orders"
              label="Pedidos ativos"
              amount={indicators?.activeOrderCount ?? 0}
              amountFormat="number"
              icon={PackageCheck}
              tone="info"
              loading={indicatorsLoading}
            />
            <SystemTotalizerCard
              testId="sales-order-flow-indicator-process-value"
              label="Valor em processo"
              amount={indicators?.processValue ?? undefined}
              amountFormat="currency"
              value={indicators?.valuesVisible === false ? "Oculto" : undefined}
              subtitle={
                indicators?.valuesVisible === false
                  ? "Sem permissão para valores"
                  : undefined
              }
              icon={CircleDollarSign}
              tone="money"
              loading={indicatorsLoading}
              valueSize={indicators?.valuesVisible === false ? "text" : "default"}
            />
            <SystemTotalizerCard
              testId="sales-order-flow-indicator-active-residual"
              label="Saldo ativo"
              amount={indicators?.activeResidualValue ?? undefined}
              amountFormat="currency"
              value={indicators?.valuesVisible === false ? "Oculto" : undefined}
              subtitle={
                indicators?.valuesVisible === false
                  ? "Sem permissão para valores"
                  : undefined
              }
              icon={WalletCards}
              tone="money"
              loading={indicatorsLoading}
              valueSize={indicators?.valuesVisible === false ? "text" : "default"}
            />
            <SystemTotalizerCard
              testId="sales-order-flow-indicator-overdue"
              label="Atrasados"
              amount={indicators?.overdueCount ?? 0}
              amountFormat="number"
              icon={Clock3}
              tone="warning"
              loading={indicatorsLoading}
            />
            <SystemTotalizerCard
              testId="sales-order-flow-indicator-blocked"
              label="Bloqueados"
              amount={indicators?.blockedCount ?? 0}
              amountFormat="number"
              icon={Ban}
              tone="danger"
              loading={indicatorsLoading}
            />
            <SystemTotalizerCard
              testId="sales-order-flow-indicator-inconsistent"
              label="Inconsistentes"
              amount={indicators?.inconsistentCount ?? undefined}
              amountFormat="number"
              value={
                indicators?.inconsistenciesVisible === false
                  ? "Oculto"
                  : undefined
              }
              subtitle={
                indicators?.inconsistenciesVisible === false
                  ? "Sem permissão para inconsistências"
                  : undefined
              }
              icon={ShieldAlert}
              tone="danger"
              loading={indicatorsLoading}
              valueSize={
                indicators?.inconsistenciesVisible === false ? "text" : "default"
              }
            />
            <SystemTotalizerCard
              testId="sales-order-flow-indicator-partially-shipped"
              label="Parcialmente enviados"
              amount={indicators?.partiallyShippedCount ?? 0}
              amountFormat="number"
              icon={Truck}
              tone="warning"
              loading={indicatorsLoading}
            />
          </SummaryKpiGrid>
        </section>
      ) : null}

      {showAnalytics ? (
        <SalesOrderFlowAnalyticsPanel
          model={analyticsModel}
          loading={indicatorsLoading && analyticsModel == null}
        />
      ) : null}

      {initialLoading && !showIndicators ? (
        <div
          className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card p-12 text-sm text-muted-foreground"
          data-testid="sales-order-flow-loading"
        >
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          Carregando Fluxo de Pedidos…
        </div>
      ) : null}

      {errorMessage ? (
        <div
          className="rounded-xl border border-border bg-card p-6 text-center space-y-3"
          data-testid={
            errorKind === "access_denied"
              ? "sales-order-flow-error-denied"
              : errorKind === "feature_disabled"
                ? "sales-order-flow-feature-disabled"
                : errorKind === "api_unavailable"
                  ? "sales-order-flow-api-unavailable"
                  : "sales-order-flow-error"
          }
          role="alert"
        >
          <p className="text-sm text-muted-foreground">{errorMessage}</p>
          {errorKind !== "access_denied" && errorKind !== "feature_disabled" ? (
            <button
              type="button"
              className="inline-flex rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent"
              data-testid="sales-order-flow-retry"
              onClick={() => setRetryToken((token) => token + 1)}
            >
              Tentar novamente
            </button>
          ) : null}
        </div>
      ) : null}

      {showEmptyCatalog ? (
        <div
          className="rounded-xl border border-dashed border-border bg-card p-12 text-center text-sm text-muted-foreground"
          data-testid="sales-order-flow-empty"
        >
          Nenhum pedido no fluxo no momento.
        </div>
      ) : null}

      {showEmptyFilters ? (
        <div
          className="rounded-xl border border-dashed border-border bg-card p-12 text-center text-sm text-muted-foreground space-y-3"
          data-testid="sales-order-flow-empty-filters"
        >
          <p>Nenhum pedido corresponde aos filtros aplicados.</p>
          <button
            type="button"
            className="inline-flex rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent"
            onClick={clearFilters}
          >
            Limpar filtros
          </button>
        </div>
      ) : null}

      {!initialLoading &&
      !dateRangesInvalid &&
      featureEnabled === true &&
      showKanban ? (
        <section
          className="rounded-xl border border-dashed border-border bg-card p-6 text-center space-y-3"
          data-testid="sales-order-flow-kanban-teaser"
        >
          <p className="text-sm text-muted-foreground">
            O kanban operacional abre em tela cheia sobre o sistema para
            facilitar o acompanhamento. Cards podem ficar só com número e
            status.
          </p>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-accent"
            data-testid="sales-order-flow-open-kanban-secondary"
            onClick={() => setKanbanOpen(true)}
          >
            <FolderKanban className="h-4 w-4" aria-hidden="true" />
            Abrir kanban em tela cheia
          </button>
        </section>
      ) : null}

      {kanbanOpen && showKanban ? (
        <SalesOrderFlowKanbanFullscreen
          open={kanbanOpen}
          onClose={() => setKanbanOpen(false)}
          columns={kanbanColumns}
          valuesVisible={valuesVisible}
          inconsistenciesVisible={inconsistenciesVisible}
          cardsMinimized={cardsMinimized}
          onToggleCardsMinimized={() => setCardsMinimized((value) => !value)}
          scrollContainerRef={kanbanScrollRef}
          onOpenOrder={openOrderDrawer}
          onLoadMore={handleLoadMore}
          onRetryColumn={handleRetryColumn}
          orderSearch={draftFilters.q}
          customerId={draftFilters.customerId}
          searching={loading}
          onOrderSearchChange={(value) => patchDraftFilters({ q: value })}
          onApplySearch={(patch) => applyFilterPatch(patch)}
        />
      ) : null}

      {drawerDeepLinkError ? (
        <div
          role="status"
          className="rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-950"
          data-testid="sales-order-flow-drawer-deeplink-error"
        >
          {drawerDeepLinkError}
          <button
            type="button"
            className="ml-3 underline"
            onClick={() => setDrawerDeepLinkError(null)}
          >
            Dispensar
          </button>
        </div>
      ) : null}

      {selectedOrder ? (
        <SalesOrderFlowDetailDrawer
          open
          salesOrderId={selectedOrder.id}
          orderCode={selectedOrder.code}
          onClose={closeOrderDrawer}
          onOrderCodeResolved={handleOrderCodeResolved}
          onRecomputed={handleOrderRecomputed}
          onManagementUpdated={({ salesOrderId, management }) => {
            setColumnStates((current) =>
              patchSalesOrderFlowKanbanCard(current, salesOrderId, {
                priority: management.priority,
                isBlocked: management.isBlocked,
                blockReason: management.blockReason,
              })
            );
          }}
        />
      ) : null}
    </div>
  );
}

