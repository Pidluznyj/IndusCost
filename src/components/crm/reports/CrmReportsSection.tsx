import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, EyeOff, Info, Loader2, RefreshCw, ShieldAlert, Users, X } from "lucide-react";
import { cn } from "@/src/lib/utils";
import {
  classifyCrmReportsError,
  describeCrmReportsError,
  downloadCrmReportsListExport,
  fetchCrmReportsFilterOptions,
  fetchCrmReportsOperational,
  isCrmReportsAbortError,
  type CrmReportsExportFormatChoice,
} from "@/src/lib/commercial/crmReportsClient";
import {
  formatCrmReportsDate,
  formatCrmReportsDateTime,
  formatCrmReportsInteger,
} from "@/src/lib/commercial/crmReportsFormat";
import {
  CRM_REPORTS_UI_PAGE_SIZES,
  CRM_REPORTS_UI_STORAGE_KEY,
  activeCrmReportsCards,
  applyCrmReportsCard,
  buildCrmReportsOperationalRequest,
  clearCrmReportsFilters,
  createDefaultCrmReportsUiState,
  hasActiveCrmReportsFilters,
  hideCheckedCrmReportsCustomers,
  parseCrmReportsUiState,
  serializeCrmReportsUiState,
  setCrmReportsCheckedMany,
  showOnlyCheckedCrmReportsCustomers,
  toggleCrmReportsChecked,
  withCrmReportsCadenceStatuses,
  withCrmReportsFilters,
  withCrmReportsOffset,
  withCrmReportsOverdueView,
  withCrmReportsPageSize,
  withCrmReportsSelection,
  type CrmReportsCardKey,
  type CrmReportsCustomerChip,
  type CrmReportsUiFilters,
  type CrmReportsUiSelection,
  type CrmReportsUiState,
} from "@/src/lib/commercial/crmReportsUiState";
import type {
  CrmReportsFilterOptionsResponse,
  CrmReportsListKey,
  CrmReportsOperationalRequest,
  CrmReportsOperationalResponse,
} from "@/src/lib/commercial/crmReportsTypes";
import { CrmReportsGlobalFilters } from "./CrmReportsGlobalFilters";
import { CrmCustomerSelectionFilter } from "./CrmCustomerSelectionFilter";
import { CrmReportsSummaryCards, CrmReportsUniverseSummary } from "./CrmReportsSummaryCards";
import { CrmRecentCustomersTable } from "./CrmRecentCustomersTable";
import { CrmRepurchaseCadenceTable } from "./CrmRepurchaseCadenceTable";
import { CrmOverdueRepurchaseTable } from "./CrmOverdueRepurchaseTable";
import { CrmReportBuilder } from "./CrmReportBuilder";
import type { CrmReportsRowActionHandlers } from "./CrmReportsShared";

// Modal canônico de Pedido de Venda — o mesmo do CRM/Pedidos, sob demanda.
const SalesOrderDetailDialog = React.lazy(() =>
  import("@/src/components/sales/SalesOrderDetailDialog").then((mod) => ({
    default: mod.SalesOrderDetailDialog,
  }))
);

export type CrmReportsSectionProps = {
  /** Cliente 360 canônico (Inteligência do Cliente) — permissão resolvida pelo CrmModule. */
  canOpenCustomer360: boolean;
  /** Detalhe do Pedido de Venda (SalesOrderDetailDialog). */
  canOpenOrderDetail: boolean;
  /** Registrar contato — modal canônico do CRM (CommercialActivity). */
  canRegisterContact: boolean;
  onRegisterContact: (customer: { customerId: string; displayName: string; taxId: string }) => void;
  /** Muda quando algo externo (ex.: contato registrado) pede recarga. */
  refreshToken?: number;
  /**
   * Dono do estado salvo na sessão do navegador (id do usuário). Sem ele nada
   * é persistido — outro usuário na mesma aba nunca herda filtros/clientes.
   */
  storageScope?: string | null;
};

type LoadError = { kind: ReturnType<typeof classifyCrmReportsError>; message: string };

function storageKeyFor(scope: string | null | undefined): string | null {
  return scope ? `${CRM_REPORTS_UI_STORAGE_KEY}:${scope}` : null;
}

function readStoredUiState(key: string | null): CrmReportsUiState {
  try {
    if (!key || typeof window === "undefined") return createDefaultCrmReportsUiState();
    return parseCrmReportsUiState(window.sessionStorage.getItem(key)) ?? createDefaultCrmReportsUiState();
  } catch {
    return createDefaultCrmReportsUiState();
  }
}

/**
 * Aba CRM > Relatórios. Na abertura carrega SÓ os metadados leves dos filtros
 * e o payload operacional (universo, cards, 1ª página das 3 listas). O
 * relatório personalizado não consulta nada até o clique em "Gerar".
 */
export function CrmReportsSection({
  canOpenCustomer360,
  canOpenOrderDetail,
  canRegisterContact,
  onRegisterContact,
  refreshToken = 0,
  storageScope = null,
}: CrmReportsSectionProps) {
  const storageKey = storageKeyFor(storageScope);
  const [ui, setUi] = useState<CrmReportsUiState>(() => readStoredUiState(storageKey));
  const [options, setOptions] = useState<CrmReportsFilterOptionsResponse | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [data, setData] = useState<CrmReportsOperationalResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [checked, setChecked] = useState<Map<string, CrmReportsCustomerChip>>(() => new Map());
  const [exporting, setExporting] = useState<{ list: CrmReportsListKey; format: CrmReportsExportFormatChoice } | null>(
    null
  );
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [detailOrder, setDetailOrder] = useState<{ id: string; code: string | null } | null>(null);

  const request = useMemo(() => buildCrmReportsOperationalRequest(ui), [ui]);
  // A chave (JSON) evita recarga quando o estado muda sem mudar o request.
  const requestKey = useMemo(() => JSON.stringify(request), [request]);

  // Metadados leves dos filtros — uma vez por abertura da aba.
  useEffect(() => {
    const controller = new AbortController();
    fetchCrmReportsFilterOptions(controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return;
        setOptions(res);
        setOptionsError(null);
        setOptionsLoading(false);
      })
      .catch((err) => {
        if (isCrmReportsAbortError(err) || controller.signal.aborted) return;
        setOptionsError(describeCrmReportsError(err, "Não foi possível carregar as opções de filtro."));
        setOptionsLoading(false);
      });
    return () => controller.abort();
  }, []);

  // Universo + cards + 3 listas. Pedido obsoleto é cancelado a cada mudança.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetchCrmReportsOperational(JSON.parse(requestKey) as CrmReportsOperationalRequest, controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return;
        setData(res);
        setLoadError(null);
        setLoading(false);
      })
      .catch((err) => {
        if (isCrmReportsAbortError(err) || controller.signal.aborted) return;
        setLoadError({
          kind: classifyCrmReportsError(err),
          message: describeCrmReportsError(err, "Não foi possível carregar os relatórios do CRM."),
        });
        setLoading(false);
      });
    return () => controller.abort();
  }, [requestKey, refreshToken, reloadNonce]);

  // Volta do Cliente 360 com o mesmo recorte (só nesta aba do navegador, por usuário).
  useEffect(() => {
    if (!storageKey) return;
    try {
      window.sessionStorage.setItem(storageKey, serializeCrmReportsUiState(ui));
    } catch {
      // armazenamento indisponível: segue sem persistir
    }
  }, [ui, storageKey]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const filtersActive = hasActiveCrmReportsFilters(ui);

  const actions = useMemo<CrmReportsRowActionHandlers>(
    () => ({
      canOpenCustomer360,
      canOpenOrderDetail,
      canRegisterContact,
      onOpenOrder: (id, code) => setDetailOrder({ id, code }),
      onRegisterContact,
    }),
    [canOpenCustomer360, canOpenOrderDetail, canRegisterContact, onRegisterContact]
  );

  // Card clicado → leva até a lista (depois do commit; sem depender de requestAnimationFrame).
  const [scrollTarget, setScrollTarget] = useState<{ list: CrmReportsListKey; seq: number } | null>(null);
  useEffect(() => {
    if (!scrollTarget) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    document
      .getElementById(`crm-reports-list-${scrollTarget.list}`)
      ?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }, [scrollTarget]);

  const handleCard = (key: CrmReportsCardKey) => {
    const { state, target } = applyCrmReportsCard(ui, key);
    setUi(state);
    setScrollTarget((prev) => ({ list: target, seq: (prev?.seq ?? 0) + 1 }));
  };

  const handleFilters = (patch: Partial<CrmReportsUiFilters>) => setUi((s) => withCrmReportsFilters(s, patch));
  const handleSelection = (selection: CrmReportsUiSelection) => setUi((s) => withCrmReportsSelection(s, selection));
  const handlePage = (list: CrmReportsListKey) => (offset: number) =>
    setUi((s) => withCrmReportsOffset(s, list, offset));

  const handleClearAll = () => {
    setUi((s) => clearCrmReportsFilters(s));
    setChecked(new Map());
  };

  const toggleChecked = useCallback((chip: CrmReportsCustomerChip) => setChecked((m) => toggleCrmReportsChecked(m, chip)), []);
  const toggleManyChecked = useCallback(
    (chips: CrmReportsCustomerChip[], on: boolean) => setChecked((m) => setCrmReportsCheckedMany(m, chips, on)),
    []
  );

  const checkedChips = [...checked.values()];
  const hideChecked = () => {
    setUi((s) => withCrmReportsSelection(s, hideCheckedCrmReportsCustomers(s.selection, checkedChips)));
    setChecked(new Map());
  };
  const showOnlyChecked = () => {
    setUi((s) => withCrmReportsSelection(s, showOnlyCheckedCrmReportsCustomers(checkedChips)));
    setChecked(new Map());
  };

  const handleExport = (list: CrmReportsListKey) => (format: CrmReportsExportFormatChoice) => {
    setExporting({ list, format });
    downloadCrmReportsListExport(request, list, format)
      .then((file) =>
        setNotice({
          tone: "ok",
          text: `Arquivo ${file.filename} gerado${file.rowCount != null ? ` (${formatCrmReportsInteger(file.rowCount)} linhas)` : ""}.`,
        })
      )
      .catch((err) => setNotice({ tone: "error", text: describeCrmReportsError(err, "Não foi possível exportar a lista.") }))
      .finally(() => setExporting(null));
  };

  const exportingFormat = (list: CrmReportsListKey) => (exporting?.list === list ? exporting.format : null);
  const scope = data?.scope ?? options?.scope ?? null;
  const sellerNotLinked = scope?.blockedReason === "SELLER_NOT_LINKED";
  // 403 do backend (sem escopo comercial): a aba inteira fica bloqueada, sem filtros nem construtor.
  const forbidden = loadError?.kind === "forbidden";
  const firstLoad = loading && data == null && loadError == null;

  return (
    <div className="space-y-5" data-testid="crm-reports-section">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground">Relatórios</h2>
          <p className="text-sm text-muted-foreground">
            Recompra e carteira a partir do Pedido de Venda (autoridade de compra: data de emissão).
          </p>
          {scope ? (
            <p className="mt-1 inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Users className="h-3.5 w-3.5 text-primary" aria-hidden />
              {scope.dataScope === "own"
                ? "Escopo: sua carteira (Responsável Comercial vinculado ao seu usuário)."
                : "Escopo: todos os clientes permitidos pelo seu perfil."}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data ? (
            <span className="text-xs text-muted-foreground">Atualizado em {formatCrmReportsDateTime(data.asOf)}</span>
          ) : null}
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Linhas por lista
            <select
              value={ui.pageSize}
              onChange={(e) => setUi((s) => withCrmReportsPageSize(s, Number(e.target.value)))}
              className="rounded-lg border border-border bg-background px-2 py-1 text-xs font-semibold text-foreground"
            >
              {CRM_REPORTS_UI_PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setReloadNonce((n) => n + 1)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} aria-hidden />
            Atualizar
          </button>
        </div>
      </div>

      {notice ? (
        <div
          className={cn(
            "flex items-start justify-between gap-3 rounded-xl border px-4 py-2.5 text-sm",
            notice.tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-800"
          )}
          role="status"
        >
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Fechar aviso" className="shrink-0">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : null}

      {forbidden && loadError ? (
        <CrmReportsErrorPanel
          error={loadError}
          filtersActive={false}
          onRetry={() => setReloadNonce((n) => n + 1)}
          onClearFilters={handleClearAll}
        />
      ) : sellerNotLinked ? (
        <div
          className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-5 text-sm text-amber-900"
          data-testid="crm-reports-seller-not-linked"
        >
          <p className="font-semibold">Você não possui carteira comercial vinculada.</p>
          <p className="mt-1">
            {scope?.blockedMessage ??
              "Solicite ao administrador o vínculo do seu usuário como Responsável Comercial para ver os relatórios da sua carteira."}
          </p>
        </div>
      ) : (
        <>
          <CrmReportsGlobalFilters
            filters={ui.filters}
            options={options}
            optionsLoading={optionsLoading}
            optionsError={optionsError}
            filtersActive={filtersActive}
            onChange={handleFilters}
            onClearAll={handleClearAll}
          />
          <CrmCustomerSelectionFilter
            selection={ui.selection}
            selectionInfo={data?.selection ?? null}
            onChange={handleSelection}
          />

          {firstLoad ? <CrmReportsLoadingPanel /> : null}

          {loadError ? (
            <CrmReportsErrorPanel
              error={loadError}
              filtersActive={filtersActive}
              onRetry={() => setReloadNonce((n) => n + 1)}
              onClearFilters={handleClearAll}
            />
          ) : null}

          {data && !loadError ? (
            <>
              <CrmReportsSourceNote data={data} />
              <CrmReportsUniverseSummary universe={data.universe} selection={data.selection} />
              {data.universe.analyzedCustomers === 0 ? (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-4 text-sm text-muted-foreground"
                  data-testid="crm-reports-empty-universe"
                >
                  <span>
                    {filtersActive
                      ? "Nenhum cliente com os filtros atuais."
                      : "Nenhum cliente no seu universo permitido (escopo CRM, ativo, fora do grupo econômico)."}
                  </span>
                  {filtersActive ? (
                    <button
                      type="button"
                      onClick={handleClearAll}
                      className="rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent"
                    >
                      Limpar filtros
                    </button>
                  ) : null}
                </div>
              ) : null}
              <CrmReportsSummaryCards
                indicators={data.indicators}
                refreshing={loading}
                active={activeCrmReportsCards(ui.views)}
                onSelect={handleCard}
              />
              <CrmRecentCustomersTable
                page={data.recent60d}
                refreshing={loading}
                filtered={filtersActive}
                checked={checked}
                onToggleChecked={toggleChecked}
                onToggleManyChecked={toggleManyChecked}
                onPageChange={handlePage("recent")}
                actions={actions}
                exporting={exportingFormat("recent")}
                onExport={handleExport("recent")}
              />
              <CrmRepurchaseCadenceTable
                page={data.repurchaseCadence}
                refreshing={loading}
                filtered={filtersActive}
                statuses={ui.views.cadence.statuses}
                onStatusesChange={(statuses) => setUi((s) => withCrmReportsCadenceStatuses(s, statuses))}
                checked={checked}
                onToggleChecked={toggleChecked}
                onToggleManyChecked={toggleManyChecked}
                onPageChange={handlePage("cadence")}
                actions={actions}
                exporting={exportingFormat("cadence")}
                onExport={handleExport("cadence")}
              />
              <CrmOverdueRepurchaseTable
                page={data.overdueRepurchase}
                refreshing={loading}
                filtered={filtersActive}
                severity={ui.views.overdue.severity}
                sort={ui.views.overdue.sort}
                onSeverityChange={(severity) => setUi((s) => withCrmReportsOverdueView(s, { severity }))}
                onSortChange={(sort) => setUi((s) => withCrmReportsOverdueView(s, { sort }))}
                checked={checked}
                onToggleChecked={toggleChecked}
                onToggleManyChecked={toggleManyChecked}
                onPageChange={handlePage("overdue")}
                actions={actions}
                exporting={exportingFormat("overdue")}
                onExport={handleExport("overdue")}
              />
            </>
          ) : null}

          <CrmReportBuilder
            ui={ui}
            windows={data?.windows ?? null}
            filtersActive={filtersActive}
            canOpenCustomer360={canOpenCustomer360}
          />

          {checked.size > 0 ? (
            <div
              className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-card px-4 py-3 shadow-lg"
              role="region"
              aria-label="Clientes marcados"
              data-testid="crm-reports-selection-bar"
            >
              <span className="text-sm font-semibold text-foreground">
                {formatCrmReportsInteger(checked.size)} cliente(s) marcado(s)
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={hideChecked}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-900 hover:bg-red-100"
                >
                  <EyeOff className="h-3.5 w-3.5" aria-hidden />
                  Ocultar selecionados
                </button>
                <button
                  type="button"
                  onClick={showOnlyChecked}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/15"
                >
                  <Users className="h-3.5 w-3.5" aria-hidden />
                  Mostrar somente selecionados
                </button>
                <button
                  type="button"
                  onClick={() => setChecked(new Map())}
                  className="rounded-xl px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
                >
                  Limpar marcação
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}

      {detailOrder ? (
        <React.Suspense fallback={null}>
          <SalesOrderDetailDialog
            open
            salesOrderId={detailOrder.id}
            orderCode={detailOrder.code}
            onClose={() => setDetailOrder(null)}
          />
        </React.Suspense>
      ) : null}
    </div>
  );
}

export default CrmReportsSection;

function CrmReportsLoadingPanel() {
  return (
    <div className="space-y-3" aria-busy="true" data-testid="crm-reports-loading">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-32 animate-pulse rounded-2xl border border-border bg-muted/40" />
        ))}
      </div>
      <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
        Carregando indicadores e listas…
      </div>
    </div>
  );
}

function CrmReportsErrorPanel({
  error,
  filtersActive,
  onRetry,
  onClearFilters,
}: {
  error: LoadError;
  filtersActive: boolean;
  onRetry: () => void;
  onClearFilters: () => void;
}) {
  const forbidden = error.kind === "forbidden";
  const title =
    error.kind === "forbidden"
      ? "Sem permissão para os relatórios do CRM."
      : error.kind === "too-large"
        ? "Universo grande demais para montar de uma vez."
        : error.kind === "invalid"
          ? "Filtro inválido."
          : "Não foi possível carregar os relatórios.";
  return (
    <div
      className={cn(
        "rounded-2xl border px-5 py-4 text-sm",
        forbidden ? "border-amber-200 bg-amber-50 text-amber-900" : "border-red-200 bg-red-50 text-red-800"
      )}
      role="alert"
      data-testid="crm-reports-error"
      data-error-kind={error.kind}
    >
      <p className="flex items-center gap-2 font-semibold">
        {forbidden ? <ShieldAlert className="h-4 w-4" aria-hidden /> : <AlertTriangle className="h-4 w-4" aria-hidden />}
        {title}
      </p>
      <p className="mt-1">{error.message}</p>
      {error.kind === "too-large" ? (
        <p className="mt-1 text-xs">
          O relatório nunca é truncado: refine por Responsável Comercial, Cidade, UF ou clientes para caber no limite.
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {!forbidden ? (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 rounded-xl border border-current/30 bg-white/60 px-3 py-1.5 text-xs font-semibold hover:bg-white"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Tentar novamente
          </button>
        ) : null}
        {filtersActive && error.kind !== "forbidden" ? (
          <button
            type="button"
            onClick={onClearFilters}
            className="rounded-xl border border-current/30 bg-white/60 px-3 py-1.5 text-xs font-semibold hover:bg-white"
          >
            Limpar filtros
          </button>
        ) : null}
      </div>
    </div>
  );
}

function CrmReportsSourceNote({ data }: { data: CrmReportsOperationalResponse }) {
  const source = data.sourceInfo;
  return (
    <div className="space-y-2" data-testid="crm-reports-source">
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Info className="h-3.5 w-3.5" aria-hidden />
          Fonte: Pedidos de Venda oficiais (mesma população da tela Pedidos de Venda)
        </span>
        <span>
          Compra = emissão do pedido, dia civil ({source.businessTimeZone}) · hoje {formatCrmReportsDate(data.windows.today)}
        </span>
        <span>
          {formatCrmReportsInteger(source.ordersLoaded)} pedido(s) no universo · sem truncamento
        </span>
        <span>Motor {source.repurchaseVersion}</span>
      </p>
      {source.futureDatedOrdersIgnored > 0 ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {formatCrmReportsInteger(source.futureDatedOrdersIgnored)} pedido(s) com emissão depois de hoje ficaram fora das
          janelas e da cadência.
        </p>
      ) : null}
      {data.scope.commercialOwnerFilterIgnored ? (
        <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
          Filtro de Responsável Comercial ignorado: seu escopo é a sua própria carteira.
        </p>
      ) : null}
    </div>
  );
}
