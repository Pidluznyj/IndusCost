/**
 * Estoque → Setores / Collector → Novo setor / Editar setor.
 *
 * Um setor é configuração: aponta para um almoxarifado e um tipo de item. Não
 * cria itens nem saldo. Almoxarifado pode ser um existente ou um novo, criado
 * junto com o setor na mesma transação do servidor.
 *
 * A prévia "Itens que este setor irá enxergar" é um COUNT no servidor
 * (GET /api/inventory/stock-sectors/preview) — nenhum item é carregado aqui.
 */
import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { formatInventoryItemType } from "@/src/components/inventory/inventoryItemLabels";
import { formatInventoryApiError } from "@/src/components/inventory/inventoryUi";
import {
  applyStockSectorName,
  createEmptyStockSectorForm,
  isStockSectorFormValid,
  stockSectorCollectorPath,
  stockSectorFormFromRow,
  stockSectorFormToCreatePayload,
  stockSectorFormToUpdatePayload,
  stockSectorItemTypeRequiresCostCenter,
  validateStockSectorForm,
  type StockSectorFormOptions,
  type StockSectorFormState,
  type StockSectorRow,
} from "@/src/components/inventory/inventoryStockSectorForm";

type Props = {
  /** null = novo setor. */
  sector: StockSectorRow | null;
  options: StockSectorFormOptions;
  onClose: () => void;
  onSaved: (saved: StockSectorRow) => void;
};

type Preview =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; eligibleItems: number }
  | { status: "error" };

const inputClass =
  "mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300/60 disabled:bg-slate-50 disabled:text-slate-500";

function FieldError({ message }: { message?: string }) {
  return message ? <p className="mt-1 text-xs text-red-700">{message}</p> : null;
}

/** Mensagem da prévia de população — exportada para teste estático. */
export function StockSectorPopulationPreview({
  preview,
  newWarehouse,
}: {
  preview: Preview;
  newWarehouse: boolean;
}) {
  if (newWarehouse) {
    return (
      <p
        className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
        data-testid="stock-sector-preview"
      >
        Almoxarifado novo: o setor começa sem itens. Defina este almoxarifado como padrão dos
        itens (Estoque → Itens) para que apareçam na contagem e na retirada.
      </p>
    );
  }
  if (preview.status === "idle") return null;
  if (preview.status === "loading") {
    return (
      <p className="text-sm text-slate-500" data-testid="stock-sector-preview">
        Calculando itens do setor…
      </p>
    );
  }
  if (preview.status === "error") {
    return (
      <p className="text-sm text-amber-800" data-testid="stock-sector-preview">
        Não foi possível calcular a prévia agora. O setor pode ser salvo mesmo assim.
      </p>
    );
  }
  if (preview.eligibleItems === 0) {
    return (
      <p
        className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        data-testid="stock-sector-preview"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <strong>Itens que este setor irá enxergar: 0.</strong> Nenhum item ativo deste tipo,
          com controle de estoque, tem este almoxarifado como padrão ou saldo nele. A contagem
          não poderá ser iniciada até existir ao menos um.
        </span>
      </p>
    );
  }
  return (
    <p
      className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
      data-testid="stock-sector-preview"
    >
      <strong>Itens que este setor irá enxergar: {preview.eligibleItems}</strong>
    </p>
  );
}

export function InventoryStockSectorFormSheet({ sector, options, onClose, onSaved }: Props) {
  const isCreate = sector == null;
  const [form, setForm] = useState<StockSectorFormState>(() =>
    sector ? stockSectorFormFromRow(sector) : createEmptyStockSectorForm()
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [preview, setPreview] = useState<Preview>({ status: "idle" });

  const errors = useMemo(
    () => validateStockSectorForm(form, options, isCreate ? "create" : "edit"),
    [form, options, isCreate]
  );
  const visibleErrors = showErrors ? errors : {};
  const requiresCostCenter = stockSectorItemTypeRequiresCostCenter(options, form.itemType);

  const set = <K extends keyof StockSectorFormState>(key: K, value: StockSectorFormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const setTouched = (key: "code" | "slug" | "sessionCodePrefix", value: string) =>
    setForm((current) => ({
      ...current,
      [key]: value,
      touched: { ...current.touched, [key]: true },
    }));

  // Prévia: COUNT no servidor sempre que tipo de item / almoxarifado mudam.
  useEffect(() => {
    if (form.warehouseMode !== "existing" || !form.itemType || !form.warehouseId) {
      setPreview({ status: "idle" });
      return;
    }
    let cancelled = false;
    setPreview({ status: "loading" });
    const params = new URLSearchParams({
      itemType: form.itemType,
      warehouseId: form.warehouseId,
    });
    fetchJsonOk<{ eligibleItems: number }>(
      `/api/inventory/stock-sectors/preview?${params.toString()}`
    )
      .then((data) => {
        if (!cancelled) setPreview({ status: "ready", eligibleItems: Number(data.eligibleItems) || 0 });
      })
      .catch(() => {
        if (!cancelled) setPreview({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [form.warehouseMode, form.itemType, form.warehouseId]);

  const save = async () => {
    setShowErrors(true);
    if (!isStockSectorFormValid(errors)) return;
    setSaving(true);
    setError(null);
    try {
      if (isCreate) {
        const data = await fetchJsonOk<{ sector: StockSectorRow }>("/api/inventory/stock-sectors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(stockSectorFormToCreatePayload(form)),
        });
        onSaved(data.sector);
      } else {
        const patch = stockSectorFormToUpdatePayload(form, sector);
        if (Object.keys(patch).length === 0) {
          onClose();
          return;
        }
        const data = await fetchJsonOk<{ sector: StockSectorRow }>(
          `/api/inventory/stock-sectors/${sector.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          }
        );
        onSaved(data.sector);
      }
      onClose();
    } catch (e: unknown) {
      setError(formatInventoryApiError(e, "Erro ao salvar o setor."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" data-testid="stock-sector-sheet">
      <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">
              {isCreate ? "Novo setor de estoque" : `${sector.code} — ${sector.name}`}
            </h3>
            <p className="mt-0.5 text-sm text-slate-500">
              O setor liga um almoxarifado a um tipo de item. Não cria itens nem saldo.
            </p>
          </div>
          <button type="button" className="rounded p-1 hover:bg-slate-100" onClick={onClose} aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
          {error ? (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          ) : null}

          <section className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm sm:col-span-2">
              <span className="font-medium text-slate-700">
                Nome <span className="text-red-600">*</span>
              </span>
              <input
                className={inputClass}
                value={form.name}
                placeholder="Ex.: Estoque Administrativo"
                onChange={(e) => setForm((current) => applyStockSectorName(current, e.target.value))}
                data-testid="stock-sector-name"
              />
              <FieldError message={visibleErrors.name} />
            </label>

            <label className="block text-sm">
              <span className="font-medium text-slate-700">
                Código <span className="text-red-600">*</span>
              </span>
              <input
                className={inputClass}
                value={form.code}
                disabled={!isCreate}
                placeholder="ADMINISTRATIVO"
                onChange={(e) => setTouched("code", e.target.value.toUpperCase())}
                data-testid="stock-sector-code"
              />
              {!isCreate ? (
                <p className="mt-1 text-xs text-slate-500">O código não muda depois de criado.</p>
              ) : null}
              <FieldError message={visibleErrors.code} />
            </label>

            <label className="block text-sm">
              <span className="font-medium text-slate-700">
                Prefixo de sessão <span className="text-red-600">*</span>
              </span>
              <input
                className={inputClass}
                value={form.sessionCodePrefix}
                maxLength={4}
                placeholder="ADM"
                onChange={(e) => setTouched("sessionCodePrefix", e.target.value.toUpperCase())}
                data-testid="stock-sector-prefix"
              />
              <p className="mt-1 text-xs text-slate-500">
                Conferências do setor: {form.sessionCodePrefix || "ADM"}-AAAAMMDD-001
              </p>
              <FieldError message={visibleErrors.sessionCodePrefix} />
            </label>

            <label className="block text-sm sm:col-span-2">
              <span className="font-medium text-slate-700">
                Slug (endereço do QR) <span className="text-red-600">*</span>
              </span>
              <input
                className={inputClass}
                value={form.slug}
                placeholder="administrativo"
                onChange={(e) => setTouched("slug", e.target.value.toLowerCase())}
                data-testid="stock-sector-slug"
              />
              <p className="mt-1 text-xs text-slate-500">
                QR do setor: {stockSectorCollectorPath(form.slug || "administrativo")}
                {!isCreate ? " — mudar o slug invalida QRs já impressos." : ""}
              </p>
              <FieldError message={visibleErrors.slug} />
            </label>
          </section>

          <section className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Strategy</span>
              <select className={inputClass} value={form.strategy} disabled data-testid="stock-sector-strategy">
                <option value="STANDARD">Padrão (STANDARD)</option>
              </select>
              <p className="mt-1 text-xs text-slate-500">
                Matéria-prima, Componentes e Produto acabado têm fluxo próprio e não são
                cadastrados aqui.
              </p>
            </label>

            <label className="block text-sm">
              <span className="font-medium text-slate-700">
                Tipo de item <span className="text-red-600">*</span>
              </span>
              <select
                className={inputClass}
                value={form.itemType}
                onChange={(e) => set("itemType", e.target.value)}
                data-testid="stock-sector-item-type"
              >
                <option value="">Selecione…</option>
                {options.itemTypes.map((type) => (
                  <option key={type.itemType} value={type.itemType}>
                    {formatInventoryItemType(type.itemType)}
                  </option>
                ))}
              </select>
              <FieldError message={visibleErrors.itemType} />
            </label>
          </section>

          <section className="space-y-3 rounded-xl border border-slate-200 p-3">
            <p className="text-sm font-medium text-slate-700">Almoxarifado</p>
            {isCreate ? (
              <div className="flex flex-wrap gap-4 text-sm text-slate-700">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name="stock-sector-warehouse-mode"
                    checked={form.warehouseMode === "existing"}
                    onChange={() => set("warehouseMode", "existing")}
                    data-testid="stock-sector-warehouse-existing"
                  />
                  Usar existente
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name="stock-sector-warehouse-mode"
                    checked={form.warehouseMode === "new"}
                    onChange={() => set("warehouseMode", "new")}
                    data-testid="stock-sector-warehouse-new"
                  />
                  Criar novo
                </label>
              </div>
            ) : null}

            {form.warehouseMode === "existing" ? (
              <label className="block text-sm">
                <select
                  className={inputClass}
                  value={form.warehouseId}
                  onChange={(e) => set("warehouseId", e.target.value)}
                  data-testid="stock-sector-warehouse"
                >
                  <option value="">Selecione o almoxarifado…</option>
                  {options.warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.code} — {warehouse.name}
                    </option>
                  ))}
                </select>
                <FieldError message={visibleErrors.warehouseId} />
              </label>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="font-medium text-slate-700">
                    Código do almoxarifado <span className="text-red-600">*</span>
                  </span>
                  <input
                    className={inputClass}
                    value={form.newWarehouseCode}
                    onChange={(e) => set("newWarehouseCode", e.target.value.toUpperCase())}
                    data-testid="stock-sector-new-warehouse-code"
                  />
                  <FieldError message={visibleErrors.newWarehouseCode} />
                </label>
                <label className="block text-sm">
                  <span className="font-medium text-slate-700">
                    Nome do almoxarifado <span className="text-red-600">*</span>
                  </span>
                  <input
                    className={inputClass}
                    value={form.newWarehouseName}
                    onChange={(e) => set("newWarehouseName", e.target.value)}
                    data-testid="stock-sector-new-warehouse-name"
                  />
                  <FieldError message={visibleErrors.newWarehouseName} />
                </label>
                <label className="block text-sm sm:col-span-2">
                  <span className="font-medium text-slate-700">Descrição (opcional)</span>
                  <input
                    className={inputClass}
                    value={form.newWarehouseDescription}
                    onChange={(e) => set("newWarehouseDescription", e.target.value)}
                  />
                </label>
                <p className="text-xs text-slate-500 sm:col-span-2">
                  O almoxarifado é criado junto com o setor. Se o setor não puder ser salvo, o
                  almoxarifado também não é criado.
                </p>
              </div>
            )}

            <StockSectorPopulationPreview
              preview={preview}
              newWarehouse={form.warehouseMode === "new"}
            />
          </section>

          <section className="space-y-3 rounded-xl border border-slate-200 p-3">
            <p className="text-sm font-medium text-slate-700">Operações no celular</p>
            <div className="flex flex-wrap gap-6 text-sm text-slate-700">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.allowsCounting}
                  onChange={(e) => set("allowsCounting", e.target.checked)}
                  data-testid="stock-sector-allows-counting"
                />
                Contagem
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.allowsWithdrawal}
                  onChange={(e) => set("allowsWithdrawal", e.target.checked)}
                  data-testid="stock-sector-allows-withdrawal"
                />
                Retirada
              </label>
            </div>
            <FieldError message={visibleErrors.operations} />

            <label className="block text-sm">
              <span className="font-medium text-slate-700">
                Centro de custo das saídas
                {requiresCostCenter ? <span className="text-red-600"> *</span> : " (opcional)"}
              </span>
              <select
                className={inputClass}
                value={form.defaultCostCenterId}
                onChange={(e) => set("defaultCostCenterId", e.target.value)}
                data-testid="stock-sector-cost-center"
              >
                <option value="">{requiresCostCenter ? "Selecione…" : "Sem centro de custo"}</option>
                {options.costCenters.map((costCenter) => (
                  <option key={costCenter.id} value={costCenter.id}>
                    {costCenter.code} — {costCenter.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">
                Usado nas retiradas e nos ajustes negativos de contagem deste setor.
              </p>
              <FieldError message={visibleErrors.defaultCostCenterId} />
            </label>
          </section>

          <label className="block text-sm">
            <span className="font-medium text-slate-700">Status</span>
            <select
              className={cn(inputClass, "sm:w-1/2")}
              value={form.status}
              onChange={(e) => set("status", e.target.value as "ACTIVE" | "INACTIVE")}
              data-testid="stock-sector-status"
            >
              <option value="ACTIVE">Ativo</option>
              <option value="INACTIVE">Inativo</option>
            </select>
            <p className="mt-1 text-xs text-slate-500">
              Setor inativo some do Collector; o histórico de contagens e retiradas permanece.
            </p>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <button
            type="button"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            onClick={() => void save()}
            disabled={saving}
            data-testid="stock-sector-save"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isCreate ? "Criar setor" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
