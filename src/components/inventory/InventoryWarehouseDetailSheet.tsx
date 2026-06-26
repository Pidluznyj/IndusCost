import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import {
  formatInventoryWarehouseStatus,
  type SuggestedInventoryWarehouse,
} from "@/src/components/inventory/inventoryWarehouseLabels";
import {
  createEmptyInventoryWarehouseForm,
  inventoryWarehouseFormFromRow,
  inventoryWarehouseFormToPayload,
  isInventoryWarehouseFormValid,
  validateInventoryWarehouseForm,
  type InventoryWarehouseFormState,
} from "@/src/components/inventory/inventoryWarehouseForm";
import {
  buildWarehouseSummaryFromBalances,
  EMPTY_WAREHOUSE_SUMMARY,
  normalizeInventoryWarehouseRow,
  normalizeWarehouseBalancesResponse,
  type InventoryWarehouseSummary,
} from "@/src/components/inventory/inventoryWarehousePresentation";
import { warehouseMovementBlockReason } from "@/src/components/inventory/inventoryWarehouseMovementPolicy";
import {
  formatInventoryApiError,
  formatInventoryDateTime,
  formatInventoryOperationalStatus,
  formatInventoryQuantity,
  InventoryEmptyState,
  inventoryTableClassName,
} from "@/src/components/inventory/inventoryUi";
import type { InventoryWarehouseRow } from "@/src/types/inventory";

type Props = {
  warehouseId: string | null;
  mode: "create" | "view";
  template?: SuggestedInventoryWarehouse;
  onClose: () => void;
  onSaved: () => void;
  canManage: boolean;
};

function WarehouseSummaryPanel({ summary }: { summary: InventoryWarehouseSummary }) {
  return (
    <div className="space-y-4" data-testid="inventory-warehouse-summary">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Total de itens
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{summary.itemsCount}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Valor em estoque
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums">
            {summary.totalInventoryValue.toLocaleString("pt-BR", {
              style: "currency",
              currency: "BRL",
            })}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Itens críticos
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-amber-700">
            {summary.criticalItems.length}
          </p>
        </div>
      </div>

      {!summary.hasBalances ? (
        <InventoryEmptyState message="Nenhum saldo registrado neste almoxarifado." />
      ) : (
        <>
          {summary.criticalItems.length > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
              <p className="text-sm font-medium text-amber-900">Itens críticos</p>
              <ul className="mt-2 space-y-1 text-sm text-amber-950">
                {summary.criticalItems.slice(0, 8).map((item) => (
                  <li key={item.itemId}>
                    {item.itemCode} — {item.itemDescription} (
                    {formatInventoryOperationalStatus(item.operationalStatus)})
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className={inventoryTableClassName()}>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Disponível</th>
                  <th>Físico</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {summary.balanceRows.slice(0, 20).map((row) => (
                  <tr key={row.itemId}>
                    <td>
                      <div className="font-medium">{row.itemCode}</div>
                      <div className="text-xs text-slate-500">{row.itemDescription}</div>
                    </td>
                    <td className="tabular-nums">{formatInventoryQuantity(row.availableQuantity)}</td>
                    <td className="tabular-nums">{formatInventoryQuantity(row.physicalQuantity)}</td>
                    <td>{formatInventoryOperationalStatus(row.operationalStatus)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <p className="text-sm font-medium text-slate-900">Últimas movimentações</p>
        {summary.recentMovements.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">
            Histórico por almoxarifado será exibido quando a API de movimentações estiver
            disponível nesta visão.
          </p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {summary.recentMovements.map((m) => (
              <li key={m.id}>
                {formatInventoryDateTime(m.movementDate)} — {m.itemCode} — {m.movementType}{" "}
                {formatInventoryQuantity(m.quantity, m.unit)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function InventoryWarehouseDetailSheet({
  warehouseId,
  mode,
  template,
  onClose,
  onSaved,
  canManage,
}: Props) {
  const isCreate = mode === "create";
  const [loading, setLoading] = useState(!isCreate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<InventoryWarehouseFormState>(() =>
    template
      ? createEmptyInventoryWarehouseForm({
          code: template.code,
          name: template.name,
          description: template.description,
        })
      : createEmptyInventoryWarehouseForm()
  );
  const [errors, setErrors] = useState<ReturnType<typeof validateInventoryWarehouseForm>>({});
  const [warehouse, setWarehouse] = useState<InventoryWarehouseRow | null>(null);
  const [summary, setSummary] = useState<InventoryWarehouseSummary>(EMPTY_WAREHOUSE_SUMMARY);
  const [editing, setEditing] = useState(isCreate);

  const load = useCallback(async () => {
    if (!warehouseId) return;
    setLoading(true);
    setError(null);
    try {
      const [whRes, balRes] = await Promise.all([
        fetchJsonOk<{ warehouse: unknown }>(`/api/inventory/warehouses/${warehouseId}`),
        fetchJsonOk<unknown>(
          `/api/inventory/balances?warehouseId=${warehouseId}&pageSize=200`
        ).catch(() => ({ rows: [] })),
      ]);
      const normalized = normalizeInventoryWarehouseRow(whRes.warehouse);
      if (!normalized) throw new Error("Almoxarifado não encontrado.");
      setWarehouse(normalized);
      setForm(inventoryWarehouseFormFromRow(normalized));
      const balances = normalizeWarehouseBalancesResponse(balRes);
      setSummary(buildWarehouseSummaryFromBalances(balances));
    } catch (e: unknown) {
      setError(formatInventoryApiError(e, "Erro ao carregar almoxarifado."));
    } finally {
      setLoading(false);
    }
  }, [warehouseId]);

  useEffect(() => {
    if (isCreate) {
      setEditing(true);
      setWarehouse(null);
      setSummary(EMPTY_WAREHOUSE_SUMMARY);
      setLoading(false);
      if (template) {
        setForm(
          createEmptyInventoryWarehouseForm({
            code: template.code,
            name: template.name,
            description: template.description,
          })
        );
      } else {
        setForm(createEmptyInventoryWarehouseForm());
      }
      return;
    }
    void load();
  }, [isCreate, load, template]);

  const save = async () => {
    if (!canManage) return;
    const validation = validateInventoryWarehouseForm(form);
    setErrors(validation);
    if (Object.keys(validation).length > 0) return;

    setSaving(true);
    setError(null);
    try {
      const payload = inventoryWarehouseFormToPayload(form);
      if (isCreate) {
        await fetchJsonOk("/api/inventory/warehouses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else if (warehouseId) {
        await fetchJsonOk(`/api/inventory/warehouses/${warehouseId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      onSaved();
      onClose();
    } catch (e: unknown) {
      setError(formatInventoryApiError(e, "Erro ao salvar almoxarifado."));
    } finally {
      setSaving(false);
    }
  };

  const inactivate = async () => {
    if (!canManage || !warehouseId || warehouse?.status === "INACTIVE") return;
    if (!window.confirm("Inativar este almoxarifado? O histórico será preservado.")) return;
    setSaving(true);
    setError(null);
    try {
      await fetchJsonOk(`/api/inventory/warehouses/${warehouseId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "INACTIVE" }),
      });
      onSaved();
      await load();
      setEditing(false);
    } catch (e: unknown) {
      setError(formatInventoryApiError(e, "Erro ao inativar almoxarifado."));
    } finally {
      setSaving(false);
    }
  };

  const movementBlock = warehouse ? warehouseMovementBlockReason(warehouse) : null;
  const title = isCreate
    ? "Novo almoxarifado"
    : warehouse
      ? `${warehouse.code} — ${warehouse.name}`
      : "Almoxarifado";

  const inputClass = cn(
    "w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300/60",
    !editing && "bg-slate-50 text-slate-600"
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" data-testid="inventory-warehouse-sheet">
      <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
            {!isCreate && warehouse ? (
              <p className="mt-0.5 text-sm text-slate-500">
                {formatInventoryWarehouseStatus(warehouse.status)}
                {movementBlock ? ` · ${movementBlock}` : " · Aceita movimentações"}
              </p>
            ) : null}
          </div>
          <button type="button" className="rounded p-1 hover:bg-slate-100" onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {error ? (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          ) : null}

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          ) : (
            <div className="space-y-4">
              {!isCreate ? <WarehouseSummaryPanel summary={summary} /> : null}

              <div className="grid gap-3 sm:grid-cols-2" data-testid="inventory-warehouse-form">
                <label className="block text-sm">
                  <span className="font-medium text-slate-700">
                    Código <span className="text-red-600">*</span>
                  </span>
                  <input
                    className={cn(inputClass, "mt-1")}
                    value={form.code}
                    disabled={!editing || !canManage}
                    onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                  />
                  {errors.code ? (
                    <span className="mt-0.5 block text-xs text-red-600">{errors.code}</span>
                  ) : null}
                </label>
                <label className="block text-sm">
                  <span className="font-medium text-slate-700">
                    Nome <span className="text-red-600">*</span>
                  </span>
                  <input
                    className={cn(inputClass, "mt-1")}
                    value={form.name}
                    disabled={!editing || !canManage}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  />
                  {errors.name ? (
                    <span className="mt-0.5 block text-xs text-red-600">{errors.name}</span>
                  ) : null}
                </label>
                <label className="block text-sm sm:col-span-2">
                  <span className="font-medium text-slate-700">Descrição / observações</span>
                  <textarea
                    className={cn(inputClass, "mt-1 min-h-[72px]")}
                    value={form.description}
                    disabled={!editing || !canManage}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium text-slate-700">Status</span>
                  <select
                    className={cn(inputClass, "mt-1")}
                    value={form.status}
                    disabled={!editing || !canManage}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        status: e.target.value as InventoryWarehouseFormState["status"],
                      }))
                    }
                  >
                    <option value="ACTIVE">Ativo</option>
                    <option value="INACTIVE">Inativo</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 text-sm sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={form.allowsMovements}
                    disabled={!editing || !canManage}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, allowsMovements: e.target.checked }))
                    }
                  />
                  Permite movimentações
                </label>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-3">
          <div>
            {!isCreate && canManage && warehouse?.status === "ACTIVE" ? (
              <button
                type="button"
                disabled={saving}
                className="rounded-lg border border-amber-300 px-3 py-1.5 text-sm text-amber-900 hover:bg-amber-50"
                onClick={() => void inactivate()}
              >
                Inativar
              </button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
              onClick={onClose}
            >
              Fechar
            </button>
            {canManage && !isCreate && !editing ? (
              <button
                type="button"
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white"
                onClick={() => setEditing(true)}
              >
                Editar
              </button>
            ) : null}
            {canManage && editing ? (
              <button
                type="button"
                disabled={saving || !isInventoryWarehouseFormValid(form)}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-60"
                onClick={() => void save()}
              >
                {saving ? "Salvando…" : "Salvar"}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
