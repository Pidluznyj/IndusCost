import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, RefreshCw, Scale } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchJsonOk, HttpError } from "@/src/lib/http";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import {
  buildFinanceModuleEyebrow,
  FINANCE_FILTER_PANEL_TITLE,
  FINANCE_HEADER_ACTION_REFRESH,
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards";
import { canViewFinancePortfolioReconciliation } from "@/src/lib/financePortfolioReconciliationPermissions";
import {
  buildPortfolioReconciliationListQuery,
  createDefaultPortfolioReconciliationUiFilters,
  PORTFOLIO_RECONCILIATION_BUSINESS_ANSWERS_BANNER,
  PORTFOLIO_RECONCILIATION_NO_RUN_UI_MESSAGE,
  PORTFOLIO_RECONCILIATION_PARALLEL_NOTICE,
  type PortfolioBusinessAnswerFilterHint,
  type PortfolioReconciliationListPayload,
  type PortfolioReconciliationRunsPayload,
} from "@/src/lib/financePortfolioReconciliationClient";
import { formatFinanceDateTime } from "@/src/lib/financeAccountsReceivableFormat";
import { resolveFinanceBiFilterStatus } from "@/src/lib/financeBiFilterState";
import { FinanceBiDashboardShell } from "@/src/components/finance/bi/FinanceBiDashboardShell";
import { FinanceBiFilterPanel } from "@/src/components/finance/bi/FinanceBiFilterPanel";
import { FinanceExecutivePageHeader } from "@/src/components/finance/shared/FinanceExecutivePageHeader";
import {
  FinanceModuleEmptyState,
  FinanceModuleErrorBanner,
  FinanceModuleLoadingBlock,
} from "@/src/components/finance/shared/FinanceModuleStates";
import { PortfolioReconciliationSummaryCardsView } from "@/src/components/finance/portfolio-reconciliation/PortfolioReconciliationSummaryCards";
import { PortfolioReconciliationComparisonPanel } from "@/src/components/finance/portfolio-reconciliation/PortfolioReconciliationComparisonPanel";
import { PortfolioReconciliationOrdersTable } from "@/src/components/finance/portfolio-reconciliation/PortfolioReconciliationOrdersTable";
import { PortfolioReconciliationOrderDrawer } from "@/src/components/finance/portfolio-reconciliation/PortfolioReconciliationOrderDrawer";
import {
  formatPortfolioForecastSourceLabel,
  formatPortfolioStatusLabel,
} from "@/src/components/finance/portfolio-reconciliation/PortfolioReconciliationBadges";

const MONTH_OPTIONS = [
  { value: "", label: "Todos" },
  ...Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1),
    label: String(i + 1).padStart(2, "0"),
  })),
];

/**
 * Financeiro > Conciliação de Carteira — auditoria paralela (read-only).
 * Não altera Fluxo de Caixa, Contas a Receber, Faturamento nem Comissões.
 */
export function FinancePortfolioReconciliationPage() {
  const auth = useAuth();
  const canView = canViewFinancePortfolioReconciliation(auth);
  const abortRef = useRef<AbortController | null>(null);

  const [draftFilters, setDraftFilters] = useState(createDefaultPortfolioReconciliationUiFilters);
  const [appliedFilters, setAppliedFilters] = useState(createDefaultPortfolioReconciliationUiFilters);
  const [filtersExpanded, setFiltersExpanded] = useState(true);
  const [payload, setPayload] = useState<PortfolioReconciliationListPayload | null>(null);
  const [runs, setRuns] = useState<PortfolioReconciliationRunsPayload["runs"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null);

  const queryString = useMemo(
    () => buildPortfolioReconciliationListQuery(appliedFilters),
    [appliedFilters]
  );

  const filtersActive = Boolean(
    appliedFilters.runId ||
      appliedFilters.customerExternalId ||
      appliedFilters.year ||
      appliedFilters.month ||
      appliedFilters.orderCode ||
      appliedFilters.status ||
      appliedFilters.confidenceLevel ||
      appliedFilters.forecastSource ||
      appliedFilters.onlyIssues
  );
  const hasPendingFilters =
    JSON.stringify({ ...draftFilters, page: 1, pageSize: draftFilters.pageSize }) !==
    JSON.stringify({ ...appliedFilters, page: 1, pageSize: appliedFilters.pageSize });
  const filterStatus = resolveFinanceBiFilterStatus(filtersActive, hasPendingFilters);

  const loadRuns = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await fetchJsonOk<PortfolioReconciliationRunsPayload>(
        "/api/finance/portfolio-reconciliation/runs",
        { signal, credentials: "include" }
      );
      setRuns(data.runs ?? []);
    } catch {
      setRuns([]);
    }
  }, []);

  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      setPayload(null);
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      await loadRuns(ac.signal);
      const data = await fetchJsonOk<PortfolioReconciliationListPayload>(
        `/api/finance/portfolio-reconciliation?${queryString}`,
        { signal: ac.signal, credentials: "include" }
      );
      setPayload(data);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      if (
        e instanceof HttpError &&
        (e.status === 404 || /conciliação materializada|rebuild/i.test(e.message))
      ) {
        setPayload({
          ok: false,
          message: PORTFOLIO_RECONCILIATION_NO_RUN_UI_MESSAGE,
          run: null,
          summary: null,
          businessAnswers: null,
          comparison: null,
          rows: [],
          pagination: { page: 1, pageSize: 50, totalRows: 0, totalPages: 0 },
          filters: null,
          availableFilters: {
            statuses: [],
            confidenceLevels: [],
            forecastSources: [],
            customers: [],
            years: [],
            months: [],
          },
        });
        setError(null);
      } else {
        setError(
          buildFinanceTabLoadError("Não foi possível carregar a conciliação de carteira.", e)
        );
        setPayload(null);
      }
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [canView, loadRuns, queryString]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  const applyFilters = () => {
    setAppliedFilters({ ...draftFilters, page: 1 });
  };

  const clearFilters = () => {
    const next = createDefaultPortfolioReconciliationUiFilters();
    setDraftFilters(next);
    setAppliedFilters(next);
  };

  const onPageChange = (page: number) => {
    setAppliedFilters((prev) => ({ ...prev, page }));
    setDraftFilters((prev) => ({ ...prev, page }));
  };

  const openOrder = (salesOrderId: string) => {
    if (!salesOrderId.trim()) return;
    setDetailOrderId(salesOrderId);
  };

  if (!canView) {
    return (
      <FinanceModuleEmptyState
        title="Sem permissão para Conciliação de Carteira"
        description="Solicite acesso financeiro (visão) para consultar esta auditoria paralela."
      />
    );
  }

  const available = payload?.availableFilters;
  const yearOptions =
    available?.years?.length
      ? available.years
      : Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);

  const noRun = payload != null && payload.ok === false;
  const hasRows = (payload?.rows.length ?? 0) > 0;
  const hasAlerts = (payload?.businessAnswers?.precisaRevisar.ordersCount ??
    payload?.summary?.pedidosComAlerta ??
    0) > 0;

  const applyBusinessAnswerFilter = useCallback((hint: PortfolioBusinessAnswerFilterHint) => {
    setDraftFilters((prev) => ({
      ...prev,
      forecastSource: hint.forecastSource ?? "",
      onlyIssues: hint.onlyIssues === true,
      page: 1,
    }));
    setAppliedFilters((prev) => ({
      ...prev,
      forecastSource: hint.forecastSource ?? "",
      onlyIssues: hint.onlyIssues === true,
      page: 1,
    }));
  }, []);

  return (
    <div data-testid="finance-portfolio-reconciliation-page">
      <FinanceBiDashboardShell>
        <FinanceExecutivePageHeader
          eyebrow={buildFinanceModuleEyebrow("portfolio-reconciliation")}
          title="Conciliação de Carteira"
          subtitle="Comparativo paralelo de pedidos, documentos de saída e contas a receber materializados."
          actions={[
            {
              id: "refresh",
              label: FINANCE_HEADER_ACTION_REFRESH,
              onClick: () => void load(),
              icon: <RefreshCw className="h-4 w-4" />,
            },
          ]}
        />

        <div
          className="mb-4 flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950"
          data-testid="portfolio-reconciliation-parallel-notice"
        >
          <Scale className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{PORTFOLIO_RECONCILIATION_PARALLEL_NOTICE}</p>
        </div>

        {error ? (
          <FinanceModuleErrorBanner
            message={error}
            onRetry={() => void load()}
            onDismiss={() => setError(null)}
          />
        ) : null}

        <FinanceBiFilterPanel
          title={FINANCE_FILTER_PANEL_TITLE}
          expanded={filtersExpanded}
          onToggle={() => setFiltersExpanded((v) => !v)}
          filterStatus={filterStatus}
          onApply={applyFilters}
          onClear={clearFilters}
          compact
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <FilterField label="Cliente">
              <select
                className={financeModuleFilterFieldClass()}
                value={draftFilters.customerExternalId}
                onChange={(e) =>
                  setDraftFilters((prev) => ({
                    ...prev,
                    customerExternalId: e.target.value,
                  }))
                }
                data-testid="portfolio-filter-customer"
              >
                <option value="">Todos</option>
                {(available?.customers ?? []).map((c) => (
                  <option key={c.customerExternalId} value={String(c.customerExternalId)}>
                    {c.customerName
                      ? `${c.customerName} (${c.customerExternalId})`
                      : `Cliente ${c.customerExternalId}`}
                  </option>
                ))}
              </select>
            </FilterField>

            <FilterField label="Ano">
              <select
                className={financeModuleFilterFieldClass()}
                value={draftFilters.year}
                onChange={(e) =>
                  setDraftFilters((prev) => ({ ...prev, year: e.target.value }))
                }
              >
                <option value="">Todos</option>
                {yearOptions.map((y) => (
                  <option key={y} value={String(y)}>
                    {y}
                  </option>
                ))}
              </select>
            </FilterField>

            <FilterField label="Mês">
              <select
                className={financeModuleFilterFieldClass()}
                value={draftFilters.month}
                onChange={(e) =>
                  setDraftFilters((prev) => ({ ...prev, month: e.target.value }))
                }
              >
                {MONTH_OPTIONS.map((m) => (
                  <option key={m.value || "all"} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </FilterField>

            <FilterField label="Pedido">
              <input
                className={financeModuleFilterFieldClass()}
                value={draftFilters.orderCode}
                onChange={(e) =>
                  setDraftFilters((prev) => ({ ...prev, orderCode: e.target.value }))
                }
                placeholder="Ex.: PD 02339"
                data-testid="portfolio-filter-order"
              />
            </FilterField>

            <FilterField label="Status">
              <select
                className={financeModuleFilterFieldClass()}
                value={draftFilters.status}
                onChange={(e) =>
                  setDraftFilters((prev) => ({ ...prev, status: e.target.value }))
                }
              >
                <option value="">Todos</option>
                {(available?.statuses ?? []).map((status) => (
                  <option key={status} value={status}>
                    {formatPortfolioStatusLabel(status)}
                  </option>
                ))}
              </select>
            </FilterField>

            <FilterField label="Confiança">
              <select
                className={financeModuleFilterFieldClass()}
                value={draftFilters.confidenceLevel}
                onChange={(e) =>
                  setDraftFilters((prev) => ({
                    ...prev,
                    confidenceLevel: e.target.value,
                  }))
                }
              >
                <option value="">Todas</option>
                {(available?.confidenceLevels?.length
                  ? available.confidenceLevels
                  : ["HIGH", "MEDIUM", "LOW", "BLOCKED"]
                ).map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </FilterField>

            <FilterField label="Fonte da previsão">
              <select
                className={financeModuleFilterFieldClass()}
                value={draftFilters.forecastSource}
                onChange={(e) =>
                  setDraftFilters((prev) => ({
                    ...prev,
                    forecastSource: e.target.value,
                  }))
                }
              >
                <option value="">Todas</option>
                {(available?.forecastSources?.length
                  ? available.forecastSources
                  : ["RECEIVABLE", "NFE", "ORDER", "UNRESOLVED"]
                ).map((source) => (
                  <option key={source} value={source}>
                    {formatPortfolioForecastSourceLabel(source)}
                  </option>
                ))}
              </select>
            </FilterField>

            <FilterField label="Run de conciliação">
              <select
                className={financeModuleFilterFieldClass()}
                value={draftFilters.runId}
                onChange={(e) =>
                  setDraftFilters((prev) => ({ ...prev, runId: e.target.value }))
                }
                data-testid="portfolio-filter-run"
              >
                <option value="">Último run com sucesso</option>
                {runs.map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.status} · {formatFinanceDateTime(run.finishedAt ?? run.createdAt)} ·{" "}
                    {run.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </FilterField>

            <label className="flex items-end gap-2 pb-2 text-sm text-foreground">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border"
                checked={draftFilters.onlyIssues}
                onChange={(e) =>
                  setDraftFilters((prev) => ({
                    ...prev,
                    onlyIssues: e.target.checked,
                  }))
                }
                data-testid="portfolio-filter-only-issues"
              />
              <span>Apenas divergências / alertas</span>
            </label>
          </div>
        </FinanceBiFilterPanel>

        {payload?.run ? (
          <p
            className="mb-3 text-xs text-muted-foreground"
            data-testid="portfolio-reconciliation-run-meta"
          >
            Run {payload.run.id.slice(0, 8)}… · {payload.run.status} ·{" "}
            {formatFinanceDateTime(payload.run.finishedAt ?? payload.run.createdAt)}
            {payload.run.mode ? ` · modo ${payload.run.mode}` : ""}
          </p>
        ) : null}

        {loading && !payload ? (
          <FinanceModuleLoadingBlock label="Carregando conciliação de carteira…" />
        ) : null}

        {noRun ? (
          <FinanceModuleEmptyState
            title="Sem conciliação materializada"
            description={PORTFOLIO_RECONCILIATION_NO_RUN_UI_MESSAGE}
            icon={<AlertTriangle className="h-5 w-5" />}
          />
        ) : null}

        {!noRun && payload?.businessAnswers ? (
          <div className="mb-4 space-y-3">
            <div
              className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950"
              data-testid="portfolio-reconciliation-business-banner"
            >
              <p>{PORTFOLIO_RECONCILIATION_BUSINESS_ANSWERS_BANNER}</p>
            </div>
            <PortfolioReconciliationSummaryCardsView
              answers={payload.businessAnswers}
              onFilterHint={applyBusinessAnswerFilter}
            />
            {payload.comparison ? (
              <PortfolioReconciliationComparisonPanel comparison={payload.comparison} />
            ) : null}
          </div>
        ) : null}

        {!loading && !noRun && !error && payload && !hasRows ? (
          <FinanceModuleEmptyState
            title="Nenhum resultado"
            description="Não há pedidos para os filtros aplicados nesta conciliação materializada."
          />
        ) : null}

        {!noRun && hasRows && payload ? (
          <>
            {hasAlerts ? (
              <div
                className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
                data-testid="portfolio-reconciliation-alerts-banner"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  Há {payload.businessAnswers?.precisaRevisar.ordersCount ??
                    payload.summary?.pedidosComAlerta ??
                    0}{" "}
                  pedido(s) com alerta nesta visão.
                  Use “Apenas divergências” ou o card Precisa revisar para focar a auditoria.
                </p>
              </div>
            ) : null}
            <PortfolioReconciliationOrdersTable
              rows={payload.rows}
              page={payload.pagination.page}
              pageSize={payload.pagination.pageSize}
              totalRows={payload.pagination.totalRows}
              totalPages={payload.pagination.totalPages}
              onPageChange={onPageChange}
              onOpenOrder={openOrder}
            />
          </>
        ) : null}

        <PortfolioReconciliationOrderDrawer
          open={Boolean(detailOrderId)}
          salesOrderId={detailOrderId}
          listFilters={appliedFilters}
          onClose={() => setDetailOrderId(null)}
        />
      </FinanceBiDashboardShell>
    </div>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className={financeModuleFilterLabelClass()}>{label}</span>
      {children}
    </label>
  );
}
