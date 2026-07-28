import React, { useCallback, useEffect, useMemo, useState } from "react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
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
import type { InventoryItemRow, InventoryWarehouseRow } from "@/src/types/inventory";

type ReservationRow = {
  id: string;
  itemId: string;
  warehouseId: string;
  quantity: number;
  reservationType: string;
  status: string;
  reason: string;
  originType: string;
  originId: string | null;
  responsibleUserId: string | null;
  expiresAt: string | null;
  createdAt: string;
  notes: string | null;
  itemCode: string | null;
  itemDescription: string | null;
  itemUnit: string | null;
  warehouseCode: string | null;
  warehouseName: string | null;
};

type BlockRow = {
  id: string;
  itemId: string;
  warehouseId: string;
  quantity: number;
  reasonType: string;
  status: string;
  reason: string;
  createdAt: string;
  itemCode: string | null;
  itemDescription: string | null;
  itemUnit: string | null;
  warehouseCode: string | null;
  warehouseName: string | null;
};

type Section = "reservations" | "blocks";

export function InventoryReservationsTab() {
  const { canManageReservations, canBlock } = useInventoryPermissions();
  const [section, setSection] = useState<Section>("reservations");
  const [reservations, setReservations] = useState<ReservationRow[]>([]);
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("ACTIVE");
  const [itemId, setItemId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [items, setItems] = useState<InventoryItemRow[]>([]);
  const [warehouses, setWarehouses] = useState<InventoryWarehouseRow[]>([]);
  const [actionId, setActionId] = useState<string | null>(null);
  const [actionReason, setActionReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const filtersActive = hasAnyFilter([status, itemId, warehouseId]);
  const filterActiveCount = [status, itemId, warehouseId].filter((v) => hasAnyFilter([v])).length;

  useEffect(() => {
    void (async () => {
      try {
        const [itemsRes, whRes] = await Promise.all([
          fetchJsonOk<{ rows?: InventoryItemRow[] }>("/api/inventory/items?pageSize=200"),
          fetchJsonOk<{ rows?: InventoryWarehouseRow[] }>("/api/inventory/warehouses?pageSize=200"),
        ]);
        setItems(Array.isArray(itemsRes.rows) ? itemsRes.rows : []);
        setWarehouses(Array.isArray(whRes.rows) ? whRes.rows : []);
      } catch {
        setItems([]);
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
      if (itemId) q.set("itemId", itemId);
      if (warehouseId) q.set("warehouseId", warehouseId);

      if (section === "reservations") {
        const raw = await fetchJsonOk<{
          rows?: ReservationRow[];
          total?: number;
          totalPages?: number;
        }>(`/api/inventory/reservations?${q.toString()}`);
        setReservations(Array.isArray(raw.rows) ? raw.rows : []);
        setBlocks([]);
        setTotal(Number(raw.total) || 0);
        setTotalPages(Math.max(1, Number(raw.totalPages) || 1));
      } else {
        const raw = await fetchJsonOk<{
          rows?: BlockRow[];
          total?: number;
          totalPages?: number;
        }>(`/api/inventory/blocks?${q.toString()}`);
        setBlocks(Array.isArray(raw.rows) ? raw.rows : []);
        setReservations([]);
        setTotal(Number(raw.total) || 0);
        setTotalPages(Math.max(1, Number(raw.totalPages) || 1));
      }
    } catch (e: unknown) {
      setError(
        formatInventoryApiError(
          e,
          section === "reservations"
            ? "Não foi possível carregar as reservas."
            : "Não foi possível carregar os bloqueios."
        )
      );
      setReservations([]);
      setBlocks([]);
    } finally {
      setLoading(false);
    }
  }, [page, status, itemId, warehouseId, section]);

  useEffect(() => {
    setPage(1);
    setStatus("ACTIVE");
  }, [section]);

  useEffect(() => {
    setPage(1);
  }, [status, itemId, warehouseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const clearFilters = () => {
    setStatus("ACTIVE");
    setItemId("");
    setWarehouseId("");
  };

  const empty =
    section === "reservations" ? INVENTORY_EMPTY.noReservationsActive : INVENTORY_EMPTY.noBlocksActive;

  const submitAction = async () => {
    if (!actionId || !actionReason.trim()) {
      setActionError("Informe o motivo.");
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const path =
        section === "reservations"
          ? `/api/inventory/reservations/${actionId}/cancel`
          : `/api/inventory/blocks/${actionId}/release`;
      await fetchJsonOk(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: actionReason.trim() }),
      });
      setActionId(null);
      setActionReason("");
      await load();
    } catch (e: unknown) {
      setActionError(
        formatInventoryApiError(
          e,
          section === "reservations" ? "Erro ao cancelar reserva." : "Erro ao liberar bloqueio."
        )
      );
    } finally {
      setSaving(false);
    }
  };

  const canAct = section === "reservations" ? canManageReservations : canBlock;

  const statusBadge = useMemo(
    () => (s: string) =>
      cn(
        "inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold",
        s === "ACTIVE" ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600"
      ),
    []
  );

  return (
    <div className="space-y-4" data-testid="inventory-reservations-tab">
      <InventorySectionIntro
        title="Reservas e bloqueios"
        description="Consulte reservas ativas, cancelamentos autorizados e bloqueios. Liberação e cancelamento exigem motivo e permissão."
      />

      {error ? (
        <InventoryErrorBanner
          message={error}
          onDismiss={() => setError(null)}
          testId="inventory-reservations-error"
        />
      ) : null}

      <div className="flex flex-wrap gap-2" data-testid="inventory-reservations-section-toggle">
        <button
          type="button"
          onClick={() => setSection("reservations")}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium",
            section === "reservations" ? "bg-slate-900 text-white" : "border border-slate-200 text-slate-700"
          )}
        >
          Reservas
        </button>
        <button
          type="button"
          onClick={() => setSection("blocks")}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium",
            section === "blocks" ? "bg-slate-900 text-white" : "border border-slate-200 text-slate-700"
          )}
        >
          Bloqueios
        </button>
      </div>

      <InventoryCollapsibleFilters
        activeCount={filterActiveCount}
        onClear={clearFilters}
        testId="inventory-reservations-filters"
      >
        <InventoryFilterField label="Status">
          <select
            className={inventoryFilterInputClass}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            data-testid="inventory-reservations-filter-status"
          >
            <option value="">Todos</option>
            <option value="ACTIVE">Ativo</option>
            {section === "reservations" ? (
              <>
                <option value="CANCELED">Cancelado</option>
                <option value="CONSUMED">Consumido</option>
              </>
            ) : (
              <option value="RELEASED">Liberado</option>
            )}
          </select>
        </InventoryFilterField>
        <InventoryFilterField label="Item">
          <select
            className={inventoryFilterInputClass}
            value={itemId}
            onChange={(e) => setItemId(e.target.value)}
          >
            <option value="">Todos</option>
            {items.map((it) => (
              <option key={it.id} value={it.id}>
                {it.code} — {it.description}
              </option>
            ))}
          </select>
        </InventoryFilterField>
        <InventoryFilterField label="Almoxarifado">
          <select
            className={inventoryFilterInputClass}
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
          >
            <option value="">Todos</option>
            {warehouses.map((wh) => (
              <option key={wh.id} value={wh.id}>
                {wh.code} — {wh.name}
              </option>
            ))}
          </select>
        </InventoryFilterField>
      </InventoryCollapsibleFilters>

      {loading ? (
        <InventoryLoading label="Carregando…" />
      ) : (section === "reservations" ? reservations : blocks).length === 0 ? (
        <InventoryEmptyState
          title={empty.title}
          description={empty.description}
          actionLabel={filtersActive ? "Limpar filtros" : undefined}
          onAction={filtersActive ? clearFilters : undefined}
        />
      ) : section === "reservations" ? (
        <InventoryTableScroll>
          <table className={inventoryTableClassName()} data-testid="inventory-reservations-table">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Almoxarifado</th>
                <th scope="col">Qtd</th>
                <th scope="col">Tipo</th>
                <th scope="col">Status</th>
                <th scope="col">Criada em</th>
                <th scope="col">Expira</th>
                <th scope="col">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {reservations.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="font-medium">{row.itemCode ?? "—"}</div>
                    <div className="text-xs text-slate-500">{row.itemDescription}</div>
                  </td>
                  <td className="text-xs">
                    {row.warehouseCode}
                    {row.warehouseName ? ` — ${row.warehouseName}` : ""}
                  </td>
                  <td className="tabular-nums">
                    {formatInventoryQuantity(row.quantity, row.itemUnit ?? undefined)}
                  </td>
                  <td className="text-xs">{row.reservationType}</td>
                  <td>
                    <span className={statusBadge(row.status)}>{row.status}</span>
                  </td>
                  <td className="whitespace-nowrap text-xs">{formatInventoryDateTime(row.createdAt)}</td>
                  <td className="whitespace-nowrap text-xs">
                    {row.expiresAt ? formatInventoryDateTime(row.expiresAt) : "—"}
                  </td>
                  <td>
                    {row.status === "ACTIVE" && canAct ? (
                      <button
                        type="button"
                        className="rounded-md px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50"
                        onClick={() => {
                          setActionId(row.id);
                          setActionReason("");
                          setActionError(null);
                        }}
                        data-testid={`inventory-reservation-cancel-${row.id}`}
                      >
                        Cancelar
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </InventoryTableScroll>
      ) : (
        <InventoryTableScroll>
          <table className={inventoryTableClassName()} data-testid="inventory-blocks-table">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Almoxarifado</th>
                <th scope="col">Qtd</th>
                <th scope="col">Motivo</th>
                <th scope="col">Status</th>
                <th scope="col">Criado em</th>
                <th scope="col">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {blocks.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="font-medium">{row.itemCode ?? "—"}</div>
                    <div className="text-xs text-slate-500">{row.itemDescription}</div>
                  </td>
                  <td className="text-xs">
                    {row.warehouseCode}
                    {row.warehouseName ? ` — ${row.warehouseName}` : ""}
                  </td>
                  <td className="tabular-nums">
                    {formatInventoryQuantity(row.quantity, row.itemUnit ?? undefined)}
                  </td>
                  <td className="text-xs" title={row.reason}>
                    {row.reasonType}
                  </td>
                  <td>
                    <span className={statusBadge(row.status)}>{row.status}</span>
                  </td>
                  <td className="whitespace-nowrap text-xs">{formatInventoryDateTime(row.createdAt)}</td>
                  <td>
                    {row.status === "ACTIVE" && canAct ? (
                      <button
                        type="button"
                        className="rounded-md px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50"
                        onClick={() => {
                          setActionId(row.id);
                          setActionReason("");
                          setActionError(null);
                        }}
                        data-testid={`inventory-block-release-${row.id}`}
                      >
                        Liberar
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </InventoryTableScroll>
      )}

      {totalPages > 1 || total > 0 ? (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>
            {total} registro(s) — página {page} de {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className={cn("rounded-md border px-3 py-1", page <= 1 ? "opacity-50" : "hover:bg-slate-50")}
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className={cn(
                "rounded-md border px-3 py-1",
                page >= totalPages ? "opacity-50" : "hover:bg-slate-50"
              )}
            >
              Próxima
            </button>
          </div>
        </div>
      ) : null}

      {actionId ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          data-testid="inventory-reservation-action-dialog"
        >
          <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900">
              {section === "reservations" ? "Cancelar reserva" : "Liberar bloqueio"}
            </h3>
            <p className="mt-1 text-sm text-slate-600">Informe o motivo autorizado para registrar no ledger.</p>
            <textarea
              className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              rows={3}
              value={actionReason}
              onChange={(e) => setActionReason(e.target.value)}
              data-testid="inventory-reservation-action-reason"
            />
            {actionError ? (
              <p className="mt-2 text-sm text-red-700" role="alert">
                {actionError}
              </p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                onClick={() => setActionId(null)}
                disabled={saving}
              >
                Fechar
              </button>
              <button
                type="button"
                className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                onClick={() => void submitAction()}
                disabled={saving}
                data-testid="inventory-reservation-action-confirm"
              >
                {saving ? "Confirmando…" : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
