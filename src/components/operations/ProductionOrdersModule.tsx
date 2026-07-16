import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Loader2, Search } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import {
  fetchProductionOrdersList,
  type ProductionOrderGridRow,
} from "@/src/lib/productionOrdersClient";
import {
  buildStatusChipEntries,
  canViewProductionOrders,
  classifyProductionOrdersListError,
  formatProductionOrderDateTime,
  formatProductionOrderDeliveryTimingLabel,
  formatProductionOrderQuantity,
  formatProductionOrderStatusLabel,
  hasActiveProductionOrdersFilters,
  isProductionOrdersDateRangeInvalid,
  productionOrderDeliveryTimingOverlayTone,
  productionOrderExtraSalesOrderCount,
  productionOrderStatusOverlayTone,
  PRODUCTION_ORDERS_BREADCRUMB,
  resolveLatestSyncedAt,
  resolveProductionOrderDeliveryTiming,
} from "@/src/lib/productionOrdersUi";
import { cn } from "@/src/lib/utils";
import { ProductionOrderQuickDetailOverlay } from "./ProductionOrderQuickDetailOverlay";
import { OverlayBadge } from "@/src/components/ui/overlay";

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;
const FILTER_CONTROL_CLASS =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-shadow focus:border-primary focus:ring-2 focus:ring-primary/20";

function initialParam(params: URLSearchParams, key: string): string {
  return params.get(key)?.trim() ?? "";
}

function initialPage(params: URLSearchParams): number {
  const parsed = Number.parseInt(params.get("page") ?? "1", 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
}

export function ProductionOrdersModule() {
  const auth = useAuth();
  const permissions = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();
  const canView = canViewProductionOrders({
    canPerformAction: permissions.canPerformAction,
    hasPermission: (permission) => auth.hasPermission(permission),
  });

  const [searchDraft, setSearchDraft] = useState(() => initialParam(searchParams, "search"));
  const [tipoDraft, setTipoDraft] = useState(() => initialParam(searchParams, "tipo"));
  const [companyDraft, setCompanyDraft] = useState(() => initialParam(searchParams, "company"));
  const [search, setSearch] = useState(searchDraft);
  const [tipo, setTipo] = useState(tipoDraft);
  const [company, setCompany] = useState(companyDraft);
  const [status, setStatus] = useState<string | null>(() => searchParams.get("status"));
  const [from, setFrom] = useState(() => initialParam(searchParams, "from"));
  const [to, setTo] = useState(() => initialParam(searchParams, "to"));
  const [page, setPage] = useState(() => initialPage(searchParams));
  const [retryToken, setRetryToken] = useState(0);
  const [selectedProductionOrderId, setSelectedProductionOrderId] = useState<string | null>(null);

  const [rows, setRows] = useState<ProductionOrderGridRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [errorKind, setErrorKind] = useState<
    "access_denied" | "api_unavailable" | "generic" | null
  >(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const topGridScrollRef = useRef<HTMLDivElement>(null);
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const [gridScrollWidth, setGridScrollWidth] = useState(1280);
  const dateRangeInvalid = isProductionOrdersDateRangeInvalid(from, to);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextSearch = searchDraft.trim();
      const nextTipo = tipoDraft.trim();
      const nextCompany = companyDraft.trim();
      if (nextSearch === search && nextTipo === tipo && nextCompany === company) return;
      setPage(1);
      setSearch(nextSearch);
      setTipo(nextTipo);
      setCompany(nextCompany);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchDraft, tipoDraft, companyDraft, search, tipo, company]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (page > 1) next.set("page", String(page));
    if (search) next.set("search", search);
    if (status) next.set("status", status);
    if (tipo) next.set("tipo", tipo);
    if (company) next.set("company", company);
    if (from) next.set("from", from);
    if (to) next.set("to", to);
    setSearchParams(next, { replace: true });
  }, [page, search, status, tipo, company, from, to, setSearchParams]);

  useEffect(() => {
    if (!canView) return;
    if (dateRangeInvalid) {
      setLoading(false);
      setErrorKind(null);
      setErrorMessage(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setErrorKind(null);
    setErrorMessage(null);
    void fetchProductionOrdersList(
      {
        page,
        pageSize: PAGE_SIZE,
        search,
        status,
        tipo: tipo || null,
        company: company || null,
        from: from || null,
        to: to || null,
      },
      controller.signal
    )
      .then((data) => {
        if (controller.signal.aborted) return;
        if (data.total > 0 && data.page > data.totalPages) {
          setPage(data.totalPages);
          return;
        }
        setRows(data.rows);
        setTotal(data.total);
        setTotalPages(data.totalPages);
        setStatusCounts(data.statusCounts);
        setHasLoadedOnce(true);
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
        const classified = classifyProductionOrdersListError(error);
        setErrorKind(classified.kind);
        setErrorMessage(classified.message);
        setRows([]);
        setTotal(0);
        setTotalPages(1);
        setStatusCounts({});
        setHasLoadedOnce(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [canView, dateRangeInvalid, page, search, status, tipo, company, from, to, retryToken]);

  const filtersActive = hasActiveProductionOrdersFilters({
    search,
    status,
    tipo,
    company,
    from,
    to,
  });
  const statusChips = useMemo(() => buildStatusChipEntries(statusCounts), [statusCounts]);
  const statusTotal = useMemo(
    () => Object.values(statusCounts).reduce((sum, count) => sum + count, 0),
    [statusCounts]
  );
  const latestSyncedAt = useMemo(() => resolveLatestSyncedAt(rows), [rows]);
  const draftFiltersActive = Boolean(
    searchDraft.trim() ||
      tipoDraft.trim() ||
      companyDraft.trim() ||
      status ||
      from ||
      to
  );

  useEffect(() => {
    const viewport = gridScrollRef.current;
    if (!viewport) return;
    const updateWidth = () => setGridScrollWidth(Math.max(viewport.scrollWidth, viewport.clientWidth));
    updateWidth();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateWidth);
    observer?.observe(viewport);
    const table = viewport.querySelector("table");
    if (table) observer?.observe(table);
    window.addEventListener("resize", updateWidth);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateWidth);
    };
  }, [rows]);

  if (!canView) {
    return (
      <div
        className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground"
        data-testid="production-orders-denied"
      >
        Você não possui permissão para acessar Ordens de Produção.
      </div>
    );
  }

  const showEmptyCatalog =
    hasLoadedOnce && !loading && !errorMessage && total === 0 && !filtersActive;
  const showEmptyFilters =
    hasLoadedOnce && !loading && !errorMessage && total === 0 && filtersActive;
  const initialLoading = loading && (!hasLoadedOnce || rows.length === 0);

  const clearFilters = () => {
    setSearchDraft("");
    setTipoDraft("");
    setCompanyDraft("");
    setSearch("");
    setStatus(null);
    setTipo("");
    setCompany("");
    setFrom("");
    setTo("");
    setPage(1);
  };

  return (
    <div className="space-y-4" data-testid="production-orders-module">
      <p
        className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
        data-testid="production-orders-breadcrumb"
      >
        {PRODUCTION_ORDERS_BREADCRUMB}
      </p>

      <div
        className="rounded-xl border border-border bg-card p-3"
        data-testid="production-orders-filters"
      >
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(16rem,1fr)_10rem_12rem_9.5rem_9.5rem_auto]">
          <FilterField label="Busca geral">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                data-testid="production-orders-search"
                className={cn(FILTER_CONTROL_CLASS, "pl-8")}
                placeholder="OP, produto, cliente ou pedido…"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
              />
            </div>
          </FilterField>
          <FilterField label="Tipo">
            <input
              data-testid="production-orders-tipo"
              className={FILTER_CONTROL_CLASS}
              value={tipoDraft}
              onChange={(event) => setTipoDraft(event.target.value)}
              placeholder="Ex.: Injeção"
            />
          </FilterField>
          <FilterField label="Empresa">
            <input
              data-testid="production-orders-company"
              className={FILTER_CONTROL_CLASS}
              value={companyDraft}
              onChange={(event) => setCompanyDraft(event.target.value)}
              placeholder="Ex.: KOPPETEL"
            />
          </FilterField>
          <FilterField label="Abertura de">
            <input
              type="date"
              data-testid="production-orders-from"
              className={FILTER_CONTROL_CLASS}
              value={from}
              aria-invalid={dateRangeInvalid}
              onChange={(event) => {
                setPage(1);
                setFrom(event.target.value);
              }}
            />
          </FilterField>
          <FilterField label="Abertura até">
            <input
              type="date"
              data-testid="production-orders-to"
              className={FILTER_CONTROL_CLASS}
              value={to}
              aria-invalid={dateRangeInvalid}
              onChange={(event) => {
                setPage(1);
                setTo(event.target.value);
              }}
            />
          </FilterField>
          <div className="flex items-end">
            <button
              type="button"
              data-testid="production-orders-clear-filters"
              className="w-full rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={clearFilters}
              disabled={!draftFiltersActive}
            >
              Limpar filtros
            </button>
          </div>
        </div>
        {dateRangeInvalid ? (
          <p className="mt-2 text-xs font-medium text-rose-700" role="alert">
            A data inicial não pode ser posterior à data final.
          </p>
        ) : null}
      </div>

      <div
        className="flex flex-wrap gap-2"
        data-testid="production-orders-status-chips"
        role="group"
        aria-label="Filtro por status"
      >
        <StatusChip
          label={hasLoadedOnce ? `Todos (${statusTotal})` : "Todos"}
          selected={status == null}
          testId="production-orders-status-all"
          onClick={() => {
            setPage(1);
            setStatus(null);
          }}
        />
        {statusChips.map((chip) => (
          <StatusChip
            key={chip.value}
            label={`${chip.label} (${chip.count})`}
            selected={status === chip.value}
            testId={`production-orders-status-${chip.value}`}
            onClick={() => {
              setPage(1);
              setStatus(chip.value);
            }}
          />
        ))}
      </div>

      <div
        className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"
        data-testid="production-orders-meta"
      >
        <span>
          Total filtrado: <strong className="text-foreground">{total}</strong>
        </span>
        <span>
          Última sincronização na página:{" "}
          <strong className="text-foreground">
            {formatProductionOrderDateTime(latestSyncedAt)}
          </strong>
        </span>
      </div>

      {errorMessage ? (
        <div
          role="alert"
          className={cn(
            "rounded-xl border p-4 text-sm",
            errorKind === "api_unavailable"
              ? "border-amber-300/60 bg-amber-50 text-amber-950"
              : errorKind === "access_denied"
                ? "border-rose-300/60 bg-rose-50 text-rose-950"
                : "border-destructive/40 bg-destructive/5 text-destructive"
          )}
          data-testid={
            errorKind === "api_unavailable"
              ? "production-orders-api-unavailable"
              : errorKind === "access_denied"
                ? "production-orders-error-denied"
                : "production-orders-error"
          }
        >
          {errorMessage}
          <button
            type="button"
            className="ml-3 underline"
            onClick={() => setRetryToken((token) => token + 1)}
          >
            Tentar novamente
          </button>
        </div>
      ) : null}

      {!errorMessage ? (
        <div
          className="relative overflow-hidden rounded-xl border border-border bg-card"
          data-testid="production-orders-grid"
          aria-busy={loading}
        >
          {loading && hasLoadedOnce ? (
            <div
              className="absolute right-3 top-2 z-10 inline-flex items-center gap-1.5 rounded-full border border-border bg-card/95 px-2.5 py-1 text-xs text-muted-foreground shadow-sm"
              role="status"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Atualizando…
            </div>
          ) : null}
          {initialLoading ? (
          <div
            className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground"
            data-testid="production-orders-loading"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Carregando ordens de produção…
          </div>
          ) : showEmptyCatalog ? (
          <div
            className="p-10 text-center text-sm text-muted-foreground"
            data-testid="production-orders-empty"
          >
            Nenhuma ordem de produção sincronizada ainda.
          </div>
          ) : showEmptyFilters ? (
          <div
            className="p-10 text-center text-sm text-muted-foreground"
            data-testid="production-orders-empty-filters"
          >
            Nenhum resultado para os filtros aplicados.
          </div>
          ) : (
          <>
          <div
            ref={topGridScrollRef}
            className="max-w-full overflow-x-auto overflow-y-hidden"
            data-testid="production-orders-grid-top-scroll"
            aria-label="Rolagem horizontal superior da tabela"
            onScroll={(event) => {
              const grid = gridScrollRef.current;
              if (grid && grid.scrollLeft !== event.currentTarget.scrollLeft) grid.scrollLeft = event.currentTarget.scrollLeft;
            }}
          >
            <div className="h-px" style={{ width: gridScrollWidth }} aria-hidden="true" />
          </div>
          <div
            ref={gridScrollRef}
            className="max-w-full overflow-x-auto"
            data-testid="production-orders-grid-scroll"
            onScroll={(event) => {
              const top = topGridScrollRef.current;
              if (top && top.scrollLeft !== event.currentTarget.scrollLeft) top.scrollLeft = event.currentTarget.scrollLeft;
            }}
          >
            <table className="min-w-[1280px] text-left text-sm">
              <caption className="sr-only">
                Ordens de Produção sincronizadas do Nomus. Ative uma linha para abrir a auditoria.
              </caption>
              <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  {[
                    "Ordem",
                    "Tipo",
                    "Produto",
                    "Quantidade",
                    "Prioridade",
                    "Data de abertura",
                    "Data planejada",
                    "Data de entrega",
                    "Status",
                    "Pedido de Venda",
                    "Última sincronização",
                  ].map((label) => (
                    <th key={label} className="whitespace-nowrap px-3 py-2 font-medium">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <ProductionOrderGridTableRow
                    key={row.id}
                    row={row}
                    selected={selectedProductionOrderId === row.id}
                    onOpen={() => setSelectedProductionOrderId(row.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          </>
          )}
        </div>
      ) : null}

      {totalPages > 1 ? (
        <div
          className="flex items-center justify-between gap-3 text-sm"
          data-testid="production-orders-pagination"
          role="navigation"
          aria-label="Paginação das Ordens de Produção"
        >
          <span className="text-muted-foreground">
            Página {page} de {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-40"
              disabled={page <= 1 || loading}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Anterior
            </button>
            <button
              type="button"
              className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-40"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((current) => current + 1)}
            >
              Próxima
            </button>
          </div>
        </div>
      ) : null}

      <ProductionOrderQuickDetailOverlay
        productionOrderId={selectedProductionOrderId}
        onClose={() => setSelectedProductionOrderId(null)}
      />
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
    <label className="flex min-w-0 flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

function StatusChip({
  label,
  selected,
  testId,
  onClick,
}: {
  label: string;
  selected: boolean;
  testId: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      data-testid={testId}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        selected
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-card text-muted-foreground hover:text-foreground"
      )}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function ProductionOrderGridTableRow({
  row,
  selected,
  onOpen,
}: {
  row: ProductionOrderGridRow;
  selected: boolean;
  onOpen: () => void;
}) {
  const firstOrder = row.currentSalesOrders[0];
  const extraOrders = productionOrderExtraSalesOrderCount(row);
  const pendingOrder =
    Boolean(firstOrder && !firstOrder.salesOrderId) || (row.hasPendingLink && !firstOrder);
  return (
    <tr
      tabIndex={0}
      aria-selected={selected}
      data-selected={selected ? "true" : "false"}
      aria-label={`Abrir auditoria da Ordem de Produção ${row.name ?? row.externalId}`}
      className="cursor-pointer border-b border-border/70 outline-none last:border-0 hover:bg-muted/30 focus-visible:bg-muted/40 data-[selected=true]:bg-primary/5"
      data-testid={`production-orders-row-${row.externalId}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <td className="px-3 py-2">
        <div className="whitespace-nowrap font-semibold text-foreground">{row.name ?? "—"}</div>
        <div className="text-xs text-muted-foreground">#{row.externalId}</div>
      </td>
      <td className="px-3 py-2">{row.tipo ?? "—"}</td>
      <td className="px-3 py-2">
        <div className="font-medium text-foreground">{row.productCode ?? "—"}</div>
        <div
          className="max-w-[20rem] overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground"
          title={row.productDescription ?? undefined}
        >
          {row.productDescription ?? "—"}
        </div>
      </td>
      <td className="whitespace-nowrap px-3 py-2 tabular-nums">
        {formatProductionOrderQuantity(row.quantity, row.unit)}
      </td>
      <td className="px-3 py-2">{row.priority ?? "—"}</td>
      <td className="whitespace-nowrap px-3 py-2">
        {formatProductionOrderDateTime(row.openedAt)}
      </td>
      <td className="whitespace-nowrap px-3 py-2">
        {formatProductionOrderDateTime(row.plannedAt)}
      </td>
      <td className="whitespace-nowrap px-3 py-2">
        {formatProductionOrderDateTime(row.deliveryAt)}
      </td>
      <td className="px-3 py-2">
        <OverlayBadge tone={productionOrderStatusOverlayTone(row.status)}>
          {formatProductionOrderStatusLabel(row.status)}
        </OverlayBadge>
      </td>
      <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
        {pendingOrder ? (
          <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
            Pedido ainda não sincronizado
          </span>
        ) : firstOrder ? (
          <div className="flex items-center gap-1">
            <Link
              to={`/sales-orders/${firstOrder.salesOrderId}`}
              className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800 hover:underline"
              data-testid={`production-order-sales-link-${firstOrder.externalSalesOrderId}`}
            >
              {firstOrder.orderCode?.trim() || firstOrder.externalSalesOrderId}
            </Link>
            {extraOrders > 0 ? (
              <span
                className="inline-flex rounded-full border border-border bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground"
                title={row.currentSalesOrders
                  .slice(1)
                  .map((order) => order.orderCode ?? order.externalSalesOrderId)
                  .join(", ")}
              >
                +{extraOrders}
              </span>
            ) : null}
          </div>
        ) : (
          "—"
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2">
        {formatProductionOrderDateTime(row.syncedAt)}
      </td>
    </tr>
  );
}
