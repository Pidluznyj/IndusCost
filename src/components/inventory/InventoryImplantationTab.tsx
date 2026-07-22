import React, { useCallback, useEffect, useState } from "react";
import { Download, Plus, RefreshCw } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { useInventoryPermissions } from "@/src/components/inventory/inventoryPermissions";
import { INVENTORY_EMPTY } from "@/src/components/inventory/inventoryEmptyStates";
import {
  formatInventoryApiError,
  formatInventoryDateTime,
  formatInventoryQuantity,
  InventoryEmptyState,
  InventoryErrorBanner,
  InventoryLoading,
  InventorySectionIntro,
  InventoryTableScroll,
  inventoryFilterInputClass,
  inventoryTableClassName,
} from "@/src/components/inventory/inventoryUi";
import type { InventoryItemRow, InventoryWarehouseRow } from "@/src/types/inventory";

type ImplantRow = {
  id: string;
  itemCode: string | null;
  itemDescription: string | null;
  warehouseCode: string | null;
  warehouseName: string | null;
  destinationLocationCode: string | null;
  quantity: number;
  unit: string;
  movementDate: string;
  reason: string;
  responsibleUserId: string | null;
  evidenceRef: string | null;
  documentNumber: string | null;
};

type FormState = {
  itemId: string;
  warehouseId: string;
  locationId: string;
  quantity: string;
  countDate: string;
  justification: string;
  evidenceRef: string;
  documentNumber: string;
  notes: string;
};

const EMPTY_FORM: FormState = {
  itemId: "",
  warehouseId: "",
  locationId: "",
  quantity: "",
  countDate: new Date().toISOString().slice(0, 10),
  justification: "",
  evidenceRef: "",
  documentNumber: "",
  notes: "",
};

export function InventoryImplantationTab() {
  const { canCreateAdjustment, canCreateMovement } = useInventoryPermissions();
  const canImplant = canCreateAdjustment || canCreateMovement;

  const [rows, setRows] = useState<ImplantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [items, setItems] = useState<InventoryItemRow[]>([]);
  const [warehouses, setWarehouses] = useState<InventoryWarehouseRow[]>([]);
  const [locations, setLocations] = useState<Array<{ id: string; code: string; name: string }>>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, itemRes, whRes] = await Promise.all([
        fetchJsonOk<{ rows: ImplantRow[] }>("/api/inventory/initial-balances?pageSize=100"),
        fetchJsonOk<{ rows: InventoryItemRow[] }>("/api/inventory/items?pageSize=200&status=ACTIVE"),
        fetchJsonOk<{ rows: InventoryWarehouseRow[] }>(
          "/api/inventory/warehouses?pageSize=200&status=ACTIVE"
        ),
      ]);
      setRows(list.rows ?? []);
      setItems(itemRes.rows ?? []);
      setWarehouses(whRes.rows ?? []);
    } catch (e: unknown) {
      setError(formatInventoryApiError(e, "Erro ao carregar implantação."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!form.warehouseId) {
      setLocations([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchJsonOk<{
          rows: Array<{ id: string; code: string; name: string; status: string }>;
        }>(`/api/inventory/warehouses/${form.warehouseId}/locations`);
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
  }, [form.warehouseId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canImplant) return;
    setSaving(true);
    setError(null);
    try {
      await fetchJsonOk("/api/inventory/initial-balances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: form.itemId,
          warehouseId: form.warehouseId,
          locationId: form.locationId || null,
          quantity: Number(form.quantity),
          countDate: form.countDate,
          justification: form.justification,
          evidenceRef: form.evidenceRef || null,
          documentNumber: form.documentNumber || null,
          notes: form.notes || null,
        }),
      });
      setForm(EMPTY_FORM);
      setFormOpen(false);
      await load();
    } catch (err: unknown) {
      setError(formatInventoryApiError(err, "Erro ao registrar saldo inicial."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="inventory-implantation-tab">
      <InventorySectionIntro
        title="Implantação de estoque"
        description="Saldo inicial auditável via ledger (INITIAL_BALANCE). Quantidades não são editadas diretamente — correção somente por estorno."
      />

      {error ? <InventoryErrorBanner message={error} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        {canImplant ? (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
            onClick={() => setFormOpen(true)}
            data-testid="inventory-implantation-open-form"
          >
            <Plus className="h-4 w-4" />
            Nova implantação
          </button>
        ) : null}
        <a
          href="/api/inventory/initial-balances/report"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          data-testid="inventory-implantation-report"
        >
          <Download className="h-4 w-4" />
          Relatório CSV
        </a>
        <a
          href="/api/inventory/balances/export"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          data-testid="inventory-balances-export"
        >
          <Download className="h-4 w-4" />
          Exportar saldos
        </a>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          onClick={() => void load()}
        >
          <RefreshCw className="h-4 w-4" />
          Atualizar
        </button>
      </div>

      {formOpen ? (
        <form
          onSubmit={submit}
          className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          data-testid="inventory-implantation-form"
        >
          <p className="text-sm font-semibold text-slate-800">Registrar saldo inicial</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Item *</span>
              <select
                required
                className={inventoryFilterInputClass}
                value={form.itemId}
                onChange={(ev) => setForm((f) => ({ ...f, itemId: ev.target.value }))}
              >
                <option value="">Selecione</option>
                {items.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.code} — {it.description}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Almoxarifado *</span>
              <select
                required
                className={inventoryFilterInputClass}
                value={form.warehouseId}
                onChange={(ev) =>
                  setForm((f) => ({ ...f, warehouseId: ev.target.value, locationId: "" }))
                }
              >
                <option value="">Selecione</option>
                {warehouses.map((wh) => (
                  <option key={wh.id} value={wh.id}>
                    {wh.code} — {wh.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Local</span>
              <select
                className={inventoryFilterInputClass}
                value={form.locationId}
                onChange={(ev) => setForm((f) => ({ ...f, locationId: ev.target.value }))}
              >
                <option value="">Sem local específico</option>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.code} — {loc.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Quantidade contada *</span>
              <input
                required
                type="number"
                min="0"
                step="any"
                className={inventoryFilterInputClass}
                value={form.quantity}
                onChange={(ev) => setForm((f) => ({ ...f, quantity: ev.target.value }))}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Data da contagem *</span>
              <input
                required
                type="date"
                className={inventoryFilterInputClass}
                value={form.countDate}
                onChange={(ev) => setForm((f) => ({ ...f, countDate: ev.target.value }))}
              />
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block text-slate-600">Justificativa *</span>
              <textarea
                required
                minLength={5}
                rows={2}
                className={cn(inventoryFilterInputClass, "min-h-[64px]")}
                value={form.justification}
                onChange={(ev) => setForm((f) => ({ ...f, justification: ev.target.value }))}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Evidência (ref. opcional)</span>
              <input
                className={inventoryFilterInputClass}
                placeholder="Documento, path ou URL"
                value={form.evidenceRef}
                onChange={(ev) => setForm((f) => ({ ...f, evidenceRef: ev.target.value }))}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Nº documento</span>
              <input
                className={inventoryFilterInputClass}
                value={form.documentNumber}
                onChange={(ev) => setForm((f) => ({ ...f, documentNumber: ev.target.value }))}
              />
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
            >
              {saving ? "Gravando…" : "Confirmar implantação"}
            </button>
            <button
              type="button"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700"
              onClick={() => setFormOpen(false)}
            >
              Cancelar
            </button>
          </div>
        </form>
      ) : null}

      {loading ? (
        <InventoryLoading />
      ) : rows.length === 0 ? (
        <InventoryEmptyState
          title={INVENTORY_EMPTY.noImplantation.title}
          description={INVENTORY_EMPTY.noImplantation.description}
          actionLabel={canImplant ? INVENTORY_EMPTY.noImplantation.actionLabel : undefined}
          onAction={canImplant ? () => setFormOpen(true) : undefined}
        />
      ) : (
        <InventoryTableScroll>
          <table className={inventoryTableClassName} data-testid="inventory-implantation-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Item</th>
                <th>Almoxarifado</th>
                <th>Local</th>
                <th>Qtd</th>
                <th>Justificativa</th>
                <th>Evidência</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{formatInventoryDateTime(row.movementDate)}</td>
                  <td>
                    <div className="font-medium">{row.itemCode}</div>
                    <div className="text-xs text-slate-500">{row.itemDescription}</div>
                  </td>
                  <td>
                    {row.warehouseCode} — {row.warehouseName}
                  </td>
                  <td>{row.destinationLocationCode ?? "—"}</td>
                  <td className="tabular-nums">
                    {formatInventoryQuantity(row.quantity, row.unit)}
                  </td>
                  <td className="max-w-[220px] truncate" title={row.reason}>
                    {row.reason}
                  </td>
                  <td className="max-w-[160px] truncate text-xs">
                    {row.evidenceRef || row.documentNumber || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </InventoryTableScroll>
      )}
    </div>
  );
}
