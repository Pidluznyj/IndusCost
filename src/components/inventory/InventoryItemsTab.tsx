import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Eye, Loader2, Plus, Search } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { InventoryItemDetailSheet } from "@/src/components/inventory/InventoryItemDetailSheet";
import {
  formatInventoryItemStatus,
  formatInventoryItemType,
  INVENTORY_ITEM_TYPE_OPTIONS,
} from "@/src/components/inventory/inventoryItemLabels";
import { normalizeInventoryItemListResponse } from "@/src/components/inventory/inventoryItemPresentation";
import { useInventoryPermissions } from "@/src/components/inventory/inventoryPermissions";
import {
  formatInventoryApiError,
  InventoryEmptyState,
  inventoryTableClassName,
} from "@/src/components/inventory/inventoryUi";
import type { InventoryItemRow } from "@/src/types/inventory";

type SheetState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "view"; itemId: string };

export function InventoryItemsTab() {
  const { canManage } = useInventoryPermissions();
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      q.set("page", String(page));
      q.set("pageSize", "50");
      if (search.trim()) q.set("search", search.trim());
      if (itemType) q.set("itemType", itemType);
      if (status) q.set("status", status);
      if (family.trim()) q.set("family", family.trim());
      if (belowMinimum) q.set("belowMinimum", "true");
      if (belowReorderPoint) q.set("belowReorderPoint", "true");

      const raw = await fetchJsonOk<unknown>(`/api/inventory/items?${q.toString()}`);
      const data = normalizeInventoryItemListResponse(raw);
      setRows(data.rows);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch (e: unknown) {
      setError(formatInventoryApiError(e, "Erro ao listar itens de estoque."));
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

  return (
    <div className="space-y-4" data-testid="inventory-items-tab">
      <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-700">
        <p className="font-medium text-slate-900">Cadastro de itens</p>
        <p className="mt-1">
          Consulte, cadastre e inative itens de estoque. Alterações de quantidade devem ser feitas
          via movimentações — o saldo não é editável nesta tela.
        </p>
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
            placeholder="Buscar por código ou descrição…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="inventory-items-search"
          />
        </div>
        <select
          className="rounded-lg border border-slate-200 px-2 py-2 text-sm"
          value={itemType}
          onChange={(e) => setItemType(e.target.value)}
          data-testid="inventory-items-filter-type"
        >
          <option value="">Tipo</option>
          {INVENTORY_ITEM_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          className="rounded-lg border border-slate-200 px-2 py-2 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          data-testid="inventory-items-filter-status"
        >
          <option value="">Status</option>
          <option value="ACTIVE">Ativo</option>
          <option value="INACTIVE">Inativo</option>
        </select>
        <input
          className="w-36 rounded-lg border border-slate-200 px-2 py-2 text-sm"
          placeholder="Família"
          value={family}
          onChange={(e) => setFamily(e.target.value)}
          data-testid="inventory-items-filter-family"
        />
        <label className="inline-flex items-center gap-1.5 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={belowMinimum}
            onChange={(e) => setBelowMinimum(e.target.checked)}
            data-testid="inventory-items-filter-below-minimum"
          />
          Abaixo do mínimo
        </label>
        <label className="inline-flex items-center gap-1.5 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={belowReorderPoint}
            onChange={(e) => setBelowReorderPoint(e.target.checked)}
            data-testid="inventory-items-filter-below-reorder"
          />
          Abaixo reposição
        </label>
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
            data-testid="inventory-items-new"
          >
            <Plus className="h-4 w-4" />
            Novo item
          </button>
        ) : null}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" data-testid="inventory-items-loading" />
        </div>
      ) : rows.length === 0 ? (
        <InventoryEmptyState message="Nenhum item encontrado com os filtros atuais." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className={inventoryTableClassName()} data-testid="inventory-items-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Descrição</th>
                <th>Tipo</th>
                <th>Unidade</th>
                <th>Família</th>
                <th>Status</th>
                <th className="w-16"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="font-medium text-slate-900">{row.code}</td>
                  <td>{row.description}</td>
                  <td>{formatInventoryItemType(row.itemType)}</td>
                  <td>{row.unit}</td>
                  <td>{row.family ?? "—"}</td>
                  <td>
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                        row.status === "ACTIVE"
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-slate-200 text-slate-700"
                      )}
                    >
                      {formatInventoryItemStatus(row.status)}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      title="Abrir item"
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
        </div>
      )}

      {sheet.mode === "create" ? (
        <InventoryItemDetailSheet
          itemId={null}
          mode="create"
          onClose={() => setSheet({ mode: "closed" })}
          onSaved={() => void load()}
          canManage={canManage}
        />
      ) : null}

      {sheet.mode === "view" ? (
        <InventoryItemDetailSheet
          itemId={sheet.itemId}
          mode="view"
          onClose={() => setSheet({ mode: "closed" })}
          onSaved={() => void load()}
          canManage={canManage}
        />
      ) : null}
    </div>
  );
}
