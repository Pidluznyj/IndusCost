import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Eye, Loader2, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { InventoryMovementFormSheet } from "@/src/components/inventory/InventoryMovementFormSheet";
import {
  INVENTORY_FORM_MOVEMENT_TYPES,
  INVENTORY_ORIGIN_TYPE_OPTIONS,
} from "@/src/components/inventory/inventoryMovementLabels";
import { normalizeInventoryMovementListResponse } from "@/src/components/inventory/inventoryMovementPresentation";
import { useInventoryPermissions } from "@/src/components/inventory/inventoryPermissions";
import {
  formatInventoryApiError,
  formatInventoryDateTime,
  formatInventoryMovementType,
  formatInventoryQuantity,
  InventoryEmptyState,
  inventoryTableClassName,
} from "@/src/components/inventory/inventoryUi";
import type { InventoryItemRow, InventoryMovementRow, InventoryWarehouseRow } from "@/src/types/inventory";

type SheetState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "view"; movementId: string };

export function InventoryMovementsTab() {
  const { canCreateMovement } = useInventoryPermissions();
  const [rows, setRows] = useState<InventoryMovementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const [itemId, setItemId] = useState("");
  const [movementType, setMovementType] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [responsibleUserId, setResponsibleUserId] = useState("");
  const [originType, setOriginType] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [costCenterId, setCostCenterId] = useState("");

  const [items, setItems] = useState<InventoryItemRow[]>([]);
  const [warehouses, setWarehouses] = useState<InventoryWarehouseRow[]>([]);
  const [sheet, setSheet] = useState<SheetState>({ mode: "closed" });

  useEffect(() => {
    void (async () => {
      try {
        const [itemsRes, whRes] = await Promise.all([
          fetchJsonOk<{ rows?: InventoryItemRow[] }>("/api/inventory/items?pageSize=200&status=ACTIVE"),
          fetchJsonOk<{ rows?: InventoryWarehouseRow[] }>(
            "/api/inventory/warehouses?pageSize=200&status=ACTIVE"
          ),
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
      if (itemId) q.set("itemId", itemId);
      if (movementType) q.set("movementType", movementType);
      if (warehouseId) q.set("warehouseId", warehouseId);
      if (startDate) q.set("startDate", startDate);
      if (endDate) q.set("endDate", endDate);
      if (responsibleUserId.trim()) q.set("responsibleUserId", responsibleUserId.trim());
      if (originType) q.set("originType", originType);
      if (documentNumber.trim()) q.set("documentNumber", documentNumber.trim());
      if (costCenterId.trim()) q.set("costCenterId", costCenterId.trim());

      const raw = await fetchJsonOk<unknown>(`/api/inventory/movements?${q.toString()}`);
      const data = normalizeInventoryMovementListResponse(raw);
      setRows(data.rows);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch (e: unknown) {
      setError(formatInventoryApiError(e, "Erro ao listar movimentações."));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [
    page,
    itemId,
    movementType,
    warehouseId,
    startDate,
    endDate,
    responsibleUserId,
    originType,
    documentNumber,
    costCenterId,
  ]);

  useEffect(() => {
    setPage(1);
  }, [
    itemId,
    movementType,
    warehouseId,
    startDate,
    endDate,
    responsibleUserId,
    originType,
    documentNumber,
    costCenterId,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  const clearFilters = () => {
    setItemId("");
    setMovementType("");
    setWarehouseId("");
    setStartDate("");
    setEndDate("");
    setResponsibleUserId("");
    setOriginType("");
    setDocumentNumber("");
    setCostCenterId("");
  };

  return (
    <div className="space-y-4" data-testid="inventory-movements-tab">
      <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-700">
        <p className="font-medium text-slate-900">Movimentações de estoque</p>
        <p className="mt-1">
          Registre entradas, saídas, transferências, ajustes, bloqueios e reservas. O saldo nunca é
          editado diretamente — toda alteração gera uma movimentação rastreável via{" "}
          <code className="rounded bg-slate-200/80 px-1 text-xs">POST /api/inventory/movements</code>.
        </p>
      </div>

      {error ? (
        <div
          className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          data-testid="inventory-movements-error"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <select
          className="min-w-[160px] rounded-lg border border-slate-200 px-2 py-2 text-sm"
          value={itemId}
          onChange={(e) => setItemId(e.target.value)}
          data-testid="inventory-movements-filter-item"
        >
          <option value="">Todos os itens</option>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.code} — {item.description}
            </option>
          ))}
        </select>
        <select
          className="rounded-lg border border-slate-200 px-2 py-2 text-sm"
          value={movementType}
          onChange={(e) => setMovementType(e.target.value)}
          data-testid="inventory-movements-filter-type"
        >
          <option value="">Todos os tipos</option>
          {INVENTORY_FORM_MOVEMENT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <select
          className="min-w-[140px] rounded-lg border border-slate-200 px-2 py-2 text-sm"
          value={warehouseId}
          onChange={(e) => setWarehouseId(e.target.value)}
          data-testid="inventory-movements-filter-warehouse"
        >
          <option value="">Todos almoxarifados</option>
          {warehouses.map((wh) => (
            <option key={wh.id} value={wh.id}>
              {wh.code} — {wh.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          className="rounded-lg border border-slate-200 px-2 py-2 text-sm"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          data-testid="inventory-movements-filter-start"
          aria-label="Data inicial"
        />
        <input
          type="date"
          className="rounded-lg border border-slate-200 px-2 py-2 text-sm"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          data-testid="inventory-movements-filter-end"
          aria-label="Data final"
        />
        <input
          className="min-w-[120px] rounded-lg border border-slate-200 px-2 py-2 text-sm"
          placeholder="Usuário (ID)"
          value={responsibleUserId}
          onChange={(e) => setResponsibleUserId(e.target.value)}
          data-testid="inventory-movements-filter-user"
        />
        <select
          className="rounded-lg border border-slate-200 px-2 py-2 text-sm"
          value={originType}
          onChange={(e) => setOriginType(e.target.value)}
          data-testid="inventory-movements-filter-origin"
        >
          <option value="">Todas origens</option>
          {INVENTORY_ORIGIN_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          className="min-w-[120px] rounded-lg border border-slate-200 px-2 py-2 text-sm"
          placeholder="Documento"
          value={documentNumber}
          onChange={(e) => setDocumentNumber(e.target.value)}
          data-testid="inventory-movements-filter-document"
        />
        <input
          className="min-w-[120px] rounded-lg border border-slate-200 px-2 py-2 text-sm"
          placeholder="Centro de custo (ID)"
          value={costCenterId}
          onChange={(e) => setCostCenterId(e.target.value)}
          data-testid="inventory-movements-filter-cost-center"
        />
        <button
          type="button"
          onClick={clearFilters}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
        >
          Limpar
        </button>
        {canCreateMovement ? (
          <button
            type="button"
            onClick={() => setSheet({ mode: "create" })}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
            data-testid="inventory-movements-new"
          >
            <Plus className="h-4 w-4" />
            Nova movimentação
          </button>
        ) : (
          <p className="ml-auto text-xs text-slate-500" data-testid="inventory-movements-no-permission">
            Sem permissão para registrar movimentações.
          </p>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        {loading ? (
          <div
            className="flex items-center justify-center gap-2 py-12 text-slate-500"
            data-testid="inventory-movements-loading"
          >
            <Loader2 className="h-5 w-5 animate-spin" />
            Carregando movimentações…
          </div>
        ) : rows.length === 0 ? (
          <InventoryEmptyState message="Nenhuma movimentação encontrada." />
        ) : (
          <table className={inventoryTableClassName()} data-testid="inventory-movements-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Tipo</th>
                <th>Item</th>
                <th>Local</th>
                <th>Quantidade</th>
                <th>Saldo disp. antes/depois</th>
                <th>Motivo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="whitespace-nowrap text-xs">
                    {formatInventoryDateTime(row.movementDate)}
                  </td>
                  <td>{formatInventoryMovementType(row.movementType)}</td>
                  <td>
                    <div className="font-medium">{row.itemCode ?? "—"}</div>
                    <div className="text-xs text-slate-500">{row.itemDescription ?? ""}</div>
                    <Link
                      to={`/inventory/items`}
                      className="text-xs text-blue-600 hover:underline"
                      title="Ver item"
                    >
                      Histórico do item
                    </Link>
                  </td>
                  <td className="text-xs">
                    {row.sourceWarehouseCode ? (
                      <div>Origem: {row.sourceWarehouseCode}</div>
                    ) : null}
                    {row.destinationWarehouseCode ? (
                      <div>Destino: {row.destinationWarehouseCode}</div>
                    ) : null}
                    {!row.sourceWarehouseCode && !row.destinationWarehouseCode
                      ? row.warehouseCode ?? "—"
                      : null}
                  </td>
                  <td className="tabular-nums">{formatInventoryQuantity(row.quantity, row.unit)}</td>
                  <td className="tabular-nums text-xs">
                    {formatInventoryQuantity(row.previousAvailableBalance)} →{" "}
                    {formatInventoryQuantity(row.nextAvailableBalance)}
                  </td>
                  <td className="max-w-[200px] truncate text-xs" title={row.reason}>
                    {row.reason || "—"}
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => setSheet({ mode: "view", movementId: row.id })}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
                      data-testid={`inventory-movement-view-${row.id}`}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Detalhes
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>
            {total} movimentação(ões) — página {page} de {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className={cn(
                "rounded-md border px-3 py-1",
                page <= 1 ? "opacity-50" : "hover:bg-slate-50"
              )}
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

      {sheet.mode !== "closed" ? (
        <InventoryMovementFormSheet
          mode={sheet.mode}
          movementId={sheet.mode === "view" ? sheet.movementId : null}
          items={items}
          warehouses={warehouses}
          onClose={() => setSheet({ mode: "closed" })}
          onSaved={() => {
            setSheet({ mode: "closed" });
            void load();
          }}
          canCreate={canCreateMovement}
        />
      ) : null}
    </div>
  );
}
