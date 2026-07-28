/**
 * Edição dos parâmetros de nível + saldo atual (obrigatório).
 * Não altera custos.
 */
import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  buildParametersRequestBody,
  parseCurrentQuantityParameterInput,
  parseStockLevelParameterInput,
  toCurrentQuantityInputValue,
  updateMaterialStockParameters,
  validateStockParametersForm,
  type MaterialStockParametersApiResult,
} from "@/src/lib/materialStockParametersClient";
import type { MaterialStockTabletListItem } from "@/src/lib/materialStockTabletTypes";

export type MaterialStockParametersDialogProps = {
  item: MaterialStockTabletListItem;
  open: boolean;
  onClose: () => void;
  onSuccess: (result: MaterialStockParametersApiResult) => void;
};

function toInputValue(value: number | null): string {
  if (value == null) return "";
  return String(value).replace(".", ",");
}

export function MaterialStockParametersDialog({
  item,
  open,
  onClose,
  onSuccess,
}: MaterialStockParametersDialogProps) {
  const [currentQuantityRaw, setCurrentQuantityRaw] = useState(() =>
    toCurrentQuantityInputValue(item.currentQuantity)
  );
  const [contingencyRaw, setContingencyRaw] = useState(() =>
    toInputValue(item.contingencyQuantity)
  );
  const [minimumRaw, setMinimumRaw] = useState(() =>
    toInputValue(item.minimumQuantity)
  );
  const [recommendedRaw, setRecommendedRaw] = useState(() =>
    toInputValue(item.recommendedQuantity)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCurrentQuantityRaw(toCurrentQuantityInputValue(item.currentQuantity));
    setContingencyRaw(toInputValue(item.contingencyQuantity));
    setMinimumRaw(toInputValue(item.minimumQuantity));
    setRecommendedRaw(toInputValue(item.recommendedQuantity));
    setSaving(false);
    setError(null);
  }, [
    open,
    item.id,
    item.currentQuantity,
    item.contingencyQuantity,
    item.minimumQuantity,
    item.recommendedQuantity,
  ]);

  if (!open) return null;

  const handleSave = async () => {
    if (saving) return;
    const q = parseCurrentQuantityParameterInput(currentQuantityRaw);
    const c = parseStockLevelParameterInput(contingencyRaw);
    const m = parseStockLevelParameterInput(minimumRaw);
    const r = parseStockLevelParameterInput(recommendedRaw);
    if (!q.ok) {
      setError(
        q.reason === "EMPTY"
          ? "Saldo atual é obrigatório. Informe 0 se estiver zerado."
          : "Saldo atual inválido. Use número decimal ≥ 0."
      );
      return;
    }
    if (!c.ok || !m.ok || !r.ok) {
      setError("Parâmetro inválido. Use número decimal ou deixe vazio (não configurado).");
      return;
    }
    const validation = validateStockParametersForm({
      contingencyQuantity: c.value,
      minimumQuantity: m.value,
      recommendedQuantity: r.value,
    });
    if (validation.ok === false) {
      setError(validation.message);
      return;
    }

    setSaving(true);
    setError(null);
    const body = buildParametersRequestBody({
      currentQuantity: q.value,
      contingencyQuantity: c.value,
      minimumQuantity: m.value,
      recommendedQuantity: r.value,
    });
    if ("currentCost" in body || "freight" in body || "standardLoss" in body) {
      setSaving(false);
      setError("Payload inválido.");
      return;
    }

    const result = await updateMaterialStockParameters({
      materialId: item.id,
      currentQuantity: q.value,
      contingencyQuantity: c.value,
      minimumQuantity: m.value,
      recommendedQuantity: r.value,
    });
    setSaving(false);
    if (result.ok === false) {
      setError(result.message);
      return;
    }
    onSuccess(result.data);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="presentation"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="stock-parameters-dialog-title"
        data-testid="stock-parameters-dialog"
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-xl border border-border bg-card p-4 shadow-sm sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          id="stock-parameters-dialog-title"
          className="text-lg font-semibold text-foreground"
        >
          Parâmetros de nível
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {item.code} — unidade {item.unit}
        </p>
        <p
          className="mt-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
          data-testid="stock-parameters-hint"
        >
          Contingência, mínimo e recomendado <strong>não são somados</strong> ao estoque
          atual. Deixe o campo de nível vazio para “não configurado”. O saldo atual é
          obrigatório (informe 0 se estiver zerado). Esta edição não altera os custos.
        </p>

        <div className="mt-4 space-y-3">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">
              Saldo atual<span className="text-red-600">*</span>
            </span>
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="decimal"
                value={currentQuantityRaw}
                disabled={saving}
                required
                onChange={(e) => {
                  setCurrentQuantityRaw(e.target.value);
                  setError(null);
                }}
                className="min-h-12 flex-1 rounded-lg border border-border bg-background px-3 py-3 text-base tabular-nums outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
                data-testid="stock-parameters-current-quantity"
              />
              <span className="inline-flex min-h-12 items-center rounded-lg border border-border bg-muted px-3 text-sm font-semibold">
                {item.unit}
              </span>
            </div>
          </label>

          {(
            [
              ["Contingência", contingencyRaw, setContingencyRaw, "stock-parameters-contingency"],
              ["Mínimo", minimumRaw, setMinimumRaw, "stock-parameters-minimum"],
              ["Recomendado", recommendedRaw, setRecommendedRaw, "stock-parameters-recommended"],
            ] as const
          ).map(([label, value, setter, testId]) => (
            <label key={testId} className="block space-y-1.5">
              <span className="text-sm font-medium">{label}</span>
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  value={value}
                  disabled={saving}
                  onChange={(e) => {
                    setter(e.target.value);
                    setError(null);
                  }}
                  placeholder="Não configurado"
                  className="min-h-12 flex-1 rounded-lg border border-border bg-background px-3 py-3 text-base tabular-nums outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
                  data-testid={testId}
                />
                <span className="inline-flex min-h-12 items-center rounded-lg border border-border bg-muted px-3 text-sm font-semibold">
                  {item.unit}
                </span>
              </div>
            </label>
          ))}
        </div>

        {error ? (
          <div
            className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
            data-testid="stock-parameters-error"
          >
            {error}
          </div>
        ) : null}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            className="min-h-12 rounded-lg border border-border px-4 py-3 text-sm font-semibold disabled:opacity-50"
            onClick={onClose}
            disabled={saving}
            data-testid="stock-parameters-cancel"
          >
            Cancelar
          </button>
          <button
            type="button"
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            onClick={() => void handleSave()}
            disabled={saving}
            data-testid="stock-parameters-save"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Salvando…
              </>
            ) : (
              "Salvar parâmetros"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
