import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, Plus, Search } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { InventoryItemDetailSheet } from "@/src/components/inventory/InventoryItemDetailSheet";
import { INVENTORY_EMPTY } from "@/src/components/inventory/inventoryEmptyStates";
import { appendQueryIfPresent, hasAnyFilter } from "@/src/components/inventory/inventoryFilterUtils";
import {
  formatInventoryItemStatus,
  formatInventoryItemType,
  INVENTORY_ITEM_TYPE_OPTIONS,
} from "@/src/components/inventory/inventoryItemLabels";
import { normalizeInventoryItemListResponse } from "@/src/components/inventory/inventoryItemPresentation";
import { useInventoryPermissions } from "@/src/components/inventory/inventoryPermissions";
import {
  formatInventoryApiError,
  InventoryCollapsibleFilters,
  InventoryEmptyState,
  InventoryErrorBanner,
  InventoryFilterField,
  InventoryLoading,
  InventorySectionIntro,
  InventoryTableScroll,
  inventoryFilterInputClass,
  inventoryTableClassName,
} from "@/src/components/inventory/inventoryUi";
import type { InventoryItemRow } from "@/src/types/inventory";

type SheetState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "view"; itemId: string };

export function InventoryItemsTab() {
  const { canManageItems } = useInventoryPermissions();
  const [rows, setRows] = useState<InventoryItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const [search, setSearch] = useState("");
  const [itemType, setItemType] = useState("");
  const [status, setStatus] = useState("");
  const [family, setFamily] = useState("");
  const [belowMinimum, setBelowMinimum] = useState(false);
  const [belowReorderPoint, setBelowReorderPoint] = useState(false);

  const [sheet, setSheet] = useState<SheetState>({ mode: "closed" });

  const filterActiveCount = useMemo(
    () =>
      [search, itemType, status, family, belowMinimum, belowReorderPoint].filter((v) =>
        typeof v === "boolean" ? v : hasAnyFilter([v])
      ).length,
    [search, itemType, status, family, belowMinimum, belowReorderPoint]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      q.set("page", String(page));
      q.set("pageSize", "50");
      appendQueryIfPresent(q, "search", search);
      if (itemType) q.set("itemType", itemType);
      if (status) q.set("status", status);
      appendQueryIfPresent(q, "family", family);
      if (belowMinimum) q.set("belowMinimum", "true");
      if (belowReorderPoint) q.set("belowReorderPoint", "true");

      const raw = await fetchJsonOk<unknown>(`/api/inventory/items?${q.toString()}`);
      const data = normalizeInventoryItemListResponse(raw);
      setRows(data.rows);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch (e: unknown) {
      setError(formatInventoryApiError(e, "Não foi possível carregar os itens. Tente novamente em instantes."));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [page, search, itemType, status, family, belowMinimum, belowReorderPoint]);

  useEffect(() => {
    setPage(1);
  }, [search, itemType, status, family, belowMinimum, belowReorderPoint]);

  useEffect(() => {
    void load();
  }, [load]);

  const clearFilters = () => {
    setSearch("");
    setItemType("");
    setStatus("");
    setFamily("");
    setBelowMinimum(false);
    setBelowReorderPoint(false);
  };

  const filtersActive = hasAnyFilter([search, itemType, status, family, belowMinimum, belowReorderPoint]);
  const emptyState = filtersActive ? INVENTORY_EMPTY.noItemsForFilter : INVENTORY_EMPTY.noItemsRegistered;

  return (
    <div className="space-y-4" data-testid="inventory-items-tab">
      <InventorySectionIntro
        title="Cadastro de itens"
        description="Consulte, cadastre e inative itens de estoque. Alterações de quantidade devem ser feitas via movimentações — o saldo não é editável nesta tela."
      />

      {error ? <InventoryErrorBanner message={error} onDismiss={() => setError(null)} /> : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {canManageItems ? (
          <button
            type="button"
            onClick={() => setSheet({ mode: "create" })}
            className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-sm text-white"
            data-testid="inventory-items-new"
          >
            <Plus className="h-4 w-4" />
            Novo item
          </button>
        ) : (
          <p className="text-xs text-slate-500" data-testid="inventory-items-no-permission">
            Sem permissão para cadastrar itens.
          </p>
        )}
      </div>

      <InventoryCollapsibleFilters
        activeCount={filterActiveCount}
        onClear={filtersActive ? clearFilters : undefined}
      >
        <InventoryFilterField label="Busca" className="min-w-[200px] flex-1">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
            <input
              className={cn(inventoryFilterInputClass, "w-full pl-8")}
              placeholder="Código ou descrição…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="inventory-items-search"
            />
          </div>
        </InventoryFilterField>
        <InventoryFilterField label="Tipo">
          <select
            className={inventoryFilterInputClass}
            value={itemType}
            onChange={(e) => setItemType(e.target.value)}
            data-testid="inventory-items-filter-type"
          >
            <option value="">Todos</option>
            {INVENTORY_ITEM_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </InventoryFilterField>
        <InventoryFilterField label="Status">
          <select
            className={inventoryFilterInputClass}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            data-testid="inventory-items-filter-status"
          >
            <option value="">Todos</option>
            <option value="ACTIVE">Ativo</option>
            <option value="INACTIVE">Inativo</option>
          </select>
        </InventoryFilterField>
        <InventoryFilterField label="Família">
          <input
            className={cn(inventoryFilterInputClass, "w-36")}
            placeholder="Família"
            value={family}
            onChange={(e) => setFamily(e.target.value)}
            data-testid="inventory-items-filter-family"
          />
        </InventoryFilterField>
        <label className="inline-flex items-center gap-1.5 self-end pb-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={belowMinimum}
            onChange={(e) => setBelowMinimum(e.target.checked)}
            data-testid="inventory-items-filter-below-minimum"
          />
          Abaixo do mínimo
        </label>
        <label className="inline-flex items-center gap-1.5 self-end pb-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={belowReorderPoint}
            onChange={(e) => setBelowReorderPoint(e.target.checked)}
            data-testid="inventory-items-filter-below-reorder"
          />
          Abaixo reposição
        </label>
      </InventoryCollapsibleFilters>

      {loading ? (
        <InventoryLoading label="Carregando itens…" />
      ) : rows.length === 0 ? (
        <InventoryEmptyState
          title={emptyState.title}
          description={emptyState.description}
          actionLabel={emptyState.actionLabel}
          onAction={
            filtersActive
              ? clearFilters
              : canManageItems
                ? () => setSheet({ mode: "create" })
                : undefined
          }
        />
      ) : (
        <InventoryTableScroll>
          <table className={inventoryTableClassName()} data-testid="inventory-items-table">
            <thead>
              <tr>
                <th scope="col">Código</th>
                <th scope="col">Descrição</th>
                <th scope="col">Tipo</th>
                <th scope="col">Unidade</th>
                <th scope="col">Família</th>
                <th scope="col">Status</th>
                <th scope="col" className="w-16">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="font-medium text-slate-900">{row.code}</td>
                  <td title={row.description}>{row.description}</td>
                  <td>{formatInventoryItemType(row.itemType)}</td>
                  <td>{row.unit}</td>
                  <td>{row.family ?? "—"}</td>
                  <td>
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
                        row.status === "ACTIVE"
                          ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                          : "bg-slate-100 text-slate-700 ring-slate-200"
                      )}
                    >
                      {formatInventoryItemStatus(row.status)}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      title="Abrir item"
                      aria-label={`Abrir item ${row.code}`}
                      className="rounded p-1 hover:bg-slate-200"
                      onClick={() => setSheet({ mode: "view", itemId: row.id })}
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
            <span>{total} item(ns)</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1 || loading}
                className="rounded border px-2 py-1 disabled:opacity-50"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Anterior
              </button>
              <span>
                {page} / {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages || loading}
                className="rounded border px-2 py-1 disabled:opacity-50"
                onClick={() => setPage((p) => p + 1)}
              >
                Próxima
              </button>
            </div>
          </div>
        </InventoryTableScroll>
      )}

      {sheet.mode === "create" ? (
        <InventoryItemDetailSheet
          itemId={null}
          mode="create"
          onClose={() => setSheet({ mode: "closed" })}
          onSaved={() => void load()}
          canManage={canManageItems}
        />
      ) : null}

      {sheet.mode === "view" ? (
        <InventoryItemDetailSheet
          itemId={sheet.itemId}
          mode="view"
          onClose={() => setSheet({ mode: "closed" })}
          onSaved={() => void load()}
          canManage={canManageItems}
        />
      ) : null}
    </div>
  );
}
