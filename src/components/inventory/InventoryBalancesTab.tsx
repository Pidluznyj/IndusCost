import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, Search } from "lucide-react";
import { useSearchParams } from "react-router-dom";
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
import { INVENTORY_EMPTY } from "@/src/components/inventory/inventoryEmptyStates";
import { appendQueryIfPresent, hasAnyFilter } from "@/src/components/inventory/inventoryFilterUtils";
import { INVENTORY_ITEM_TYPE_OPTIONS, formatInventoryItemType } from "@/src/components/inventory/inventoryItemLabels";
import { useInventoryPermissions } from "@/src/components/inventory/inventoryPermissions";
import {
  formatInventoryApiError,
  formatInventoryQuantity,
  InventoryBalanceColumnHeader,
  InventoryBalanceGlossary,
  InventoryCollapsibleFilters,
  InventoryEmptyState,
  InventoryErrorBanner,
  InventoryFilterField,
  InventoryLoading,
  InventoryOperationalStatusBadge,
  InventorySectionIntro,
  InventoryTableScroll,
  inventoryFilterInputClass,
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
        <div key={c.label} className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{c.label}</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{c.value}</p>
        </div>
      ))}
    </div>
  );
}

function readBoolParam(params: URLSearchParams, key: string): boolean {
  const v = params.get(key);
  return v === "1" || v === "true";
}

export function InventoryBalancesTab() {
  const { canCreateMovement } = useInventoryPermissions();
  const [searchParams] = useSearchParams();
  const [rows, setRows] = useState<InventoryBalanceListRow[]>([]);
  const [summary, setSummary] = useState<InventoryBalanceListSummary>(EMPTY_BALANCE_LIST_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const [itemId, setItemId] = useState(() => searchParams.get("itemId") ?? "");
  const [itemType, setItemType] = useState(() => searchParams.get("itemType") ?? "");
  const [family, setFamily] = useState(() => searchParams.get("family") ?? "");
  const [group, setGroup] = useState(() => searchParams.get("group") ?? "");
  const [warehouseId, setWarehouseId] = useState(() => searchParams.get("warehouseId") ?? "");
  const [locationId, setLocationId] = useState(() => searchParams.get("locationId") ?? "");
  const [status, setStatus] = useState(() => searchParams.get("status") ?? "");
  const [belowMinimum, setBelowMinimum] = useState(() => readBoolParam(searchParams, "belowMinimum"));
  const [belowReorderPoint, setBelowReorderPoint] = useState(() =>
    readBoolParam(searchParams, "belowReorderPoint")
  );
  const [hasReservation, setHasReservation] = useState(() => readBoolParam(searchParams, "hasReservation"));
  const [hasBlocked, setHasBlocked] = useState(() => readBoolParam(searchParams, "hasBlocked"));
  const [hasQuarantine, setHasQuarantine] = useState(() => readBoolParam(searchParams, "hasQuarantine"));
  const [negativeStock, setNegativeStock] = useState(() => readBoolParam(searchParams, "negativeStock"));

  const [items, setItems] = useState<InventoryItemRow[]>([]);
  const [warehouses, setWarehouses] = useState<InventoryWarehouseRow[]>([]);
  const [locations, setLocations] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const [sheet, setSheet] = useState<SheetState>({ mode: "closed" });

  const filterActiveCount = useMemo(
    () =>
      [
        search,
        itemId,
        itemType,
        family,
        group,
        warehouseId,
        locationId,
        status,
        belowMinimum,
        belowReorderPoint,
        hasReservation,
        hasBlocked,
        hasQuarantine,
        negativeStock,
      ].filter((v) => (typeof v === "boolean" ? v : hasAnyFilter([v]))).length,
    [
      search,
      itemId,
      itemType,
      family,
      group,
      warehouseId,
      locationId,
      status,
      belowMinimum,
      belowReorderPoint,
      hasReservation,
      hasBlocked,
      hasQuarantine,
      negativeStock,
    ]
  );

  const filtersActive = hasAnyFilter([
    search,
    itemId,
    itemType,
    family,
    group,
    warehouseId,
    locationId,
    status,
    belowMinimum,
    belowReorderPoint,
    hasReservation,
    hasBlocked,
    hasQuarantine,
    negativeStock,
  ]);

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

  useEffect(() => {
    if (!warehouseId) {
      setLocations([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchJsonOk<{
          rows?: Array<{ id: string; code: string; name: string; status: string }>;
        }>(`/api/inventory/warehouses/${warehouseId}/locations`);
        if (!cancelled) {
          setLocations(
            (res.rows ?? [])
              .filter((l) => l.status === "ACTIVE")
              .map((l) => ({ id: l.id, code: l.code, name: l.name }))
          );
        }
      } catch {
        if (!cancelled) setLocations([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [warehouseId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      q.set("page", String(page));
      q.set("pageSize", "50");
      appendQueryIfPresent(q, "search", search);
      if (itemId) q.set("itemId", itemId);
      if (itemType) q.set("itemType", itemType);
      appendQueryIfPresent(q, "family", family);
      appendQueryIfPresent(q, "group", group);
      if (warehouseId) q.set("warehouseId", warehouseId);
      if (locationId) q.set("locationId", locationId);
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
      setError(formatInventoryApiError(e, "Não foi possível consultar os saldos. Tente novamente."));
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
    locationId,
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
    locationId,
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
    setLocationId("");
    setStatus("");
    setBelowMinimum(false);
    setBelowReorderPoint(false);
    setHasReservation(false);
    setHasBlocked(false);
    setHasQuarantine(false);
    setNegativeStock(false);
  };

  const emptyState = INVENTORY_EMPTY.noBalancesForFilter;
  const alertRows = rows.filter((r) => r.belowMinimum || r.belowSafety || r.availableQuantity < 0);

  return (
    <div className="space-y-4" data-testid="inventory-balances-tab">
      <InventorySectionIntro
        title="Consulta de saldos"
        description="Saldo físico, reservado, bloqueado, quarentena e disponível por item, almoxarifado e local. Quantidades não são editáveis — use movimentações, implantação ou estorno autorizado."
      />

      <InventoryBalanceGlossary compact />

      {error ? (
        <InventoryErrorBanner
          message={error}
          onDismiss={() => setError(null)}
          testId="inventory-balances-error"
        />
      ) : null}

      {!loading && alertRows.length > 0 ? (
        <div
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          data-testid="inventory-balances-alerts"
        >
          <p className="font-semibold">Alertas na página atual</p>
          <p className="mt-1 text-amber-800">
            {alertRows.length} linha(s) abaixo do mínimo/segurança ou com disponível negativo. Revise
            filtros e movimentações.
          </p>
        </div>
      ) : null}

      <SummaryCards summary={summary} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input
            className={cn(inventoryFilterInputClass, "pl-8")}
            placeholder="Buscar código ou descrição…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="inventory-balances-search"
          />
        </div>
        <a
          href={`/api/inventory/balances/export?${new URLSearchParams({
            ...(warehouseId ? { warehouseId } : {}),
            ...(itemId ? { itemId } : {}),
            ...(locationId ? { locationId } : {}),
          }).toString()}`}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          data-testid="inventory-balances-export-link"
        >
          Exportar CSV
        </a>
      </div>

      <InventoryCollapsibleFilters
        activeCount={filterActiveCount}
        onClear={clearFilters}
        testId="inventory-balances-filters"
      >
        <InventoryFilterField label="Item">
          <select
            className={inventoryFilterInputClass}
            value={itemId}
            onChange={(e) => setItemId(e.target.value)}
            data-testid="inventory-balances-filter-item"
          >
            <option value="">Todos</option>
            {items.map((it) => (
              <option key={it.id} value={it.id}>
                {it.code} — {it.description}
              </option>
            ))}
          </select>
        </InventoryFilterField>
        <InventoryFilterField label="Tipo">
          <select
            className={inventoryFilterInputClass}
            value={itemType}
            onChange={(e) => setItemType(e.target.value)}
            data-testid="inventory-balances-filter-type"
          >
            <option value="">Todos</option>
            {INVENTORY_ITEM_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </InventoryFilterField>
        <InventoryFilterField label="Família">
          <input
            className={inventoryFilterInputClass}
            value={family}
            onChange={(e) => setFamily(e.target.value)}
          />
        </InventoryFilterField>
        <InventoryFilterField label="Grupo">
          <input
            className={inventoryFilterInputClass}
            value={group}
            onChange={(e) => setGroup(e.target.value)}
          />
        </InventoryFilterField>
        <InventoryFilterField label="Almoxarifado">
          <select
            className={inventoryFilterInputClass}
            value={warehouseId}
            onChange={(e) => {
              setWarehouseId(e.target.value);
              setLocationId("");
            }}
            data-testid="inventory-balances-filter-warehouse"
          >
            <option value="">Todos</option>
            {warehouses.map((wh) => (
              <option key={wh.id} value={wh.id}>
                {wh.code} — {wh.name}
              </option>
            ))}
          </select>
        </InventoryFilterField>
        <InventoryFilterField label="Local">
          <select
            className={inventoryFilterInputClass}
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            disabled={!warehouseId}
            data-testid="inventory-balances-filter-location"
          >
            <option value="">Todos</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.code} — {loc.name}
              </option>
            ))}
          </select>
        </InventoryFilterField>
        <InventoryFilterField label="Status item">
          <select
            className={inventoryFilterInputClass}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">Todos</option>
            <option value="ACTIVE">Ativo</option>
            <option value="INACTIVE">Inativo</option>
          </select>
        </InventoryFilterField>
        <label className="inline-flex items-center gap-1.5 self-end pb-2 text-sm">
          <input
            type="checkbox"
            checked={belowMinimum}
            onChange={(e) => setBelowMinimum(e.target.checked)}
            data-testid="inventory-balances-filter-below-minimum"
          />
          Abaixo do mínimo
        </label>
        <label className="inline-flex items-center gap-1.5 self-end pb-2 text-sm">
          <input
            type="checkbox"
            checked={belowReorderPoint}
            onChange={(e) => setBelowReorderPoint(e.target.checked)}
            data-testid="inventory-balances-filter-below-reorder"
          />
          Abaixo reposição
        </label>
        <label className="inline-flex items-center gap-1.5 self-end pb-2 text-sm">
          <input
            type="checkbox"
            checked={hasReservation}
            onChange={(e) => setHasReservation(e.target.checked)}
            data-testid="inventory-balances-filter-reservation"
          />
          Com reserva
        </label>
        <label className="inline-flex items-center gap-1.5 self-end pb-2 text-sm">
          <input
            type="checkbox"
            checked={hasBlocked}
            onChange={(e) => setHasBlocked(e.target.checked)}
            data-testid="inventory-balances-filter-blocked"
          />
          Bloqueado
        </label>
        <label className="inline-flex items-center gap-1.5 self-end pb-2 text-sm">
          <input
            type="checkbox"
            checked={hasQuarantine}
            onChange={(e) => setHasQuarantine(e.target.checked)}
            data-testid="inventory-balances-filter-quarantine"
          />
          Quarentena
        </label>
        <label className="inline-flex items-center gap-1.5 self-end pb-2 text-sm">
          <input
            type="checkbox"
            checked={negativeStock}
            onChange={(e) => setNegativeStock(e.target.checked)}
            data-testid="inventory-balances-filter-negative"
          />
          Negativo
        </label>
      </InventoryCollapsibleFilters>

      {loading ? (
        <InventoryLoading label="Carregando saldos…" />
      ) : rows.length === 0 ? (
        <InventoryEmptyState
          title={emptyState.title}
          description={emptyState.description}
          actionLabel={filtersActive ? emptyState.actionLabel : undefined}
          onAction={filtersActive ? clearFilters : undefined}
        />
      ) : (
        <InventoryTableScroll>
          <table className={inventoryTableClassName()} data-testid="inventory-balances-table">
            <thead>
              <tr>
                <th scope="col">Código</th>
                <th scope="col">Descrição</th>
                <th scope="col">Almoxarifado</th>
                <th scope="col">Local</th>
                <InventoryBalanceColumnHeader label="Físico" />
                <InventoryBalanceColumnHeader label="Reservado" />
                <InventoryBalanceColumnHeader label="Bloqueado" />
                <InventoryBalanceColumnHeader label="Disponível" />
                <th scope="col">Mínimo</th>
                <th scope="col">Segurança</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className={cn(
                    (row.belowMinimum || row.availableQuantity < 0) && "bg-amber-50/60"
                  )}
                >
                  <td className="font-medium">{row.itemCode}</td>
                  <td title={row.itemDescription}>
                    <div>{row.itemDescription}</div>
                    <div className="text-[11px] text-slate-500">
                      {formatInventoryItemType(row.itemType)} · {row.unit}
                    </div>
                  </td>
                  <td className="text-xs">
                    {row.warehouseCode}
                    {row.warehouseName ? ` — ${row.warehouseName}` : ""}
                  </td>
                  <td className="text-xs" data-testid={`inventory-balance-location-${row.id}`}>
                    {row.locationCode
                      ? `${row.locationCode}${row.locationName ? ` — ${row.locationName}` : ""}`
                      : "—"}
                  </td>
                  <td className="tabular-nums">{formatInventoryQuantity(row.physicalQuantity, row.unit)}</td>
                  <td className="tabular-nums">{formatInventoryQuantity(row.reservedQuantity, row.unit)}</td>
                  <td className="tabular-nums">{formatInventoryQuantity(row.blockedQuantity, row.unit)}</td>
                  <td className="tabular-nums font-medium">
                    {formatInventoryQuantity(row.availableQuantity, row.unit)}
                  </td>
                  <td className="tabular-nums text-xs">
                    {row.minimumStock != null
                      ? formatInventoryQuantity(row.minimumStock, row.unit)
                      : "—"}
                  </td>
                  <td className="tabular-nums text-xs">
                    {row.safetyStock != null
                      ? formatInventoryQuantity(row.safetyStock, row.unit)
                      : "—"}
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
        </InventoryTableScroll>
      )}

      {totalPages > 1 || total > 0 ? (
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
