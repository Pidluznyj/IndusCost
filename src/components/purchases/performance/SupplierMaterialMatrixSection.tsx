/**
 * Seção 5 — matriz Fornecedores × Matérias-primas (paginada no servidor).
 * Busca/ordenação/paginação são do backend; a UI só apresenta.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { OverlayBadge, OverlaySection, OverlayTable } from "@/src/components/ui/overlay";
import {
  SINGLE_SOURCE_OBSERVED_LABEL,
  SINGLE_SOURCE_OBSERVED_TOOLTIP,
  SUPPLIER_MATERIAL_MATRIX_SORTS,
  type SupplierMaterialMatrixResult,
  type SupplierMaterialMatrixSort,
  type SupplierPerformanceDashboardFilters,
} from "@/src/lib/purchasing/supplierPerformanceDashboard";
import { fetchSupplierMaterialMatrix } from "@/src/lib/purchasing/supplierPerformanceDashboardClient";
import {
  formatDashboardDate,
  formatDashboardInteger,
  formatDashboardMoney,
  formatDashboardPercent,
  formatDashboardPrice,
  formatDashboardQuantity,
} from "@/src/lib/purchasing/supplierPerformanceDashboardUi";
import { DashboardSection, EmptyRows, MaterialLinkButton, SupplierLinkButton } from "./SupplierPerformanceSections";

const SORT_LABELS: Record<SupplierMaterialMatrixSort, string> = {
  spend: "Valor comprado",
  shareOfMaterial: "% da MP",
  orderCount: "Nº pedidos",
  lineCount: "Nº linhas",
  lastPurchaseDate: "Última compra",
  material: "Matéria-prima",
  supplier: "Fornecedor",
  weightedAveragePrice: "Preço médio",
};

export type SupplierMaterialMatrixTableProps = {
  result: SupplierMaterialMatrixResult | null;
  loading: boolean;
  error: string | null;
  sort: SupplierMaterialMatrixSort;
  direction: "asc" | "desc";
  onSort: (sort: SupplierMaterialMatrixSort) => void;
  onPage: (page: number) => void;
  onSelectSupplier?: (id: number) => void;
  onSelectMaterial?: (key: string) => void;
};

function SortHead({
  id,
  align,
  sort,
  direction,
  onSort,
}: {
  id: SupplierMaterialMatrixSort;
  align?: "left" | "right";
  sort: SupplierMaterialMatrixSort;
  direction: "asc" | "desc";
  onSort: (sort: SupplierMaterialMatrixSort) => void;
}) {
  const active = sort === id;
  return (
    <OverlayTable.HeadCell align={align}>
      <button type="button" onClick={() => onSort(id)} className={active ? "text-primary" : undefined} aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : undefined} data-testid={`matrix-sort-${id}`}>
        {SORT_LABELS[id]}
        {active ? (direction === "asc" ? " ↑" : " ↓") : ""}
      </button>
    </OverlayTable.HeadCell>
  );
}

export function SupplierMaterialMatrixTable({
  result,
  loading,
  error,
  sort,
  direction,
  onSort,
  onPage,
  onSelectSupplier,
  onSelectMaterial,
}: SupplierMaterialMatrixTableProps) {
  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  const currency = result?.currency ?? "BRL";
  return (
    <div className="space-y-2" data-testid="supplier-material-matrix">
      {error ? <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" data-testid="matrix-error">{error}</p> : null}
      {result ? (
        <p className="text-xs text-muted-foreground" data-testid="matrix-totals">
          {formatDashboardInteger(result.totals.pairCount)} combinações · {formatDashboardInteger(result.totals.materialCount)} MPs · {formatDashboardInteger(result.totals.supplierCount)} fornecedores · {formatDashboardInteger(result.totals.orderCount)} pedidos · {formatDashboardInteger(result.totals.lineCount)} linhas · {formatDashboardMoney(result.totals.spend, currency)} (valor das linhas)
        </p>
      ) : null}
      <OverlayTable stickyHeader className="min-w-[1180px]">
        <OverlayTable.Head>
          <OverlayTable.Row>
            <SortHead id="material" sort={sort} direction={direction} onSort={onSort} />
            <OverlayTable.HeadCell>Grupo</OverlayTable.HeadCell>
            <SortHead id="supplier" sort={sort} direction={direction} onSort={onSort} />
            <SortHead id="spend" align="right" sort={sort} direction={direction} onSort={onSort} />
            <SortHead id="shareOfMaterial" align="right" sort={sort} direction={direction} onSort={onSort} />
            <SortHead id="orderCount" align="right" sort={sort} direction={direction} onSort={onSort} />
            <SortHead id="lineCount" align="right" sort={sort} direction={direction} onSort={onSort} />
            <OverlayTable.HeadCell align="right">Quantidade</OverlayTable.HeadCell>
            <SortHead id="weightedAveragePrice" align="right" sort={sort} direction={direction} onSort={onSort} />
            <OverlayTable.HeadCell align="right">Último preço</OverlayTable.HeadCell>
            <SortHead id="lastPurchaseDate" align="right" sort={sort} direction={direction} onSort={onSort} />
          </OverlayTable.Row>
        </OverlayTable.Head>
        <OverlayTable.Body>
          {loading && !result ? (
            <OverlayTable.Row>
              <OverlayTable.Cell colSpan={11} className="py-6 text-center text-muted-foreground">
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                Carregando matriz…
              </OverlayTable.Cell>
            </OverlayTable.Row>
          ) : !result || result.rows.length === 0 ? (
            <EmptyRows colSpan={11} message="Nenhuma combinação fornecedor × matéria-prima na população filtrada." />
          ) : (
            result.rows.map((row) => (
              <OverlayTable.Row key={`${row.materialKey}::${row.supplierExternalId ?? "u"}`} data-testid="matrix-row">
                <OverlayTable.Cell>
                  <MaterialLinkButton materialKey={row.materialKey} code={row.productCode} description={row.description} onSelect={onSelectMaterial} />
                  {row.singleSourceObserved ? (
                    <OverlayBadge tone="amber" className="mt-1" title={SINGLE_SOURCE_OBSERVED_TOOLTIP}>{SINGLE_SOURCE_OBSERVED_LABEL}</OverlayBadge>
                  ) : null}
                </OverlayTable.Cell>
                <OverlayTable.Cell className="text-xs text-muted-foreground">{row.group ?? "—"}</OverlayTable.Cell>
                <OverlayTable.Cell><SupplierLinkButton supplierExternalId={row.supplierExternalId} name={row.supplierName} onSelect={onSelectSupplier} /></OverlayTable.Cell>
                <OverlayTable.Cell align="right" mono>{formatDashboardMoney(row.spend, currency)}</OverlayTable.Cell>
                <OverlayTable.Cell align="right" mono>{formatDashboardPercent(row.shareOfMaterial)}</OverlayTable.Cell>
                <OverlayTable.Cell align="right" mono>{formatDashboardInteger(row.orderCount)}</OverlayTable.Cell>
                <OverlayTable.Cell align="right" mono>{formatDashboardInteger(row.lineCount)}</OverlayTable.Cell>
                <OverlayTable.Cell align="right" mono title={row.unit ? undefined : `Unidades observadas: ${row.unitsObserved.join(", ")} — sem soma entre unidades`}>
                  {row.unit ? formatDashboardQuantity(row.quantity, row.unit) : `${row.unitsObserved.length} un. distintas`}
                </OverlayTable.Cell>
                <OverlayTable.Cell align="right" mono>{formatDashboardPrice(row.weightedAveragePrice, currency, row.unit)}</OverlayTable.Cell>
                <OverlayTable.Cell align="right" mono title={row.lastPriceDate ? `Preço da compra de ${formatDashboardDate(row.lastPriceDate)}` : undefined}>{formatDashboardPrice(row.lastPrice, currency, row.unit)}</OverlayTable.Cell>
                <OverlayTable.Cell align="right" mono>{formatDashboardDate(row.lastPurchaseDate)}</OverlayTable.Cell>
              </OverlayTable.Row>
            ))
          )}
        </OverlayTable.Body>
      </OverlayTable>
      {result ? (
        <div className="flex items-center gap-2 text-sm" data-testid="matrix-pagination">
          <button type="button" disabled={result.page <= 1 || loading} onClick={() => onPage(result.page - 1)} className="rounded border px-2 py-1 disabled:opacity-50">Anterior</button>
          <span>Página {result.page} de {totalPages} · {formatDashboardInteger(result.total)} linhas</span>
          <button type="button" disabled={result.page >= totalPages || loading} onClick={() => onPage(result.page + 1)} className="rounded border px-2 py-1 disabled:opacity-50">Próxima</button>
          {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
        </div>
      ) : null}
    </div>
  );
}

export function SupplierMaterialMatrixSection({
  filters,
  onSelectSupplier,
  onSelectMaterial,
}: {
  filters: SupplierPerformanceDashboardFilters;
  onSelectSupplier?: (id: number) => void;
  onSelectMaterial?: (key: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [sort, setSort] = useState<SupplierMaterialMatrixSort>("spend");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<SupplierMaterialMatrixResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filterKey = useMemo(() => JSON.stringify(filters), [filters]);

  useEffect(() => {
    setPage(1);
  }, [filterKey, applied, sort, direction]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchSupplierMaterialMatrix(filters, { search: applied || null, sort, direction, page, pageSize: 50 }, controller.signal)
      .then((payload) => {
        if (!controller.signal.aborted) setResult(payload);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Falha ao carregar a matriz.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, applied, sort, direction, page]);

  const handleSort = useCallback(
    (next: SupplierMaterialMatrixSort) => {
      if (next === sort) {
        setDirection((d) => (d === "asc" ? "desc" : "asc"));
        return;
      }
      setSort(next);
      setDirection(next === "material" || next === "supplier" ? "asc" : "desc");
    },
    [sort]
  );

  return (
    <DashboardSection
      title="Fornecedores × Matérias-primas"
      eyebrow="Seção 5"
      description="Uma linha por combinação fornecedor × MP. Valor = SUM(valor oficial das linhas). Quantidade e preço médio só quando há uma única unidade de medida. Clique no fornecedor ou na MP para o detalhe."
      testId="performance-matrix-section"
      actions={
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setApplied(search.trim());
          }}
        >
          <label className="relative">
            <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar MP, fornecedor ou grupo…" className="w-64 rounded-md border border-border bg-white py-1.5 pl-8 pr-3 text-sm" data-testid="matrix-search" />
          </label>
          <button type="submit" className="rounded-md border border-border bg-white px-3 py-1.5 text-sm">Buscar</button>
        </form>
      }
    >
      <OverlaySection padded={false} testId="performance-matrix">
        <SupplierMaterialMatrixTable result={result} loading={loading} error={error} sort={sort} direction={direction} onSort={handleSort} onPage={setPage} onSelectSupplier={onSelectSupplier} onSelectMaterial={onSelectMaterial} />
      </OverlaySection>
      <p className="text-[11px] text-muted-foreground">Ordenações disponíveis: {SUPPLIER_MATERIAL_MATRIX_SORTS.map((s) => SORT_LABELS[s]).join(", ")}.</p>
    </DashboardSection>
  );
}
