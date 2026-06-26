import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { Link } from "react-router-dom";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import {
  filterWarehousesForMovement,
} from "@/src/components/inventory/inventoryWarehouseMovementPolicy";
import {
  assertNoBalanceFieldsInMovementPayload,
  createEmptyInventoryMovementForm,
  inventoryMovementFormToMovementPayload,
  inventoryMovementFormToReservationPayload,
  isInventoryMovementFormValid,
  validateInventoryMovementForm,
  type InventoryMovementFormState,
} from "@/src/components/inventory/inventoryMovementForm";
import {
  computeMovementBalancePreview,
  resolvePrimaryWarehouseIdForMovement,
  validateClientMovement,
} from "@/src/components/inventory/inventoryMovementClientRules";
import {
  getMovementFormFields,
  INVENTORY_FORM_MOVEMENT_TYPES,
  INVENTORY_RESERVATION_TYPE_OPTIONS,
} from "@/src/components/inventory/inventoryMovementLabels";
import {
  findBalanceForWarehouse,
  normalizeInventoryBalanceSnapshot,
  normalizeInventoryMovementRow,
} from "@/src/components/inventory/inventoryMovementPresentation";
import {
  formatInventoryApiError,
  formatInventoryDateTime,
  formatInventoryMovementType,
  formatInventoryQuantity,
  InventoryEmptyState,
} from "@/src/components/inventory/inventoryUi";
import type { InventoryItemRow, InventoryMovementRow, InventoryWarehouseRow } from "@/src/types/inventory";

type Props = {
  mode: "create" | "view";
  movementId: string | null;
  items: InventoryItemRow[];
  warehouses: InventoryWarehouseRow[];
  onClose: () => void;
  onSaved: () => void;
  canCreate: boolean;
};

function MovementBalancePreviewPanel({
  preview,
  unit,
}: {
  preview: ReturnType<typeof computeMovementBalancePreview> | null;
  unit?: string;
}) {
  if (!preview) {
    return (
      <InventoryEmptyState message="Selecione item, almoxarifado e quantidade para ver o impacto." />
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3" data-testid="inventory-movement-preview">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Resumo antes de confirmar
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <p className="text-[11px] text-slate-500">Saldo físico atual</p>
          <p className="font-semibold tabular-nums">{formatInventoryQuantity(preview.currentPhysical, unit)}</p>
        </div>
        <div>
          <p className="text-[11px] text-slate-500">Saldo disponível atual</p>
          <p className="font-semibold tabular-nums">{formatInventoryQuantity(preview.currentAvailable, unit)}</p>
        </div>
        <div>
          <p className="text-[11px] text-slate-500">Impacto físico</p>
          <p
            className={cn(
              "font-semibold tabular-nums",
              preview.physicalDelta > 0 ? "text-emerald-700" : preview.physicalDelta < 0 ? "text-red-700" : ""
            )}
          >
            {preview.physicalDelta > 0 ? "+" : ""}
            {formatInventoryQuantity(preview.physicalDelta, unit)}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-slate-500">Impacto disponível</p>
          <p
            className={cn(
              "font-semibold tabular-nums",
              preview.availableDelta > 0 ? "text-emerald-700" : preview.availableDelta < 0 ? "text-red-700" : ""
            )}
          >
            {preview.availableDelta > 0 ? "+" : ""}
            {formatInventoryQuantity(preview.availableDelta, unit)}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-slate-500">Saldo físico após</p>
          <p className="font-semibold tabular-nums">{formatInventoryQuantity(preview.nextPhysical, unit)}</p>
        </div>
        <div>
          <p className="text-[11px] text-slate-500">Saldo disponível após</p>
          <p className="font-semibold tabular-nums">{formatInventoryQuantity(preview.nextAvailable, unit)}</p>
        </div>
      </div>
    </div>
  );
}

function MovementDetailPanel({ movement }: { movement: InventoryMovementRow }) {
  return (
    <div className="space-y-4" data-testid="inventory-movement-detail">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-[11px] font-medium uppercase text-slate-500">Tipo</p>
          <p>{formatInventoryMovementType(movement.movementType)}</p>
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase text-slate-500">Data</p>
          <p>{formatInventoryDateTime(movement.movementDate)}</p>
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase text-slate-500">Item</p>
          <p>
            {movement.itemCode} — {movement.itemDescription}
          </p>
          <Link
            to={`/inventory/items`}
            className="text-xs text-blue-600 hover:underline"
            data-testid="inventory-movement-item-history-link"
          >
            Ver histórico do item
          </Link>
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase text-slate-500">Quantidade</p>
          <p>{formatInventoryQuantity(movement.quantity, movement.unit)}</p>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3" data-testid="inventory-movement-balance-audit">
        <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Saldos registrados</p>
        <div className="grid gap-2 sm:grid-cols-2 text-sm">
          <div>
            Físico: {formatInventoryQuantity(movement.previousPhysicalBalance)} →{" "}
            {formatInventoryQuantity(movement.nextPhysicalBalance)}
          </div>
          <div>
            Disponível: {formatInventoryQuantity(movement.previousAvailableBalance)} →{" "}
            {formatInventoryQuantity(movement.nextAvailableBalance)}
          </div>
        </div>
      </div>

      <div className="grid gap-2 text-sm">
        <div>
          <span className="text-slate-500">Motivo:</span> {movement.reason || "—"}
        </div>
        {movement.notes ? (
          <div>
            <span className="text-slate-500">Observação:</span> {movement.notes}
          </div>
        ) : null}
        {movement.documentNumber ? (
          <div>
            <span className="text-slate-500">Documento:</span> {movement.documentNumber}
          </div>
        ) : null}
        {movement.costCenterId ? (
          <div>
            <span className="text-slate-500">Centro de custo:</span> {movement.costCenterId}
          </div>
        ) : null}
        {movement.responsibleUserId ? (
          <div>
            <span className="text-slate-500">Usuário:</span> {movement.responsibleUserId}
          </div>
        ) : null}
        {movement.originType ? (
          <div>
            <span className="text-slate-500">Origem:</span> {movement.originType}
          </div>
        ) : null}
      </div>

      {movement.movementType === "REVERSAL" || movement.reversedMovementId ? (
        <p className="text-xs text-amber-700">
          Estorno vinculado: {movement.reversedMovementId ?? "—"}
        </p>
      ) : null}

      <p className="text-xs text-slate-500">
        Estorno automático ainda não disponível no backend. Correções devem usar movimentações
        compensatórias ou ajustes rastreáveis.
      </p>
    </div>
  );
}

export function InventoryMovementFormSheet({
  mode,
  movementId,
  items,
  warehouses,
  onClose,
  onSaved,
  canCreate,
}: Props) {
  const [form, setForm] = useState<InventoryMovementFormState>(createEmptyInventoryMovementForm());
  const [formErrors, setFormErrors] = useState<ReturnType<typeof validateInventoryMovementForm>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(mode === "view");
  const [movement, setMovement] = useState<InventoryMovementRow | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [currentBalance, setCurrentBalance] = useState<ReturnType<typeof normalizeInventoryBalanceSnapshot> | null>(
    null
  );
  const [costCenters, setCostCenters] = useState<Array<{ id: string; label: string }>>([]);

  const selectableWarehouses = useMemo(
    () => filterWarehousesForMovement(warehouses),
    [warehouses]
  );

  const selectedItem = useMemo(
    () => items.find((i) => i.id === form.itemId) ?? null,
    [items, form.itemId]
  );

  const visibleFields = useMemo(() => getMovementFormFields(form.movementType), [form.movementType]);

  const preview = useMemo(() => {
    if (mode !== "create" || form.movementType === "CANCEL_RESERVATION") return null;
    const qty = Number(form.quantity.replace(",", "."));
    if (!Number.isFinite(qty) || qty <= 0) return null;
    return computeMovementBalancePreview(currentBalance, form.movementType, qty);
  }, [mode, form.movementType, form.quantity, currentBalance]);

  useEffect(() => {
    void (async () => {
      try {
        const raw = await fetchJsonOk<{ rows?: Array<{ id: string; code?: string; name?: string }> }>(
          "/api/finance/cost-centers?status=ACTIVE"
        );
        const rows = Array.isArray(raw.rows) ? raw.rows : [];
        setCostCenters(
          rows.map((cc) => ({
            id: cc.id,
            label: [cc.code, cc.name].filter(Boolean).join(" — ") || cc.id,
          }))
        );
      } catch {
        setCostCenters([]);
      }
    })();
  }, []);

  const loadBalance = useCallback(async () => {
    if (mode !== "create" || form.movementType === "CANCEL_RESERVATION") {
      setCurrentBalance(null);
      return;
    }
    const warehouseId = resolvePrimaryWarehouseIdForMovement(
      form.movementType,
      form.sourceWarehouseId,
      form.destinationWarehouseId
    );
    if (!form.itemId.trim() || !warehouseId) {
      setCurrentBalance(null);
      return;
    }
    setBalanceLoading(true);
    try {
      const q = new URLSearchParams();
      q.set("itemId", form.itemId);
      q.set("warehouseId", warehouseId);
      q.set("pageSize", "10");
      const raw = await fetchJsonOk<{ rows?: unknown[] }>(`/api/inventory/balances?${q.toString()}`);
      const rows = Array.isArray(raw.rows) ? raw.rows : [];
      setCurrentBalance(findBalanceForWarehouse(rows, warehouseId));
    } catch {
      setCurrentBalance(null);
    } finally {
      setBalanceLoading(false);
    }
  }, [mode, form.itemId, form.movementType, form.sourceWarehouseId, form.destinationWarehouseId]);

  useEffect(() => {
    void loadBalance();
  }, [loadBalance]);

  useEffect(() => {
    if (mode !== "view" || !movementId) return;
    setLoadingDetail(true);
    setSubmitError(null);
    void (async () => {
      try {
        const raw = await fetchJsonOk<{ movement?: unknown }>(`/api/inventory/movements/${movementId}`);
        const row = normalizeInventoryMovementRow(raw.movement);
        setMovement(row);
      } catch (e: unknown) {
        setSubmitError(formatInventoryApiError(e, "Erro ao carregar movimentação."));
        setMovement(null);
      } finally {
        setLoadingDetail(false);
      }
    })();
  }, [mode, movementId]);

  const updateField = <K extends keyof InventoryMovementFormState>(key: K, value: InventoryMovementFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFormErrors((prev) => ({ ...prev, [key]: undefined }));
    setSubmitError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreate) return;

    const errors = validateInventoryMovementForm(form, selectedItem?.itemType ?? null);
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    if (form.movementType !== "CANCEL_RESERVATION") {
      const qty = Number(form.quantity.replace(",", "."));
      const clientCheck = validateClientMovement(currentBalance, form.movementType, qty, {
        reason: form.reason,
        costCenterId: form.costCenterId,
        itemType: selectedItem?.itemType ?? null,
        sourceWarehouseId: form.sourceWarehouseId,
        destinationWarehouseId: form.destinationWarehouseId,
      });
      if (!clientCheck.ok) {
        setSubmitError(clientCheck.message);
        return;
      }
    }

    setSaving(true);
    setSubmitError(null);
    try {
      if (form.movementType === "CANCEL_RESERVATION") {
        await fetchJsonOk(`/api/inventory/reservations/${form.reservationId.trim()}/cancel`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: form.reason.trim() }),
        });
      } else if (form.movementType === "RESERVE") {
        const payload = inventoryMovementFormToReservationPayload(form);
        await fetchJsonOk("/api/inventory/reservations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        const payload = inventoryMovementFormToMovementPayload(form);
        assertNoBalanceFieldsInMovementPayload(payload as Record<string, unknown>);
        await fetchJsonOk("/api/inventory/movements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      onSaved();
    } catch (err: unknown) {
      setSubmitError(formatInventoryApiError(err, "Erro ao registrar movimentação."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" data-testid="inventory-movement-sheet">
      <button type="button" className="flex-1" aria-label="Fechar" onClick={onClose} />
      <div className="flex h-full w-full max-w-lg flex-col bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-900">
            {mode === "create" ? "Nova movimentação" : "Detalhes da movimentação"}
          </h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {submitError ? (
            <div
              className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
              data-testid="inventory-movement-form-error"
              role="alert"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {submitError}
            </div>
          ) : null}

          {mode === "view" ? (
            loadingDetail ? (
              <div className="flex items-center justify-center gap-2 py-12 text-slate-500">
                <Loader2 className="h-5 w-5 animate-spin" />
                Carregando…
              </div>
            ) : movement ? (
              <MovementDetailPanel movement={movement} />
            ) : (
              <InventoryEmptyState message="Movimentação não encontrada." />
            )
          ) : (
            <form id="inventory-movement-form" onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Tipo de movimentação</label>
                <select
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={form.movementType}
                  onChange={(e) =>
                    updateField("movementType", e.target.value as InventoryMovementFormState["movementType"])
                  }
                  data-testid="inventory-movement-type"
                >
                  {INVENTORY_FORM_MOVEMENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value} disabled={!t.enabled}>
                      {t.label}
                      {t.hint ? ` (${t.hint})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              {visibleFields.has("reservationId") ? (
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">ID da reserva</label>
                  <input
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    value={form.reservationId}
                    onChange={(e) => updateField("reservationId", e.target.value)}
                    data-testid="inventory-movement-reservation-id"
                  />
                  {formErrors.reservationId ? (
                    <p className="mt-1 text-xs text-red-600">{formErrors.reservationId}</p>
                  ) : null}
                </div>
              ) : null}

              {visibleFields.has("item") ? (
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Item</label>
                  <select
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    value={form.itemId}
                    onChange={(e) => updateField("itemId", e.target.value)}
                    data-testid="inventory-movement-item"
                  >
                    <option value="">Selecione…</option>
                    {items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.code} — {item.description}
                      </option>
                    ))}
                  </select>
                  {formErrors.itemId ? <p className="mt-1 text-xs text-red-600">{formErrors.itemId}</p> : null}
                </div>
              ) : null}

              {visibleFields.has("sourceWarehouse") ? (
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Almoxarifado origem</label>
                  <select
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    value={form.sourceWarehouseId}
                    onChange={(e) => updateField("sourceWarehouseId", e.target.value)}
                    data-testid="inventory-movement-source-warehouse"
                  >
                    <option value="">Selecione…</option>
                    {selectableWarehouses.map((wh) => (
                      <option key={wh.id} value={wh.id}>
                        {wh.code} — {wh.name}
                      </option>
                    ))}
                  </select>
                  {formErrors.sourceWarehouseId ? (
                    <p className="mt-1 text-xs text-red-600">{formErrors.sourceWarehouseId}</p>
                  ) : null}
                </div>
              ) : null}

              {visibleFields.has("destinationWarehouse") ? (
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Almoxarifado destino</label>
                  <select
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    value={form.destinationWarehouseId}
                    onChange={(e) => updateField("destinationWarehouseId", e.target.value)}
                    data-testid="inventory-movement-destination-warehouse"
                  >
                    <option value="">Selecione…</option>
                    {selectableWarehouses.map((wh) => (
                      <option key={wh.id} value={wh.id}>
                        {wh.code} — {wh.name}
                      </option>
                    ))}
                  </select>
                  {formErrors.destinationWarehouseId ? (
                    <p className="mt-1 text-xs text-red-600">{formErrors.destinationWarehouseId}</p>
                  ) : null}
                </div>
              ) : null}

              {visibleFields.has("quantity") ? (
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    Quantidade {selectedItem?.unit ? `(${selectedItem.unit})` : ""}
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    value={form.quantity}
                    onChange={(e) => updateField("quantity", e.target.value)}
                    data-testid="inventory-movement-quantity"
                  />
                  {formErrors.quantity ? (
                    <p className="mt-1 text-xs text-red-600">{formErrors.quantity}</p>
                  ) : null}
                </div>
              ) : null}

              {visibleFields.has("reason") ? (
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Motivo</label>
                  <textarea
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    rows={2}
                    value={form.reason}
                    onChange={(e) => updateField("reason", e.target.value)}
                    data-testid="inventory-movement-reason"
                  />
                  {formErrors.reason ? <p className="mt-1 text-xs text-red-600">{formErrors.reason}</p> : null}
                </div>
              ) : null}

              {visibleFields.has("documentNumber") ? (
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Documento</label>
                  <input
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    value={form.documentNumber}
                    onChange={(e) => updateField("documentNumber", e.target.value)}
                    data-testid="inventory-movement-document"
                  />
                </div>
              ) : null}

              {visibleFields.has("costCenter") ? (
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Centro de custo</label>
                  {costCenters.length > 0 ? (
                    <select
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      value={form.costCenterId}
                      onChange={(e) => updateField("costCenterId", e.target.value)}
                      data-testid="inventory-movement-cost-center"
                    >
                      <option value="">Selecione…</option>
                      {costCenters.map((cc) => (
                        <option key={cc.id} value={cc.id}>
                          {cc.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      placeholder="ID do centro de custo"
                      value={form.costCenterId}
                      onChange={(e) => updateField("costCenterId", e.target.value)}
                      data-testid="inventory-movement-cost-center"
                    />
                  )}
                  {formErrors.costCenterId ? (
                    <p className="mt-1 text-xs text-red-600">{formErrors.costCenterId}</p>
                  ) : null}
                </div>
              ) : null}

              {visibleFields.has("reservationType") ? (
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Tipo de reserva</label>
                  <select
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    value={form.reservationType}
                    onChange={(e) => updateField("reservationType", e.target.value)}
                    data-testid="inventory-movement-reservation-type"
                  >
                    {INVENTORY_RESERVATION_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {visibleFields.has("notes") ? (
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Observação</label>
                  <textarea
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    rows={2}
                    value={form.notes}
                    onChange={(e) => updateField("notes", e.target.value)}
                    data-testid="inventory-movement-notes"
                  />
                </div>
              ) : null}

              {form.movementType !== "CANCEL_RESERVATION" ? (
                balanceLoading ? (
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Carregando saldo…
                  </div>
                ) : (
                  <MovementBalancePreviewPanel preview={preview} unit={selectedItem?.unit} />
                )
              ) : null}
            </form>
          )}
        </div>

        {mode === "create" && canCreate ? (
          <div className="border-t border-slate-200 px-4 py-3">
            <button
              type="submit"
              form="inventory-movement-form"
              disabled={saving || !isInventoryMovementFormValid(form, selectedItem?.itemType ?? null)}
              className="w-full rounded-lg bg-slate-900 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
              data-testid="inventory-movement-submit"
            >
              {saving ? "Registrando…" : "Confirmar movimentação"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
