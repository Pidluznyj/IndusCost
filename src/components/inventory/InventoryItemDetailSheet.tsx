import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import {
  formatInventoryItemStatus,
  formatInventoryItemType,
  INVENTORY_ITEM_TYPE_OPTIONS,
  INVENTORY_UNIT_SUGGESTIONS,
} from "@/src/components/inventory/inventoryItemLabels";
import {
  createEmptyInventoryItemForm,
  inventoryItemFormFromRow,
  inventoryItemFormToPayload,
  isInventoryItemFormValid,
  validateInventoryItemForm,
  type InventoryItemFormState,
} from "@/src/components/inventory/inventoryItemForm";
import {
  normalizeInventoryBalancesResponse,
  normalizeInventoryItemRow,
  summarizeInventoryBalances,
  type InventoryItemBalanceSummary,
} from "@/src/components/inventory/inventoryItemPresentation";
import {
  formatInventoryApiError,
  formatInventoryDateTime,
  formatInventoryOperationalStatus,
  formatInventoryQuantity,
} from "@/src/components/inventory/inventoryUi";
import type { InventoryItemRow } from "@/src/types/inventory";

type Props = {
  itemId: string | null;
  mode: "create" | "view";
  onClose: () => void;
  onSaved: () => void;
  canManage: boolean;
};

function FieldLabel({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-700">
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </span>
      <div className="mt-1">{children}</div>
      {error ? <span className="mt-0.5 block text-xs text-red-600">{error}</span> : null}
    </label>
  );
}

function BalanceSummaryPanel({ summary }: { summary: InventoryItemBalanceSummary }) {
  const items = [
    { label: "Saldo físico", value: summary.physicalQuantity },
    { label: "Reservado", value: summary.reservedQuantity },
    { label: "Bloqueado", value: summary.blockedQuantity },
    { label: "Quarentena", value: summary.quarantineQuantity },
    { label: "Disponível", value: summary.availableQuantity },
  ];

  return (
    <div
      className="rounded-lg border border-slate-200 bg-slate-50/80 p-4"
      data-testid="inventory-item-balance-summary"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-slate-900">Resumo de saldo</h4>
        <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
          {formatInventoryOperationalStatus(summary.operationalStatus)}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Saldos consolidados de todos os almoxarifados. Para ajustar quantidade, use movimentação de
        estoque.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <div key={item.label} className="rounded-md bg-white px-3 py-2 ring-1 ring-slate-100">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              {item.label}
            </p>
            <p className="mt-0.5 text-base font-semibold tabular-nums text-slate-900">
              {formatInventoryQuantity(item.value)}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Último movimento: {formatInventoryDateTime(summary.lastMovementAt)}
      </p>
      {!summary.hasBalances ? (
        <p className="mt-2 text-xs text-amber-700">Item ainda sem saldo registrado.</p>
      ) : null}
    </div>
  );
}

function InventoryItemFormFields({
  form,
  setForm,
  errors,
  readOnly,
}: {
  form: InventoryItemFormState;
  setForm: React.Dispatch<React.SetStateAction<InventoryItemFormState>>;
  errors: ReturnType<typeof validateInventoryItemForm>;
  readOnly?: boolean;
}) {
  const inputClass = cn(
    "w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300/60",
    readOnly && "bg-slate-50 text-slate-600"
  );

  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="inventory-item-form">
      <FieldLabel label="Código interno" required error={errors.code}>
        <input
          className={inputClass}
          value={form.code}
          disabled={readOnly}
          onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
        />
      </FieldLabel>
      <FieldLabel label="Unidade padrão" required error={errors.unit}>
        <input
          className={inputClass}
          list="inventory-unit-suggestions"
          value={form.unit}
          disabled={readOnly}
          onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
        />
        <datalist id="inventory-unit-suggestions">
          {INVENTORY_UNIT_SUGGESTIONS.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
      </FieldLabel>
      <FieldLabel label="Descrição" required error={errors.description}>
        <input
          className={cn(inputClass, "sm:col-span-2")}
          value={form.description}
          disabled={readOnly}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
      </FieldLabel>
      <FieldLabel label="Tipo do item" required error={errors.itemType}>
        <select
          className={inputClass}
          value={form.itemType}
          disabled={readOnly}
          onChange={(e) =>
            setForm((f) => ({ ...f, itemType: e.target.value as InventoryItemFormState["itemType"] }))
          }
        >
          <option value="">Selecione…</option>
          {INVENTORY_ITEM_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </FieldLabel>
      <FieldLabel label="Status">
        <select
          className={inputClass}
          value={form.status}
          disabled={readOnly}
          onChange={(e) =>
            setForm((f) => ({ ...f, status: e.target.value as InventoryItemFormState["status"] }))
          }
        >
          <option value="ACTIVE">Ativo</option>
          <option value="INACTIVE">Inativo</option>
        </select>
      </FieldLabel>
      <FieldLabel label="Família">
        <input
          className={inputClass}
          value={form.family}
          disabled={readOnly}
          onChange={(e) => setForm((f) => ({ ...f, family: e.target.value }))}
        />
      </FieldLabel>
      <FieldLabel label="Grupo">
        <input
          className={inputClass}
          value={form.group}
          disabled={readOnly}
          onChange={(e) => setForm((f) => ({ ...f, group: e.target.value }))}
        />
      </FieldLabel>
      <FieldLabel label="Fornecedor principal">
        <input
          className={inputClass}
          value={form.preferredSupplierName}
          disabled={readOnly}
          onChange={(e) => setForm((f) => ({ ...f, preferredSupplierName: e.target.value }))}
        />
      </FieldLabel>
      <FieldLabel label="Código Nomus">
        <input
          className={inputClass}
          value={form.nomusProductCode}
          disabled={readOnly}
          onChange={(e) => setForm((f) => ({ ...f, nomusProductCode: e.target.value }))}
        />
      </FieldLabel>
      <FieldLabel label="Estoque mínimo" error={errors.minimumStock}>
        <input
          type="number"
          min={0}
          step="any"
          className={inputClass}
          value={form.minimumStock}
          disabled={readOnly}
          onChange={(e) => setForm((f) => ({ ...f, minimumStock: e.target.value }))}
        />
      </FieldLabel>
      <FieldLabel label="Estoque máximo" error={errors.maximumStock}>
        <input
          type="number"
          min={0}
          step="any"
          className={inputClass}
          value={form.maximumStock}
          disabled={readOnly}
          onChange={(e) => setForm((f) => ({ ...f, maximumStock: e.target.value }))}
        />
      </FieldLabel>
      <FieldLabel label="Ponto de reposição" error={errors.reorderPoint}>
        <input
          type="number"
          min={0}
          step="any"
          className={inputClass}
          value={form.reorderPoint}
          disabled={readOnly}
          onChange={(e) => setForm((f) => ({ ...f, reorderPoint: e.target.value }))}
        />
      </FieldLabel>
      <FieldLabel label="Custo médio gerencial" error={errors.averageCost}>
        <input
          type="number"
          min={0}
          step="any"
          className={inputClass}
          value={form.averageCost}
          disabled={readOnly}
          onChange={(e) => setForm((f) => ({ ...f, averageCost: e.target.value }))}
        />
      </FieldLabel>
      <FieldLabel label="Último custo conhecido" error={errors.lastKnownCost}>
        <input
          type="number"
          min={0}
          step="any"
          className={inputClass}
          value={form.lastKnownCost}
          disabled={readOnly}
          onChange={(e) => setForm((f) => ({ ...f, lastKnownCost: e.target.value }))}
        />
      </FieldLabel>
      <div className="sm:col-span-2 flex flex-wrap gap-4 pt-1">
        {(
          [
            ["controlsLot", "Controla lote"],
            ["controlsExpiration", "Controla validade"],
            ["controlsLocation", "Controla localização"],
            ["controlsQuality", "Controla qualidade"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form[key]}
              disabled={readOnly}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.checked }))}
            />
            {label}
          </label>
        ))}
      </div>
      <FieldLabel label="Observações">
        <textarea
          className={cn(inputClass, "min-h-[80px] sm:col-span-2")}
          value={form.notes}
          disabled={readOnly}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
        />
      </FieldLabel>
    </div>
  );
}

export function InventoryItemDetailSheet({
  itemId,
  mode,
  onClose,
  onSaved,
  canManage,
}: Props) {
  const isCreate = mode === "create";
  const [loading, setLoading] = useState(!isCreate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<InventoryItemFormState>(() =>
    createEmptyInventoryItemForm(isCreate ? { itemType: "RAW_MATERIAL" } : undefined)
  );
  const [errors, setErrors] = useState<ReturnType<typeof validateInventoryItemForm>>({});
  const [item, setItem] = useState<InventoryItemRow | null>(null);
  const [balanceSummary, setBalanceSummary] = useState<InventoryItemBalanceSummary | null>(null);
  const [editing, setEditing] = useState(isCreate);

  const load = useCallback(async () => {
    if (!itemId) return;
    setLoading(true);
    setError(null);
    try {
      const [itemRes, balanceRes] = await Promise.all([
        fetchJsonOk<{ item: unknown }>(`/api/inventory/items/${itemId}`),
        fetchJsonOk<unknown>(`/api/inventory/items/${itemId}/balances`).catch(() => ({ rows: [] })),
      ]);
      const normalized = normalizeInventoryItemRow(itemRes.item);
      if (!normalized) throw new Error("Item não encontrado.");
      setItem(normalized);
      setForm(inventoryItemFormFromRow(normalized));
      const balances = normalizeInventoryBalancesResponse(balanceRes);
      setBalanceSummary(summarizeInventoryBalances(balances, normalized));
    } catch (e: unknown) {
      setError(formatInventoryApiError(e, "Erro ao carregar item."));
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    if (isCreate) {
      setEditing(true);
      setForm(createEmptyInventoryItemForm());
      setBalanceSummary(null);
      setItem(null);
      setLoading(false);
      return;
    }
    void load();
  }, [isCreate, load]);

  const save = async () => {
    if (!canManage) return;
    const validation = validateInventoryItemForm(form);
    setErrors(validation);
    if (Object.keys(validation).length > 0) return;

    setSaving(true);
    setError(null);
    try {
      const payload = inventoryItemFormToPayload(form);
      if (isCreate) {
        await fetchJsonOk("/api/inventory/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else if (itemId) {
        await fetchJsonOk(`/api/inventory/items/${itemId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      onSaved();
      onClose();
    } catch (e: unknown) {
      setError(formatInventoryApiError(e, "Erro ao salvar item."));
    } finally {
      setSaving(false);
    }
  };

  const inactivate = async () => {
    if (!canManage || !itemId || item?.status === "INACTIVE") return;
    if (!window.confirm("Inativar este item? O histórico será preservado.")) return;
    setSaving(true);
    setError(null);
    try {
      await fetchJsonOk(`/api/inventory/items/${itemId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "INACTIVE" }),
      });
      onSaved();
      await load();
      setEditing(false);
    } catch (e: unknown) {
      setError(formatInventoryApiError(e, "Erro ao inativar item."));
    } finally {
      setSaving(false);
    }
  };

  const title = isCreate ? "Novo item" : item ? `${item.code} — ${item.description}` : "Item";

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" data-testid="inventory-item-sheet">
      <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
            {!isCreate && item ? (
              <p className="mt-0.5 text-sm text-slate-500">
                {formatInventoryItemType(item.itemType)} · {formatInventoryItemStatus(item.status)}
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
              {!isCreate && balanceSummary ? <BalanceSummaryPanel summary={balanceSummary} /> : null}
              {!isCreate && !balanceSummary && !loading ? (
                <BalanceSummaryPanel
                  summary={summarizeInventoryBalances([], item ?? undefined)}
                />
              ) : null}

              <InventoryItemFormFields
                form={form}
                setForm={setForm}
                errors={errors}
                readOnly={!editing || !canManage}
              />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-3">
          <div className="flex gap-2">
            {!isCreate && canManage && item?.status === "ACTIVE" ? (
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
                disabled={saving || !isInventoryItemFormValid(form)}
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
