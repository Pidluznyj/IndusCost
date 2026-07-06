import React, { useCallback, useEffect, useState } from "react";
import { Eye, Loader2, Plus } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { safeTrim } from "@/src/lib/safeTrim.js";
import { cn } from "@/src/lib/utils";
import { InventoryCountDetailSheet } from "@/src/components/inventory/InventoryCountDetailSheet";
import {
  formatInventoryCountStatus,
  INVENTORY_COUNT_STATUS_OPTIONS,
  INVENTORY_COUNT_STATUS_STYLES,
} from "@/src/components/inventory/inventoryCountLabels";
import { normalizeInventoryCountListResponse } from "@/src/components/inventory/inventoryCountPresentation";
import { INVENTORY_EMPTY } from "@/src/components/inventory/inventoryEmptyStates";
import { hasAnyFilter } from "@/src/components/inventory/inventoryFilterUtils";
import { useInventoryPermissions } from "@/src/components/inventory/inventoryPermissions";
import {
  formatInventoryApiError,
  formatInventoryDateTime,
  formatInventoryQuantity,
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
import type {
  InventoryCountSessionRow,
  InventoryCountSessionStatus,
  InventoryWarehouseRow,
} from "@/src/types/inventory";

type SheetState = { mode: "closed" } | { mode: "detail"; sessionId: string };

function CountStatusBadge({ status }: { status: InventoryCountSessionStatus }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        INVENTORY_COUNT_STATUS_STYLES[status] ?? "bg-slate-50 text-slate-700 ring-slate-200"
      )}
    >
      {formatInventoryCountStatus(status)}
    </span>
  );
}

export function InventoryCountsTab() {
  const { canManageCounts } = useInventoryPermissions();
  const [rows, setRows] = useState<InventoryCountSessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [warehouses, setWarehouses] = useState<InventoryWarehouseRow[]>([]);
  const [sheet, setSheet] = useState<SheetState>({ mode: "closed" });
  const [creating, setCreating] = useState(false);
  const [createWarehouseId, setCreateWarehouseId] = useState("");
  const [createNotes, setCreateNotes] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const filtersActive = hasAnyFilter([status, warehouseId]);
  const filterActiveCount = [status, warehouseId].filter((v) => hasAnyFilter([v])).length;

  useEffect(() => {
    void (async () => {
      try {
        const whRes = await fetchJsonOk<{ rows?: InventoryWarehouseRow[] }>(
          "/api/inventory/warehouses?pageSize=200&status=ACTIVE"
        );
        setWarehouses(Array.isArray(whRes.rows) ? whRes.rows : []);
      } catch {
        setWarehouses([]);
      }
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      q.set("page", String(page));
      q.set("pageSize", "50");
      if (status) q.set("status", status);
      if (warehouseId) q.set("warehouseId", warehouseId);

      const raw = await fetchJsonOk<unknown>(`/api/inventory/count-sessions?${q.toString()}`);
      const data = normalizeInventoryCountListResponse(raw);
      setRows(data.rows);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch (e: unknown) {
      setError(formatInventoryApiError(e, "Não foi possível carregar as conferências. Tente novamente."));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [page, status, warehouseId]);

  useEffect(() => {
    setPage(1);
  }, [status, warehouseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const clearFilters = () => {
    setStatus("");
    setWarehouseId("");
  };

  const createSession = async () => {
    if (!createWarehouseId) {
      setError("Selecione um almoxarifado para iniciar a conferência.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await fetchJsonOk<{ session?: { id?: string } }>("/api/inventory/count-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          warehouseId: createWarehouseId,
          notes: safeTrim(createNotes) || null,
        }),
      });
      setShowCreate(false);
      setCreateNotes("");
      await load();
      if (res.session?.id) {
        setSheet({ mode: "detail", sessionId: res.session.id });
      }
    } catch (e: unknown) {
      setError(formatInventoryApiError(e, "Não foi possível criar a conferência. Verifique os dados e tente novamente."));
    } finally {
      setCreating(false);
    }
  };

  const emptyState = filtersActive ? INVENTORY_EMPTY.noCountsForFilter : INVENTORY_EMPTY.noCountsOpen;

  return (
    <div className="space-y-4" data-testid="inventory-counts-tab">
      <InventorySectionIntro
        title="Conferência física / inventário"
        description="Abra uma conferência, informe saldos contados, justifique divergências e gere ajustes rastreáveis por movimentação — o saldo do sistema nunca é alterado diretamente."
      />

      {error ? <InventoryErrorBanner message={error} onDismiss={() => setError(null)} /> : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {canManageCounts ? (
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
            data-testid="inventory-count-create-btn"
          >
            <Plus className="h-4 w-4" />
            Nova conferência
          </button>
        ) : null}
      </div>

      <InventoryCollapsibleFilters
        activeCount={filterActiveCount}
        onClear={filtersActive ? clearFilters : undefined}
      >
        <InventoryFilterField label="Status">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className={inventoryFilterInputClass}
          >
            <option value="">Todos</option>
            {INVENTORY_COUNT_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </InventoryFilterField>
        <InventoryFilterField label="Almoxarifado" className="min-w-[180px]">
          <select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            className={inventoryFilterInputClass}
          >
            <option value="">Todos</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} — {w.name}
              </option>
            ))}
          </select>
        </InventoryFilterField>
      </InventoryCollapsibleFilters>

      {showCreate && canManageCounts ? (
        <div
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          data-testid="inventory-count-create-form"
        >
          <p className="mb-3 text-sm font-medium text-slate-900">Criar conferência</p>
          <div className="flex flex-wrap gap-3">
            <InventoryFilterField label="Almoxarifado *" className="min-w-[220px]">
              <select
                value={createWarehouseId}
                onChange={(e) => setCreateWarehouseId(e.target.value)}
                className={inventoryFilterInputClass}
              >
                <option value="">Selecione…</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} — {w.name}
                  </option>
                ))}
              </select>
            </InventoryFilterField>
            <InventoryFilterField label="Observação" className="min-w-[200px] flex-1">
              <input
                type="text"
                value={createNotes}
                onChange={(e) => setCreateNotes(e.target.value)}
                className={cn(inventoryFilterInputClass, "w-full")}
                placeholder="Opcional"
              />
            </InventoryFilterField>
            <div className="flex items-end gap-2">
              <button
                type="button"
                disabled={creating}
                onClick={() => void createSession()}
                className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Criar"}
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {loading ? (
        <InventoryLoading label="Carregando conferências…" />
      ) : rows.length === 0 ? (
        <InventoryEmptyState
          title={emptyState.title}
          description={emptyState.description}
          actionLabel={filtersActive ? emptyState.actionLabel : emptyState.actionLabel}
          onAction={
            filtersActive
              ? clearFilters
              : canManageCounts
                ? () => setShowCreate(true)
                : undefined
          }
        />
      ) : (
        <>
          <InventoryTableScroll>
            <table className={inventoryTableClassName()} data-testid="inventory-counts-table">
              <thead>
                <tr>
                  <th scope="col">Código</th>
                  <th scope="col">Almoxarifado</th>
                  <th scope="col">Status</th>
                  <th scope="col">Responsável</th>
                  <th scope="col">Data</th>
                  <th scope="col" className="text-right">
                    Divergências
                  </th>
                  <th scope="col" className="text-right">
                    Qtd. impactada
                  </th>
                  <th scope="col">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="font-medium text-slate-900">{row.code}</td>
                    <td>
                      {row.warehouseCode ?? "—"}
                      {row.warehouseName ? (
                        <span className="block text-xs text-slate-500">{row.warehouseName}</span>
                      ) : null}
                    </td>
                    <td>
                      <CountStatusBadge status={row.status} />
                    </td>
                    <td className="text-xs text-slate-600">{row.responsibleUserId ?? "—"}</td>
                    <td>{formatInventoryDateTime(row.createdAt)}</td>
                    <td className="text-right tabular-nums">{row.divergenceCount}</td>
                    <td className="text-right tabular-nums">
                      {formatInventoryQuantity(row.impactedQuantity)}
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => setSheet({ mode: "detail", sessionId: row.id })}
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-sm text-blue-700 hover:bg-blue-50"
                      >
                        <Eye className="h-4 w-4" />
                        Detalhe
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </InventoryTableScroll>
          <div className="flex items-center justify-between text-sm text-slate-600">
            <span>
              {total} conferência{total !== 1 ? "s" : ""}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded border border-slate-200 px-2 py-1 disabled:opacity-50"
              >
                Anterior
              </button>
              <span>
                {page} / {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded border border-slate-200 px-2 py-1 disabled:opacity-50"
              >
                Próxima
              </button>
            </div>
          </div>
        </>
      )}

      {sheet.mode === "detail" ? (
        <InventoryCountDetailSheet
          sessionId={sheet.sessionId}
          open
          onClose={() => setSheet({ mode: "closed" })}
          onUpdated={() => void load()}
        />
      ) : null}
    </div>
  );
}
