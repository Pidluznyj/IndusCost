import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, Plus, Search } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { InventoryWarehouseDetailSheet } from "@/src/components/inventory/InventoryWarehouseDetailSheet";
import { INVENTORY_EMPTY } from "@/src/components/inventory/inventoryEmptyStates";
import { appendQueryIfPresent, hasAnyFilter } from "@/src/components/inventory/inventoryFilterUtils";
import {
  formatInventoryWarehouseStatus,
  SUGGESTED_INVENTORY_WAREHOUSES,
} from "@/src/components/inventory/inventoryWarehouseLabels";
import { normalizeInventoryWarehouseListResponse } from "@/src/components/inventory/inventoryWarehousePresentation";
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
import type { InventoryWarehouseRow } from "@/src/types/inventory";
import type { SuggestedInventoryWarehouse } from "@/src/components/inventory/inventoryWarehouseLabels";

type SheetState =
  | { mode: "closed" }
  | { mode: "create"; template?: SuggestedInventoryWarehouse }
  | { mode: "view"; warehouseId: string };

export function InventoryWarehousesTab() {
  const { canManageWarehouses } = useInventoryPermissions();
  const [rows, setRows] = useState<InventoryWarehouseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [allowsMovements, setAllowsMovements] = useState<"" | "true" | "false">("");

  const [sheet, setSheet] = useState<SheetState>({ mode: "closed" });

  const filterActiveCount = useMemo(
    () => [search, status, allowsMovements].filter((v) => hasAnyFilter([v])).length,
    [search, status, allowsMovements]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      q.set("page", String(page));
      q.set("pageSize", "50");
      appendQueryIfPresent(q, "search", search);
      if (status) q.set("status", status);
      if (allowsMovements) q.set("allowsMovements", allowsMovements);

      const raw = await fetchJsonOk<unknown>(`/api/inventory/warehouses?${q.toString()}`);
      const data = normalizeInventoryWarehouseListResponse(raw);
      setRows(data.rows);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch (e: unknown) {
      setError(formatInventoryApiError(e, "Não foi possível carregar os almoxarifados. Tente novamente."));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [page, search, status, allowsMovements]);

  useEffect(() => {
    setPage(1);
  }, [search, status, allowsMovements]);

  useEffect(() => {
    void load();
  }, [load]);

  const clearFilters = () => {
    setSearch("");
    setStatus("");
    setAllowsMovements("");
  };

  const filtersActive = hasAnyFilter([search, status, allowsMovements]);
  const emptyState = filtersActive
    ? INVENTORY_EMPTY.noWarehousesForFilter
    : INVENTORY_EMPTY.noWarehousesRegistered;

  return (
    <div className="space-y-4" data-testid="inventory-warehouses-tab">
      <InventorySectionIntro
        title="Almoxarifados e locais"
        description="Todo saldo de estoque está associado a um item e a um almoxarifado. Locais inativos ou bloqueados não aceitam novas movimentações, mas o histórico permanece consultável."
      />

      <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Modelos sugeridos (não criados automaticamente)
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {SUGGESTED_INVENTORY_WAREHOUSES.map((s) => (
            <button
              key={s.code}
              type="button"
              disabled={!canManageWarehouses}
              title={s.description}
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              onClick={() => setSheet({ mode: "create", template: s })}
              data-testid={`warehouse-suggestion-${s.code}`}
            >
              {s.code} — {s.name}
            </button>
          ))}
        </div>
      </div>

      {error ? <InventoryErrorBanner message={error} onDismiss={() => setError(null)} /> : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {canManageWarehouses ? (
          <button
            type="button"
            onClick={() => setSheet({ mode: "create" })}
            className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-sm text-white"
            data-testid="inventory-warehouses-new"
          >
            <Plus className="h-4 w-4" />
            Novo almoxarifado
          </button>
        ) : (
          <p className="text-xs text-slate-500" data-testid="inventory-warehouses-no-permission">
            Sem permissão para cadastrar almoxarifados.
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
              placeholder="Código ou nome…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="inventory-warehouses-search"
            />
          </div>
        </InventoryFilterField>
        <InventoryFilterField label="Status">
          <select
            className={inventoryFilterInputClass}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            data-testid="inventory-warehouses-filter-status"
          >
            <option value="">Todos</option>
            <option value="ACTIVE">Ativo</option>
            <option value="INACTIVE">Inativo</option>
          </select>
        </InventoryFilterField>
        <InventoryFilterField label="Movimentações">
          <select
            className={inventoryFilterInputClass}
            value={allowsMovements}
            onChange={(e) => setAllowsMovements(e.target.value as "" | "true" | "false")}
            data-testid="inventory-warehouses-filter-movements"
          >
            <option value="">Todas</option>
            <option value="true">Permite movimentações</option>
            <option value="false">Bloqueado</option>
          </select>
        </InventoryFilterField>
      </InventoryCollapsibleFilters>

      {loading ? (
        <InventoryLoading label="Carregando almoxarifados…" />
      ) : rows.length === 0 ? (
        <InventoryEmptyState
          title={emptyState.title}
          description={emptyState.description}
          actionLabel={emptyState.actionLabel}
          onAction={
            filtersActive
              ? clearFilters
              : canManageWarehouses
                ? () => setSheet({ mode: "create" })
                : undefined
          }
        />
      ) : (
        <InventoryTableScroll>
          <table className={inventoryTableClassName()} data-testid="inventory-warehouses-table">
            <thead>
              <tr>
                <th scope="col">Código</th>
                <th scope="col">Nome</th>
                <th scope="col">Status</th>
                <th scope="col">Movimentações</th>
                <th scope="col" className="w-16">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="font-medium text-slate-900">{row.code}</td>
                  <td title={row.name}>{row.name}</td>
                  <td>
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
                        row.status === "ACTIVE"
                          ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                          : "bg-slate-100 text-slate-700 ring-slate-200"
                      )}
                    >
                      {formatInventoryWarehouseStatus(row.status)}
                    </span>
                  </td>
                  <td>
                    {row.allowsMovements ? (
                      <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200 ring-inset">
                        Permitidas
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200 ring-inset">
                        Bloqueadas
                      </span>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      title="Abrir almoxarifado"
                      aria-label={`Abrir almoxarifado ${row.code}`}
                      className="rounded p-1 hover:bg-slate-200"
                      onClick={() => setSheet({ mode: "view", warehouseId: row.id })}
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
            <span>{total} almoxarifado(s)</span>
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
        <InventoryWarehouseDetailSheet
          warehouseId={null}
          mode="create"
          template={sheet.template}
          onClose={() => setSheet({ mode: "closed" })}
          onSaved={() => void load()}
          canManage={canManageWarehouses}
        />
      ) : null}

      {sheet.mode === "view" ? (
        <InventoryWarehouseDetailSheet
          warehouseId={sheet.warehouseId}
          mode="view"
          onClose={() => setSheet({ mode: "closed" })}
          onSaved={() => void load()}
          canManage={canManageWarehouses}
        />
      ) : null}
    </div>
  );
}
