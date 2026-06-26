import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Eye, Loader2, Plus, Search } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { InventoryWarehouseDetailSheet } from "@/src/components/inventory/InventoryWarehouseDetailSheet";
import {
  formatInventoryWarehouseStatus,
  SUGGESTED_INVENTORY_WAREHOUSES,
} from "@/src/components/inventory/inventoryWarehouseLabels";
import { normalizeInventoryWarehouseListResponse } from "@/src/components/inventory/inventoryWarehousePresentation";
import { useInventoryPermissions } from "@/src/components/inventory/inventoryPermissions";
import {
  formatInventoryApiError,
  InventoryEmptyState,
  inventoryTableClassName,
} from "@/src/components/inventory/inventoryUi";
import type { InventoryWarehouseRow } from "@/src/types/inventory";
import type { SuggestedInventoryWarehouse } from "@/src/components/inventory/inventoryWarehouseLabels";

type SheetState =
  | { mode: "closed" }
  | { mode: "create"; template?: SuggestedInventoryWarehouse }
  | { mode: "view"; warehouseId: string };

export function InventoryWarehousesTab() {
  const { canManage } = useInventoryPermissions();
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      q.set("page", String(page));
      q.set("pageSize", "50");
      if (search.trim()) q.set("search", search.trim());
      if (status) q.set("status", status);
      if (allowsMovements) q.set("allowsMovements", allowsMovements);

      const raw = await fetchJsonOk<unknown>(`/api/inventory/warehouses?${q.toString()}`);
      const data = normalizeInventoryWarehouseListResponse(raw);
      setRows(data.rows);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch (e: unknown) {
      setError(formatInventoryApiError(e, "Erro ao listar almoxarifados."));
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

  return (
    <div className="space-y-4" data-testid="inventory-warehouses-tab">
      <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-700">
        <p className="font-medium text-slate-900">Almoxarifados e locais</p>
        <p className="mt-1">
          Todo saldo de estoque está associado a um item e a um almoxarifado. Locais inativos ou
          bloqueados não aceitam novas movimentações, mas o histórico permanece consultável.
        </p>
      </div>

      <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Modelos sugeridos (não criados automaticamente)
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {SUGGESTED_INVENTORY_WAREHOUSES.map((s) => (
            <button
              key={s.code}
              type="button"
              disabled={!canManage}
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

      {error ? (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
          <input
            className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-3 text-sm"
            placeholder="Buscar por código ou nome…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="inventory-warehouses-search"
          />
        </div>
        <select
          className="rounded-lg border border-slate-200 px-2 py-2 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          data-testid="inventory-warehouses-filter-status"
        >
          <option value="">Status</option>
          <option value="ACTIVE">Ativo</option>
          <option value="INACTIVE">Inativo</option>
        </select>
        <select
          className="rounded-lg border border-slate-200 px-2 py-2 text-sm"
          value={allowsMovements}
          onChange={(e) => setAllowsMovements(e.target.value as "" | "true" | "false")}
          data-testid="inventory-warehouses-filter-movements"
        >
          <option value="">Movimentações</option>
          <option value="true">Permite movimentações</option>
          <option value="false">Bloqueado</option>
        </select>
        <button
          type="button"
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
          onClick={clearFilters}
        >
          Limpar
        </button>
        {canManage ? (
          <button
            type="button"
            onClick={() => setSheet({ mode: "create" })}
            className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-sm text-white"
            data-testid="inventory-warehouses-new"
          >
            <Plus className="h-4 w-4" />
            Novo almoxarifado
          </button>
        ) : null}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2
            className="h-8 w-8 animate-spin text-slate-400"
            data-testid="inventory-warehouses-loading"
          />
        </div>
      ) : rows.length === 0 ? (
        <InventoryEmptyState message="Nenhum almoxarifado encontrado com os filtros atuais." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className={inventoryTableClassName()} data-testid="inventory-warehouses-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Nome</th>
                <th>Status</th>
                <th>Movimentações</th>
                <th className="w-16"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="font-medium text-slate-900">{row.code}</td>
                  <td>{row.name}</td>
                  <td>
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                        row.status === "ACTIVE"
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-slate-200 text-slate-700"
                      )}
                    >
                      {formatInventoryWarehouseStatus(row.status)}
                    </span>
                  </td>
                  <td>
                    {row.allowsMovements ? (
                      <span className="text-emerald-700">Permitidas</span>
                    ) : (
                      <span className="text-amber-700">Bloqueadas</span>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      title="Abrir almoxarifado"
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
        </div>
      )}

      {sheet.mode === "create" ? (
        <InventoryWarehouseDetailSheet
          warehouseId={null}
          mode="create"
          template={sheet.template}
          onClose={() => setSheet({ mode: "closed" })}
          onSaved={() => void load()}
          canManage={canManage}
        />
      ) : null}

      {sheet.mode === "view" ? (
        <InventoryWarehouseDetailSheet
          warehouseId={sheet.warehouseId}
          mode="view"
          onClose={() => setSheet({ mode: "closed" })}
          onSaved={() => void load()}
          canManage={canManage}
        />
      ) : null}
    </div>
  );
}
