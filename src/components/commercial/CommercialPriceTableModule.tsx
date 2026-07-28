import React, { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { CommercialPublishedPricesGrid } from "@/src/components/pricing/CommercialPublishedPricesGrid";
import { useCommercialPublishedPrices } from "@/src/components/pricing/useCommercialPublishedPrices";
import { resolveCommercialPublishedEmptyMessage } from "@/src/lib/pricing/commercialPublishedPricesUi";
import type { PricingSortKey } from "@/src/lib/pricingListFilters";
import { useAuth } from "@/src/contexts/AuthContext";
import { canViewCommercialPriceTable } from "@/src/lib/commercialPriceTableAccess";
import { AccessDenied } from "@/src/components/AccessDenied";

/**
 * Consulta de preços comerciais publicados (Formação de Preço),
 * com filtros e grid no estilo da listagem de Pedidos de Venda.
 * Somente leitura — sem geração/publicação, sem info tributária.
 */
export function CommercialPriceTableModule() {
  const auth = useAuth();
  const canView = canViewCommercialPriceTable(auth);

  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<PricingSortKey>("NAME_ASC");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch(searchDraft.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchDraft]);

  const {
    tables,
    rows,
    loading,
    error,
    pagination,
    message: publishedMessage,
  } = useCommercialPublishedPrices({
    search,
    taxRuleId: "",
    marginBand: "ALL",
    commissionBand: "ALL",
    sortBy,
    page,
    pageSize: 50,
  });

  const emptyMessage = useMemo(
    () =>
      resolveCommercialPublishedEmptyMessage(
        tables.length === 0
          ? {
              referenceDate: "",
              tables: [],
              rows: [],
              pagination,
              totals: { tableCount: 0, rowCount: 0, pricedCellCount: 0, emptyCellCount: 0 },
              message: publishedMessage,
            }
          : {
              referenceDate: "",
              tables,
              rows,
              pagination,
              totals: {
                tableCount: tables.length,
                rowCount: rows.length,
                pricedCellCount: 0,
                emptyCellCount: 0,
              },
              message: publishedMessage,
            },
        rows.length,
        Boolean(search)
      ),
    [pagination, publishedMessage, rows, search, tables]
  );

  const hasActiveFilters = Boolean(searchDraft.trim() || sortBy !== "NAME_ASC");

  if (!canView) {
    return <AccessDenied moduleId="commercial-price-table" />;
  }

  return (
    <div className="space-y-4" data-testid="commercial-price-table-root">
      <div
        className="rounded-xl border border-border bg-card/60 p-3"
        data-testid="commercial-price-table-filter-bar"
      >
        <div className="grid grid-cols-12 gap-3 items-end">
          <div className="col-span-12 lg:col-span-7 relative">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Produto / SKU
            </label>
            <div className="relative mt-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="search"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                placeholder="Buscar por produto ou SKU..."
                className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-background border border-border text-sm outline-none focus:ring-2 focus:ring-primary/20"
                data-testid="commercial-price-table-search"
              />
            </div>
          </div>

          <div className="col-span-12 sm:col-span-6 lg:col-span-3">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Ordenação
            </label>
            <select
              className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none"
              value={sortBy}
              onChange={(e) => {
                setSortBy(e.target.value as PricingSortKey);
                setPage(1);
              }}
              data-testid="commercial-price-table-sort"
            >
              <option value="NAME_ASC">Nome</option>
              <option value="SKU_ASC">SKU</option>
            </select>
          </div>

          <div className="col-span-12 sm:col-span-6 lg:col-span-2 flex lg:justify-end">
            <button
              type="button"
              disabled={!hasActiveFilters}
              onClick={() => {
                setSearchDraft("");
                setSearch("");
                setSortBy("NAME_ASC");
                setPage(1);
              }}
              className="inline-flex w-full lg:w-auto items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              <X className="h-4 w-4" /> Limpar
            </button>
          </div>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          Exibindo <span className="font-bold text-foreground">{rows.length}</span> de{" "}
          <span className="font-bold text-foreground">{pagination.total}</span> produto(s)
          {tables.length > 0 ? (
            <>
              {" "}
              · <span className="font-bold text-foreground">{tables.length}</span> tabela(s) de preço
            </>
          ) : null}
          .
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <CommercialPublishedPricesGrid
        variant="consult"
        tables={tables}
        rows={rows}
        loading={loading}
        emptyMessage={emptyMessage}
        onRowClick={() => undefined}
        onPriceCellClick={() => undefined}
      />

      {pagination.totalPages > 1 ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground">
            Página <span className="font-bold text-foreground">{pagination.page}</span> de{" "}
            <span className="font-bold text-foreground">{pagination.totalPages}</span>
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pagination.page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={pagination.page >= pagination.totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
            >
              Próxima
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
