/**
 * Painel de locais internos no detalhe do almoxarifado (OP-07).
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import {
  createEmptyInventoryLocationForm,
  formatInventoryLocationAddress,
  formatInventoryLocationType,
  inventoryLocationFormFromRow,
  inventoryLocationFormToPayload,
  isInventoryLocationFormValid,
  normalizeInventoryLocationListResponse,
  validateInventoryLocationForm,
  type InventoryLocationFormState,
} from "@/src/components/inventory/inventoryLocationForm";
import {
  formatInventoryApiError,
  InventoryEmptyState,
  inventoryTableClassName,
} from "@/src/components/inventory/inventoryUi";
import type { InventoryLocationRow } from "@/src/types/inventory";

type Props = {
  warehouseId: string;
  canManage: boolean;
};

export function InventoryWarehouseLocationsPanel({ warehouseId, canManage }: Props) {
  const [rows, setRows] = useState<InventoryLocationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<InventoryLocationFormState>(createEmptyInventoryLocationForm());
  const [formErrors, setFormErrors] = useState<ReturnType<typeof validateInventoryLocationForm>>({});

  const parentOptions = useMemo(
    () => rows.filter((r) => r.status === "ACTIVE" && r.id !== editingId),
    [rows, editingId]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const raw = await fetchJsonOk<unknown>(
        `/api/inventory/warehouses/${warehouseId}/locations`
      );
      const data = normalizeInventoryLocationListResponse(raw);
      setRows(data.rows);
    } catch (e: unknown) {
      setError(formatInventoryApiError(e, "Não foi possível carregar os locais."));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [warehouseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const startCreate = () => {
    setCreating(true);
    setEditingId(null);
    setForm(createEmptyInventoryLocationForm());
    setFormErrors({});
  };

  const startEdit = (row: InventoryLocationRow) => {
    setCreating(false);
    setEditingId(row.id);
    setForm(inventoryLocationFormFromRow(row));
    setFormErrors({});
  };

  const cancelForm = () => {
    setCreating(false);
    setEditingId(null);
    setForm(createEmptyInventoryLocationForm());
    setFormErrors({});
  };

  const save = async () => {
    if (!canManage) return;
    const validation = validateInventoryLocationForm(form);
    setFormErrors(validation);
    if (Object.keys(validation).length > 0) return;

    setSaving(true);
    setError(null);
    try {
      const payload = inventoryLocationFormToPayload(form);
      if (creating) {
        await fetchJsonOk(`/api/inventory/warehouses/${warehouseId}/locations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else if (editingId) {
        await fetchJsonOk(`/api/inventory/warehouses/${warehouseId}/locations/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      cancelForm();
      await load();
    } catch (e: unknown) {
      setError(formatInventoryApiError(e, "Erro ao salvar local."));
    } finally {
      setSaving(false);
    }
  };

  const inactivate = async (row: InventoryLocationRow) => {
    if (!canManage || row.status === "INACTIVE") return;
    if (!window.confirm(`Inativar o local ${row.code}? O histórico será preservado.`)) return;
    setSaving(true);
    setError(null);
    try {
      await fetchJsonOk(
        `/api/inventory/warehouses/${warehouseId}/locations/${row.id}/status`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "INACTIVE" }),
        }
      );
      await load();
    } catch (e: unknown) {
      setError(formatInventoryApiError(e, "Não foi possível inativar o local."));
    } finally {
      setSaving(false);
    }
  };

  const showForm = creating || editingId != null;
  const inputClass =
    "mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300/60";

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3" data-testid="inventory-warehouse-locations">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">Locais internos</h4>
          <p className="text-xs text-slate-500">
            Corredor, estante e posição. Preferir inativação a exclusão física.
          </p>
        </div>
        {canManage && !showForm ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white"
            onClick={startCreate}
            data-testid="inventory-location-add"
          >
            <Plus className="h-3.5 w-3.5" />
            Novo local
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {showForm ? (
        <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2" data-testid="inventory-location-form">
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Código *</span>
            <input
              className={inputClass}
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
            />
            {formErrors.code ? <span className="text-xs text-red-600">{formErrors.code}</span> : null}
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Nome *</span>
            <input
              className={inputClass}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
            {formErrors.name ? <span className="text-xs text-red-600">{formErrors.name}</span> : null}
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Tipo</span>
            <select
              className={inputClass}
              value={form.locationType}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  locationType: e.target.value as InventoryLocationFormState["locationType"],
                }))
              }
            >
              <option value="PHYSICAL">Físico</option>
              <option value="QUARANTINE">Quarentena</option>
              <option value="PRODUCTION">Produção</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Local pai</span>
            <select
              className={inputClass}
              value={form.parentLocationId}
              onChange={(e) => setForm((f) => ({ ...f, parentLocationId: e.target.value }))}
            >
              <option value="">— Nenhum —</option>
              {parentOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Corredor</span>
            <input
              className={inputClass}
              value={form.aisle}
              onChange={(e) => setForm((f) => ({ ...f, aisle: e.target.value }))}
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Estante</span>
            <input
              className={inputClass}
              value={form.shelf}
              onChange={(e) => setForm((f) => ({ ...f, shelf: e.target.value }))}
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Posição</span>
            <input
              className={inputClass}
              value={form.position}
              onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
            />
          </label>
          <label className="mt-6 flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))}
            />
            Local padrão do almoxarifado
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="font-medium text-slate-700">Observações</span>
            <textarea
              className={inputClass}
              rows={2}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <button
              type="button"
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
              onClick={cancelForm}
              disabled={saving}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-60"
              disabled={saving || !isInventoryLocationFormValid(form)}
              onClick={() => void save()}
              data-testid="inventory-location-save"
            >
              {saving ? "Salvando…" : "Salvar local"}
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : rows.length === 0 ? (
        <InventoryEmptyState message="Nenhum local cadastrado neste almoxarifado." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className={inventoryTableClassName()} data-testid="inventory-locations-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Nome</th>
                <th>Tipo</th>
                <th>Endereço</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={cn(row.status === "INACTIVE" && "opacity-60")}>
                  <td className="font-medium">
                    {row.code}
                    {row.isDefault ? (
                      <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-600">
                        padrão
                      </span>
                    ) : null}
                  </td>
                  <td>{row.name}</td>
                  <td>{formatInventoryLocationType(row.locationType)}</td>
                  <td className="text-xs text-slate-600">{formatInventoryLocationAddress(row)}</td>
                  <td>{row.status === "ACTIVE" ? "Ativo" : "Inativo"}</td>
                  <td className="text-right">
                    {canManage ? (
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          className="text-xs font-medium text-slate-700 hover:underline"
                          onClick={() => startEdit(row)}
                        >
                          Editar
                        </button>
                        {row.status === "ACTIVE" ? (
                          <button
                            type="button"
                            className="text-xs font-medium text-amber-800 hover:underline"
                            onClick={() => void inactivate(row)}
                            data-testid={`inventory-location-inactivate-${row.code}`}
                          >
                            Inativar
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
