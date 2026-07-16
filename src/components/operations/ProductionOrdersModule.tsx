import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  formatProductionOrderPrimaryCustomer,
  formatProductionOrderPrimaryOrder,
  formatProductionOrderQuantity,
  formatProductionOrderStatusLabel,
  hasActiveProductionOrdersFilters,
  PRODUCTION_ORDERS_BREADCRUMB,
  PRODUCTION_ORDERS_PAGE_SUBTITLE,
  PRODUCTION_ORDERS_PAGE_TITLE,
  resolveLatestSyncedAt,
} from "@/src/lib/productionOrdersUi";
import { cn } from "@/src/lib/utils";

const PAGE_SIZE = 50;

export function ProductionOrdersModule() {
  const auth = useAuth();
  const permissions = usePermissions();
  const canView = canViewProductionOrders({
    canPerformAction: permissions.canPerformAction,
    hasPermission: (permission) => auth.hasPermission(permission),
  });

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [tipo, setTipo] = useState("");
  const [company, setCompany] = useState("");
  const [page, setPage] = useState(1);

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

  const filtersActive = hasActiveProductionOrdersFilters({
    search,
    status,
    tipo,
    company,
  });

  const statusChips = useMemo(() => buildStatusChipEntries(statusCounts), [statusCounts]);
  const latestSyncedAt = useMemo(() => resolveLatestSyncedAt(rows), [rows]);

  const loadList = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setErrorKind(null);
    setErrorMessage(null);
    try {
      const data = await fetchProductionOrdersList({
        page,
        pageSize: PAGE_SIZE,
        search,
        status,
        tipo: tipo.trim() || null,
        company: company.trim() || null,
      });
      setRows(data.rows);
      setTotal(data.total);
      setTotalPages(data.totalPages);
      setStatusCounts(data.statusCounts);
      setHasLoadedOnce(true);
    } catch (error: unknown) {
      const classified = classifyProductionOrdersListError(error);
      setErrorKind(classified.kind);
      setErrorMessage(classified.message);
      setRows([]);
      setTotal(0);
      setTotalPages(1);
      setStatusCounts({});
      setHasLoadedOnce(true);
    } finally {
      setLoading(false);
    }
  }, [canView, page, search, status, tipo, company]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    setPage(1);
  }, [search, status, tipo, company]);

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

  const showEmptyCatalog = hasLoadedOnce && !loading && !errorMessage && total === 0 && !filtersActive;
  const showEmptyFilters = hasLoadedOnce && !loading && !errorMessage && total === 0 && filtersActive;

  return (
    <div className="space-y-4" data-testid="production-orders-module">
      <div className="space-y-1">
        <p
          className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
          data-testid="production-orders-breadcrumb"
        >
          {PRODUCTION_ORDERS_BREADCRUMB}
        </p>
        <h2 className="text-xl font-semibold text-foreground">{PRODUCTION_ORDERS_PAGE_TITLE}</h2>
        <p className="text-sm text-muted-foreground">{PRODUCTION_ORDERS_PAGE_SUBTITLE}</p>
      </div>

      <div
        className="rounded-xl border border-border bg-card p-3"
        data-testid="production-orders-filters"
      >
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted-foreground">
            Busca
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                data-testid="production-orders-search"
                className="w-full rounded-lg border border-border bg-background py-2 pl-8 pr-3 text-sm text-foreground"
                placeholder="OP, produto, cliente ou pedido…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setSearch(searchInput.trim());
                }}
              />
            </div>
          </label>
          <label className="flex w-full flex-col gap-1 text-xs text-muted-foreground lg:w-40">
            Tipo
            <input
              data-testid="production-orders-tipo"
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              placeholder="Ex.: Injeção"
            />
          </label>
          <label className="flex w-full flex-col gap-1 text-xs text-muted-foreground lg:w-44">
            Empresa
            <input
              data-testid="production-orders-company"
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Ex.: KOPPETEL"
            />
          </label>
          <button
            type="button"
            data-testid="production-orders-apply-filters"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            onClick={() => setSearch(searchInput.trim())}
          >
            Filtrar
          </button>
          <button
            type="button"
            data-testid="production-orders-clear-filters"
            className="rounded-lg border border-border px-4 py-2 text-sm text-foreground"
            onClick={() => {
              setSearchInput("");
              setSearch("");
              setStatus(null);
              setTipo("");
              setCompany("");
            }}
          >
            Limpar
          </button>
        </div>
      </div>

      <div
        className="flex flex-wrap gap-2"
        data-testid="production-orders-status-chips"
        role="tablist"
        aria-label="Filtro por status"
      >
        <button
          type="button"
          role="tab"
          aria-selected={status == null}
          data-testid="production-orders-status-all"
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
            status == null
              ? "border-primary bg-primary/10 text-primary"
              : "border-border bg-card text-muted-foreground hover:text-foreground"
          )}
          onClick={() => setStatus(null)}
        >
          Todos
        </button>
        {statusChips.map((chip) => {
          const selected = status === chip.value;
          const chipKey = chip.value ?? "__null__";
          return (
            <button
              key={chipKey}
              type="button"
              role="tab"
              aria-selected={selected}
              data-testid={`production-orders-status-${chipKey}`}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                selected
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setStatus(chip.value)}
            >
              {chip.label}
              <span className="ml-1 opacity-70">({chip.count})</span>
            </button>
          );
        })}
      </div>

      <div
        className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"
        data-testid="production-orders-meta"
      >
        <span>
          Total filtrado: <strong className="text-foreground">{total}</strong>
        </span>
        <span>
          Última sincronização nos dados:{" "}
          <strong className="text-foreground">
            {formatProductionOrderDateTime(latestSyncedAt)}
          </strong>
        </span>
      </div>

      {errorMessage ? (
        <div
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
            onClick={() => void loadList()}
          >
            Tentar novamente
          </button>
        </div>
      ) : null}

      <div
        className="overflow-hidden rounded-xl border border-border bg-card"
        data-testid="production-orders-grid"
      >
        {loading ? (
          <div
            className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground"
            data-testid="production-orders-loading"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
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
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">OP</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Produto</th>
                  <th className="px-3 py-2 font-medium">Quantidade</th>
                  <th className="px-3 py-2 font-medium">Tipo</th>
                  <th className="px-3 py-2 font-medium">Pedido</th>
                  <th className="px-3 py-2 font-medium">Cliente</th>
                  <th className="px-3 py-2 font-medium">Abertura</th>
                  <th className="px-3 py-2 font-medium">Prevista</th>
                  <th className="px-3 py-2 font-medium">Vínculos</th>
                  <th className="px-3 py-2 font-medium">Sync</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-border/70 last:border-0 hover:bg-muted/30"
                    data-testid={`production-orders-row-${row.externalId}`}
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium text-foreground">{row.name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">#{row.externalId}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                        {formatProductionOrderStatusLabel(row.status)}
                      </span>
                      {row.hasPendingLink ? (
                        <div className="mt-1 text-[11px] text-amber-700">Vínculo pendente</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{row.productCode ?? "—"}</div>
                      <div className="line-clamp-1 max-w-[220px] text-xs text-muted-foreground">
                        {row.productDescription ?? "—"}
                      </div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {formatProductionOrderQuantity(row.quantity, row.unit)}
                    </td>
                    <td className="px-3 py-2">{row.tipo ?? "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {formatProductionOrderPrimaryOrder(row)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="line-clamp-1 max-w-[180px]">
                        {formatProductionOrderPrimaryCustomer(row)}
                      </div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {formatProductionOrderDateTime(row.openedAt)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {formatProductionOrderDateTime(row.plannedAt)}
                    </td>
                    <td className="px-3 py-2">{row.currentLinkCount}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {formatProductionOrderDateTime(row.syncedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalPages > 1 ? (
        <div
          className="flex items-center justify-between gap-3 text-sm"
          data-testid="production-orders-pagination"
        >
          <span className="text-muted-foreground">
            Página {page} de {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-40"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Anterior
            </button>
            <button
              type="button"
              className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-40"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
