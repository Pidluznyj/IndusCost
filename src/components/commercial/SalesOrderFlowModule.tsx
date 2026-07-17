import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Ban,
  CircleDollarSign,
  Clock3,
  Loader2,
  PackageCheck,
  Search,
  ShieldAlert,
  Truck,
  WalletCards,
} from "lucide-react";
import { CustomerAutocompleteFilter } from "@/src/components/common/CustomerAutocompleteFilter";
import { SalesOrderFlowKanbanBoard } from "@/src/components/commercial/SalesOrderFlowKanbanBoard";
import { SalesOrderDetailDialog } from "@/src/components/sales/SalesOrderDetailDialog";
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
  type SalesOrderFlowListPayload,
  type SalesOrderFlowSummaryPayload,
} from "@/src/lib/salesOrderFlowClient";
import {
  areSalesOrderFlowFilterDateRangesInvalid,
  buildSalesOrderFlowSearchParams,
  canViewSalesOrderFlow,
  classifySalesOrderFlowListError,
  EMPTY_SALES_ORDER_FLOW_FILTERS,
  hasActiveSalesOrderFlowFilters,
  isSalesOrderFlowDateRangeInvalid,
  parseSalesOrderFlowFiltersFromSearchParams,
  resolveSalesOrderFlowExecutiveIndicators,
  SALES_ORDER_FLOW_BREADCRUMB,
  SALES_ORDER_FLOW_PRIORITY_OPTIONS,
  SALES_ORDER_FLOW_SEARCH_DEBOUNCE_MS,
  SALES_ORDER_FLOW_STAGE_FILTER_OPTIONS,
  salesOrderFlowFiltersToClientQuery,
  type SalesOrderFlowUiFilters,
} from "@/src/lib/salesOrderFlowUi";
import { cn } from "@/src/lib/utils";
import type { SalesOrderFlowStage } from "@/src/lib/sales/salesOrderFlowCatalog";
import type { SalesOrderFlowUiPriority } from "@/src/lib/salesOrderFlowUi";

const FILTER_CONTROL_CLASS =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-shadow focus:border-primary focus:ring-2 focus:ring-primary/20";

/**
 * Fluxo de Pedidos Comercial (OP-64..OP-67).
 * A coluna é read-only e vem exclusivamente da API; sem drag-and-drop.
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

  const [qDraft, setQDraft] = useState(initialFilters.q);
  const [companyDraft, setCompanyDraft] = useState(initialFilters.company);
  const [productDraft, setProductDraft] = useState(initialFilters.product);
  const [sectorDraft, setSectorDraft] = useState(initialFilters.sector);

  const [filters, setFilters] = useState<SalesOrderFlowUiFilters>(initialFilters);

  const [sellerOptions, setSellerOptions] = useState<
    SalesOrderSellerFilterOption[]
  >([]);

  const [summary, setSummary] = useState<SalesOrderFlowSummaryPayload | null>(
    null
  );
  const [list, setList] = useState<SalesOrderFlowListPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [featureEnabled, setFeatureEnabled] = useState<boolean | null>(null);
  const [errorKind, setErrorKind] = useState<
    "access_denied" | "feature_disabled" | "api_unavailable" | "generic" | null
  >(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<{
    id: string;
    code: string;
  } | null>(null);

  const dateRangesInvalid = areSalesOrderFlowFilterDateRangesInvalid(filters);

  // Debounce de campos de texto livre.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextQ = qDraft.trim();
      const nextCompany = companyDraft.trim();
      const nextProduct = productDraft.trim();
      const nextSector = sectorDraft.trim();
      setFilters((current) => {
        if (
          current.q === nextQ &&
          current.company === nextCompany &&
          current.product === nextProduct &&
          current.sector === nextSector
        ) {
          return current;
        }
        return {
          ...current,
          q: nextQ,
          company: nextCompany,
          product: nextProduct,
          sector: nextSector,
        };
      });
    }, SALES_ORDER_FLOW_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [qDraft, companyDraft, productDraft, sectorDraft]);

  // Sync URL canônica (descarta inválidos / defaults).
  useEffect(() => {
    const next = buildSalesOrderFlowSearchParams(filters);
    setSearchParams(next, { replace: true });
  }, [filters, setSearchParams]);

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
          setList(null);
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
      });
    return () => controller.abort();
  }, [canView]);

  // Summary + list com os mesmos filtros (uma chamada conjunta por mudança).
  useEffect(() => {
    if (!canView || featureEnabled !== true) return;
    if (dateRangesInvalid) {
      setLoading(false);
      setErrorKind(null);
      setErrorMessage(null);
      return;
    }
    const controller = new AbortController();
    const query = salesOrderFlowFiltersToClientQuery(filters);
    setLoading(true);
    setErrorKind(null);
    setErrorMessage(null);

    void Promise.all([
      fetchSalesOrderFlowSummary(query, controller.signal),
      fetchSalesOrderFlowList(query, controller.signal),
    ])
      .then(([summaryPayload, listPayload]) => {
        if (controller.signal.aborted) return;
        setSummary(summaryPayload);
        setList(listPayload);
        setHasLoadedOnce(true);
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError")
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
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [canView, featureEnabled, filters, dateRangesInvalid, retryToken]);

  const clearFilters = () => {
    setQDraft("");
    setCompanyDraft("");
    setProductDraft("");
    setSectorDraft("");
    setFilters({ ...EMPTY_SALES_ORDER_FLOW_FILTERS });
  };

  const patchFilters = (patch: Partial<SalesOrderFlowUiFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
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
  const totalOrders =
    list?.columns.reduce((sum, column) => sum + column.total, 0) ??
    summary?.columns.reduce((sum, column) => sum + column.orderCount, 0) ??
    0;
  const showEmptyCatalog =
    hasLoadedOnce &&
    !loading &&
    !errorMessage &&
    featureEnabled === true &&
    totalOrders === 0 &&
    !filtersActive;
  const showEmptyFilters =
    hasLoadedOnce &&
    !loading &&
    !errorMessage &&
    featureEnabled === true &&
    totalOrders === 0 &&
    filtersActive;
  const initialLoading = loading && !hasLoadedOnce;
  const stageSelectValue =
    filters.stages.length === 1 ? filters.stages[0] : "";
  const indicators =
    summary && list
      ? resolveSalesOrderFlowExecutiveIndicators(summary, list)
      : null;
  const indicatorsLoading = loading || featureEnabled === null;
  const showIndicators =
    featureEnabled !== false &&
    !dateRangesInvalid &&
    (indicatorsLoading || indicators != null);

  return (
    <div className="space-y-4" data-testid="sales-order-flow-module">
      <p
        className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
        data-testid="sales-order-flow-breadcrumb"
      >
        {SALES_ORDER_FLOW_BREADCRUMB}
      </p>

      <section
        className="rounded-xl border border-border bg-card p-3 space-y-3"
        data-testid="sales-order-flow-filters"
        aria-label="Filtros do Fluxo de Pedidos"
      >
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <FilterField label="Busca geral">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                className={cn(FILTER_CONTROL_CLASS, "pl-8")}
                data-testid="sales-order-flow-filter-q"
                placeholder="Pedido, cliente…"
                value={qDraft}
                onChange={(event) => setQDraft(event.target.value)}
              />
            </div>
          </FilterField>

          <div data-testid="sales-order-flow-filter-customer">
            <CustomerAutocompleteFilter
              label="Cliente"
              customerId={filters.customerId || undefined}
              placeholder="Todos os clientes"
              onChange={(selection) => {
                patchFilters({ customerId: selection?.id?.trim() ?? "" });
              }}
              onClear={() => {
                patchFilters({ customerId: "" });
              }}
            />
          </div>

          <FilterField label="Vendedor">
            <select
              className={FILTER_CONTROL_CLASS}
              data-testid="sales-order-flow-filter-seller"
              value={filters.sellerKey}
              onChange={(event) =>
                patchFilters({ sellerKey: event.target.value })
              }
            >
              <option value="">Todos</option>
              {sellerOptions.map((option) => (
                <option key={option.sellerKey} value={option.sellerKey}>
                  {option.label}
                </option>
              ))}
            </select>
          </FilterField>

          <FilterField label="Empresa">
            <input
              className={FILTER_CONTROL_CLASS}
              data-testid="sales-order-flow-filter-company"
              placeholder="Ex.: KOPPETEL"
              value={companyDraft}
              onChange={(event) => setCompanyDraft(event.target.value)}
            />
          </FilterField>

          <FilterField label="Etapa">
            <select
              className={FILTER_CONTROL_CLASS}
              data-testid="sales-order-flow-filter-stage"
              value={stageSelectValue}
              onChange={(event) => {
                const value = event.target.value;
                patchFilters({
                  stages: value ? [value as SalesOrderFlowStage] : [],
                });
              }}
            >
              <option value="">Todas</option>
              {SALES_ORDER_FLOW_STAGE_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FilterField>

          <FilterField label="Prioridade">
            <select
              className={FILTER_CONTROL_CLASS}
              data-testid="sales-order-flow-filter-priority"
              value={filters.priority ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                patchFilters({
                  priority: value
                    ? (value as SalesOrderFlowUiPriority)
                    : null,
                });
              }}
            >
              <option value="">Todas</option>
              {SALES_ORDER_FLOW_PRIORITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FilterField>

          <FilterField label="Produto">
            <input
              className={FILTER_CONTROL_CLASS}
              data-testid="sales-order-flow-filter-product"
              placeholder="Código ou descrição"
              value={productDraft}
              onChange={(event) => setProductDraft(event.target.value)}
            />
          </FilterField>

          <FilterField label="Setor">
            <input
              className={FILTER_CONTROL_CLASS}
              data-testid="sales-order-flow-filter-sector"
              placeholder="Setor"
              value={sectorDraft}
              onChange={(event) => setSectorDraft(event.target.value)}
            />
          </FilterField>

          <FilterField label="Emissão de">
            <input
              type="date"
              className={FILTER_CONTROL_CLASS}
              data-testid="sales-order-flow-filter-issue-from"
              aria-invalid={isSalesOrderFlowDateRangeInvalid(
                filters.issueFrom,
                filters.issueTo
              )}
              value={filters.issueFrom}
              onChange={(event) =>
                patchFilters({ issueFrom: event.target.value })
              }
            />
          </FilterField>

          <FilterField label="Emissão até">
            <input
              type="date"
              className={FILTER_CONTROL_CLASS}
              data-testid="sales-order-flow-filter-issue-to"
              aria-invalid={isSalesOrderFlowDateRangeInvalid(
                filters.issueFrom,
                filters.issueTo
              )}
              value={filters.issueTo}
              onChange={(event) =>
                patchFilters({ issueTo: event.target.value })
              }
            />
          </FilterField>

          <FilterField label="Entrega prometida de">
            <input
              type="date"
              className={FILTER_CONTROL_CLASS}
              data-testid="sales-order-flow-filter-promised-from"
              aria-invalid={isSalesOrderFlowDateRangeInvalid(
                filters.promisedFrom,
                filters.promisedTo
              )}
              value={filters.promisedFrom}
              onChange={(event) =>
                patchFilters({ promisedFrom: event.target.value })
              }
            />
          </FilterField>

          <FilterField label="Entrega prometida até">
            <input
              type="date"
              className={FILTER_CONTROL_CLASS}
              data-testid="sales-order-flow-filter-promised-to"
              aria-invalid={isSalesOrderFlowDateRangeInvalid(
                filters.promisedFrom,
                filters.promisedTo
              )}
              value={filters.promisedTo}
              onChange={(event) =>
                patchFilters({ promisedTo: event.target.value })
              }
            />
          </FilterField>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <BooleanFilter
            testId="sales-order-flow-filter-overdue"
            label="Atrasados"
            checked={filters.overdue === true}
            onChange={(checked) =>
              patchFilters({ overdue: checked ? true : null })
            }
          />
          <BooleanFilter
            testId="sales-order-flow-filter-blocked"
            label="Bloqueados"
            checked={filters.blocked === true}
            onChange={(checked) =>
              patchFilters({ blocked: checked ? true : null })
            }
          />
          <BooleanFilter
            testId="sales-order-flow-filter-inconsistent"
            label="Inconsistentes"
            checked={filters.inconsistent === true}
            onChange={(checked) =>
              patchFilters({ inconsistent: checked ? true : null })
            }
          />
          <BooleanFilter
            testId="sales-order-flow-filter-partially-shipped"
            label="Parcialmente enviados"
            checked={filters.partiallyShipped === true}
            onChange={(checked) =>
              patchFilters({ partiallyShipped: checked ? true : null })
            }
          />
          <BooleanFilter
            testId="sales-order-flow-filter-with-cut"
            label="Com corte"
            checked={filters.withCut === true}
            onChange={(checked) =>
              patchFilters({ withCut: checked ? true : null })
            }
          />
          <BooleanFilter
            testId="sales-order-flow-filter-with-active-residual"
            label="Com saldo ativo"
            checked={filters.withActiveResidual === true}
            onChange={(checked) =>
              patchFilters({ withActiveResidual: checked ? true : null })
            }
          />

          <button
            type="button"
            className="ml-auto inline-flex rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-40"
            data-testid="sales-order-flow-clear-filters"
            disabled={!filtersActive && !qDraft && !companyDraft && !productDraft && !sectorDraft}
            onClick={clearFilters}
          >
            Limpar filtros
          </button>
        </div>

        {dateRangesInvalid ? (
          <p
            className="text-sm text-amber-700"
            role="alert"
            data-testid="sales-order-flow-date-range-invalid"
          >
            Intervalo de datas inválido: a data inicial não pode ser maior que a
            final.
          </p>
        ) : null}
      </section>

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
      list &&
      indicators &&
      !showEmptyCatalog &&
      !showEmptyFilters ? (
        <SalesOrderFlowKanbanBoard
          payload={list}
          columnIndicators={indicators.columns}
          onOpenOrder={(id, code) => setSelectedOrder({ id, code })}
        />
      ) : null}

      {selectedOrder ? (
        <SalesOrderDetailDialog
          open
          salesOrderId={selectedOrder.id}
          orderCode={selectedOrder.code}
          onClose={() => setSelectedOrder(null)}
        />
      ) : null}
    </div>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

function BooleanFilter({
  testId,
  label,
  checked,
  onChange,
}: {
  testId: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-foreground">
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-border"
        data-testid={testId}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}
