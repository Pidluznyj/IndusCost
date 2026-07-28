/**
 * Edição dos parâmetros de nível — somente com permissão update.
 * Não altera saldo oficial nem custos.
 */
import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  buildParametersRequestBody,
  parseStockLevelParameterInput,
  updateMaterialStockParameters,
  validateStockParametersForm,
  type MaterialStockParametersApiResult,
} from "@/src/lib/materialStockParametersClient";
import { formatStockConferenceQuantity } from "@/src/lib/materialStockConferenceUi";
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
  const [contingencyRaw, setContingencyRaw] = useState("");
  const [minimumRaw, setMinimumRaw] = useState("");
  const [recommendedRaw, setRecommendedRaw] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setContingencyRaw(toInputValue(item.contingencyQuantity));
    setMinimumRaw(toInputValue(item.minimumQuantity));
    setRecommendedRaw(toInputValue(item.recommendedQuantity));
    setSaving(false);
    setError(null);
  }, [
    open,
    item.id,
    item.contingencyQuantity,
    item.minimumQuantity,
    item.recommendedQuantity,
  ]);

  if (!open) return null;

  const handleSave = async () => {
    if (saving) return;
    const c = parseStockLevelParameterInput(contingencyRaw);
    const m = parseStockLevelParameterInput(minimumRaw);
    const r = parseStockLevelParameterInput(recommendedRaw);
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
      contingencyQuantity: c.value,
      minimumQuantity: m.value,
      recommendedQuantity: r.value,
    });
    // garantia: nunca envia quantity/custos
    if ("quantity" in body || "currentCost" in body) {
      setSaving(false);
      setError("Payload inválido.");
      return;
    }

    const result = await updateMaterialStockParameters({
      materialId: item.id,
      contingencyQuantity: c.value,
      minimumQuantity: m.value,
      recommendedQuantity: r.value,
    });
    setSaving(false);
    if (result.ok === false) {
      setError(result.message);
      return;
    }
    if (result.data.material.quantity !== item.currentQuantity) {
      setError("O servidor alterou o estoque inesperadamente. Recarregue a tela.");
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
          atual. Deixe o campo vazio para “não configurado”. Esta edição não altera o
          saldo nem os custos.
        </p>

        <div className="mt-4 space-y-3">
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

        <p className="mt-3 text-xs text-muted-foreground">
          Estoque atual (somente leitura):{" "}
          <span className="font-semibold tabular-nums text-foreground">
            {formatStockConferenceQuantity(item.currentQuantity)} {item.unit}
          </span>
        </p>

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
