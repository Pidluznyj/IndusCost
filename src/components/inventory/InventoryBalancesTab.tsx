import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Eye, Loader2, Search } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { InventoryBalanceItemDetailSheet } from "@/src/components/inventory/InventoryBalanceItemDetailSheet";
import { InventoryMovementFormSheet } from "@/src/components/inventory/InventoryMovementFormSheet";
import {
  EMPTY_BALANCE_LIST_SUMMARY,
  normalizeInventoryBalanceListResponse,
  type InventoryBalanceListRow,
  type InventoryBalanceListSummary,
} from "@/src/components/inventory/inventoryBalancePresentation";
import { INVENTORY_ITEM_TYPE_OPTIONS, formatInventoryItemType } from "@/src/components/inventory/inventoryItemLabels";
import { useInventoryPermissions } from "@/src/components/inventory/inventoryPermissions";
import {
  formatInventoryApiError,
  formatInventoryDateTime,
  formatInventoryQuantity,
  InventoryEmptyState,
  InventoryOperationalStatusBadge,
  inventoryTableClassName,
} from "@/src/components/inventory/inventoryUi";
import type { InventoryItemRow, InventoryWarehouseRow } from "@/src/types/inventory";

type SheetState =
  | { mode: "closed" }
  | { mode: "detail"; itemId: string }
  | { mode: "movement"; itemId: string };

function SummaryCards({ summary }: { summary: InventoryBalanceListSummary }) {
  const cards = [
    { label: "Itens filtrados", value: summary.filteredItemsCount },
    {
      label: "Valor total filtrado",
      value: summary.totalInventoryValue.toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
      }),
    },
    { label: "Linhas críticas", value: summary.criticalCount },
    { label: "Abaixo do mínimo", value: summary.belowMinimumCount },
    { label: "Saldo negativo", value: summary.negativeCount },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="inventory-balances-summary">
      {cards.map((c) => (
        <div key={c.label} className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{c.label}</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{c.value}</p>
        </div>
      ))}
    </div>
  );
}

export function InventoryBalancesTab() {
  const { canCreateMovement } = useInventoryPermissions();
  const [rows, setRows] = useState<InventoryBalanceListRow[]>([]);
  const [summary, setSummary] = useState<InventoryBalanceListSummary>(EMPTY_BALANCE_LIST_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const [search, setSearch] = useState("");
  const [itemId, setItemId] = useState("");
  const [itemType, setItemType] = useState("");
  const [family, setFamily] = useState("");
  const [group, setGroup] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [status, setStatus] = useState("");
  const [belowMinimum, setBelowMinimum] = useState(false);
  const [belowReorderPoint, setBelowReorderPoint] = useState(false);
  const [hasReservation, setHasReservation] = useState(false);
  const [hasBlocked, setHasBlocked] = useState(false);
  const [hasQuarantine, setHasQuarantine] = useState(false);
  const [negativeStock, setNegativeStock] = useState(false);

  const [items, setItems] = useState<InventoryItemRow[]>([]);
  const [warehouses, setWarehouses] = useState<InventoryWarehouseRow[]>([]);
  const [sheet, setSheet] = useState<SheetState>({ mode: "closed" });

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
      if (search.trim()) q.set("search", search.trim());
      if (itemId) q.set("itemId", itemId);
      if (itemType) q.set("itemType", itemType);
      if (family.trim()) q.set("family", family.trim());
      if (group.trim()) q.set("group", group.trim());
      if (warehouseId) q.set("warehouseId", warehouseId);
      if (status) q.set("status", status);
      if (belowMinimum) q.set("belowMinimum", "true");
      if (belowReorderPoint) q.set("belowReorderPoint", "true");
      if (hasReservation) q.set("hasReservation", "true");
      if (hasBlocked) q.set("hasBlocked", "true");
      if (hasQuarantine) q.set("hasQuarantine", "true");
      if (negativeStock) q.set("negativeStock", "true");

      const raw = await fetchJsonOk<unknown>(`/api/inventory/balances?${q.toString()}`);
      const data = normalizeInventoryBalanceListResponse(raw);
      setRows(data.rows);
      setSummary(data.summary);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch (e: unknown) {
      setError(formatInventoryApiError(e, "Erro ao consultar saldos."));
      setRows([]);
      setSummary(EMPTY_BALANCE_LIST_SUMMARY);
    } finally {
      setLoading(false);
    }
  }, [
    page,
    search,
    itemId,
    itemType,
    family,
    group,
    warehouseId,
    status,
    belowMinimum,
    belowReorderPoint,
    hasReservation,
    hasBlocked,
    hasQuarantine,
    negativeStock,
  ]);

  useEffect(() => {
    setPage(1);
  }, [
    search,
    itemId,
    itemType,
    family,
    group,
    warehouseId,
    status,
    belowMinimum,
    belowReorderPoint,
    hasReservation,
    hasBlocked,
    hasQuarantine,
    negativeStock,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  const clearFilters = () => {
    setSearch("");
    setItemId("");
    setItemType("");
    setFamily("");
    setGroup("");
    setWarehouseId("");
    setStatus("");
    setBelowMinimum(false);
    setBelowReorderPoint(false);
    setHasReservation(false);
    setHasBlocked(false);
    setHasQuarantine(false);
    setNegativeStock(false);
  };

  return (
    <div className="space-y-4" data-testid="inventory-balances-tab">
      <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-700">
        <p className="font-medium text-slate-900">Consulta de saldos</p>
        <p className="mt-1">
          Visualize saldo físico, reservado, bloqueado, em quarentena e disponível por item e almoxarifado.
          Quantidades não são editáveis — use movimentações para alterar estoque.
        </p>
      </div>

      {error ? (
        <div
          className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          data-testid="inventory-balances-error"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : null}

      <SummaryCards summary={summary} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
          <input
            className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-3 text-sm"
            placeholder="Buscar código ou descrição…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="inventory-balances-search"
          />
        </div>
        <select
          className="min-w-[140px] rounded-lg border border-slate-200 px-2 py-2 text-sm"
          value={itemId}
          onChange={(e) => setItemId(e.target.value)}
          data-testid="inventory-balances-filter-item"
        >
          <option value="">Todos os itens</option>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.code}
            </option>
          ))}
        </select>
        <select
          className="rounded-lg border border-slate-200 px-2 py-2 text-sm"
          value={itemType}
          onChange={(e) => setItemType(e.target.value)}
          data-testid="inventory-balances-filter-type"
        >
          <option value="">Todos os tipos</option>
          {INVENTORY_ITEM_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          className="w-28 rounded-lg border border-slate-200 px-2 py-2 text-sm"
          placeholder="Família"
          value={family}
          onChange={(e) => setFamily(e.target.value)}
          data-testid="inventory-balances-filter-family"
        />
        <input
          className="w-28 rounded-lg border border-slate-200 px-2 py-2 text-sm"
          placeholder="Grupo"
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          data-testid="inventory-balances-filter-group"
        />
        <select
          className="min-w-[130px] rounded-lg border border-slate-200 px-2 py-2 text-sm"
          value={warehouseId}
          onChange={(e) => setWarehouseId(e.target.value)}
          data-testid="inventory-balances-filter-warehouse"
        >
          <option value="">Todos almoxarifados</option>
          {warehouses.map((wh) => (
            <option key={wh.id} value={wh.id}>
              {wh.code}
            </option>
          ))}
        </select>
        <select
          className="rounded-lg border border-slate-200 px-2 py-2 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          data-testid="inventory-balances-filter-status"
        >
          <option value="">Todos status</option>
          <option value="ACTIVE">Ativo</option>
          <option value="INACTIVE">Inativo</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={belowMinimum}
            onChange={(e) => setBelowMinimum(e.target.checked)}
            data-testid="inventory-balances-filter-below-minimum"
          />
          Abaixo mín.
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={belowReorderPoint}
            onChange={(e) => setBelowReorderPoint(e.target.checked)}
            data-testid="inventory-balances-filter-below-reorder"
          />
          Abaixo repos.
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={hasReservation}
            onChange={(e) => setHasReservation(e.target.checked)}
            data-testid="inventory-balances-filter-reservation"
          />
          Com reserva
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={hasBlocked}
            onChange={(e) => setHasBlocked(e.target.checked)}
            data-testid="inventory-balances-filter-blocked"
          />
          Bloqueado
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={hasQuarantine}
            onChange={(e) => setHasQuarantine(e.target.checked)}
            data-testid="inventory-balances-filter-quarantine"
          />
          Quarentena
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={negativeStock}
            onChange={(e) => setNegativeStock(e.target.checked)}
            data-testid="inventory-balances-filter-negative"
          />
          Negativo
        </label>
        <button
          type="button"
          onClick={clearFilters}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
        >
          Limpar
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        {loading ? (
          <div
            className="flex items-center justify-center gap-2 py-12 text-slate-500"
            data-testid="inventory-balances-loading"
          >
            <Loader2 className="h-5 w-5 animate-spin" />
            Carregando saldos…
          </div>
        ) : rows.length === 0 ? (
          <InventoryEmptyState message="Nenhum saldo encontrado para os filtros aplicados." />
        ) : (
          <table className={inventoryTableClassName()} data-testid="inventory-balances-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Descrição</th>
                <th>Tipo</th>
                <th>Un.</th>
                <th>Almoxarifado</th>
                <th>Físico</th>
                <th>Reservado</th>
                <th>Bloqueado</th>
                <th>Quarentena</th>
                <th>Disponível</th>
                <th>Custo médio</th>
                <th>Valor total</th>
                <th>Último mov.</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="font-medium">{row.itemCode}</td>
                  <td className="max-w-[160px] truncate" title={row.itemDescription}>
                    {row.itemDescription}
                  </td>
                  <td className="text-xs">{formatInventoryItemType(row.itemType)}</td>
                  <td className="text-xs">{row.unit}</td>
                  <td className="text-xs">
                    {row.warehouseCode}
                    {row.warehouseName ? ` — ${row.warehouseName}` : ""}
                  </td>
                  <td className="tabular-nums">{formatInventoryQuantity(row.physicalQuantity, row.unit)}</td>
                  <td className="tabular-nums">{formatInventoryQuantity(row.reservedQuantity, row.unit)}</td>
                  <td className="tabular-nums">{formatInventoryQuantity(row.blockedQuantity, row.unit)}</td>
                  <td className="tabular-nums">{formatInventoryQuantity(row.quarantineQuantity, row.unit)}</td>
                  <td className="tabular-nums font-medium">
                    {formatInventoryQuantity(row.availableQuantity, row.unit)}
                  </td>
                  <td className="tabular-nums text-xs">
                    {row.averageCost != null
                      ? row.averageCost.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                      : "—"}
                  </td>
                  <td className="tabular-nums text-xs">
                    {row.totalValue != null
                      ? row.totalValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                      : "—"}
                  </td>
                  <td className="text-xs whitespace-nowrap">
                    {formatInventoryDateTime(row.lastMovementAt)}
                  </td>
                  <td>
                    <InventoryOperationalStatusBadge status={row.operationalStatus} />
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => setSheet({ mode: "detail", itemId: row.itemId })}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
                      data-testid={`inventory-balance-view-${row.itemId}`}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Detalhe
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
            {total} saldo(s) — página {page} de {totalPages}
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

      {sheet.mode === "detail" ? (
        <InventoryBalanceItemDetailSheet
          itemId={sheet.itemId}
          onClose={() => setSheet({ mode: "closed" })}
          onNewMovement={(id) => setSheet({ mode: "movement", itemId: id })}
          canCreateMovement={canCreateMovement}
        />
      ) : null}

      {sheet.mode === "movement" ? (
        <InventoryMovementFormSheet
          mode="create"
          movementId={null}
          items={items}
          warehouses={warehouses}
          initialItemId={sheet.itemId}
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
