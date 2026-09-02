/**
 * OP-26 — Formulário ÚNICO de avaliação do fornecedor pelo Pedido de Compra.
 * Usado no detalhe do pedido e na avaliação retroativa dentro do fornecedor.
 *
 * A nota calculada exibida vem do MESMO motor puro do backend
 * (`computeSupplierOrderEvaluation`) — a UI não implementa fórmula própria e
 * nunca envia `overallScore`: o servidor é a autoridade.
 */

import React, { useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  SUPPLIER_EVALUATION_CRITERIA,
  SUPPLIER_EVALUATION_NOTES_MAX_LENGTH,
  SUPPLIER_EVALUATION_REVISION_REASON_MAX_LENGTH,
  computeSupplierOrderEvaluation,
  formatSupplierScore,
  type PurchaseOrderSupplierEvaluationDto,
  type PurchaseOrderSupplierEvaluationResponse,
  type SupplierEvaluationCriterionKey,
} from "@/src/lib/purchasing/supplierPerformance";
import { savePurchaseOrderSupplierEvaluationRequest } from "@/src/lib/purchasing/supplierPerformanceClient";

const FIELD_LABEL = "text-xs font-bold uppercase text-muted-foreground";
const FIELD_INPUT =
  "w-full rounded-lg border border-border bg-background p-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60";

type ScoreDraft = Record<SupplierEvaluationCriterionKey, string>;

const EMPTY_DRAFT: ScoreDraft = {
  quality: "",
  delivery: "",
  conformity: "",
  service: "",
};

function draftFromEvaluation(
  evaluation: PurchaseOrderSupplierEvaluationDto | null
): ScoreDraft {
  if (!evaluation) return EMPTY_DRAFT;
  const asText = (v: number) => String(v).replace(".", ",");
  return {
    quality: asText(evaluation.scores.quality),
    delivery: asText(evaluation.scores.delivery),
    conformity: asText(evaluation.scores.conformity),
    service: asText(evaluation.scores.service),
  };
}

type Props = {
  purchaseOrderId: string;
  purchaseOrderCode?: string | null;
  supplierName?: string | null;
  /** null = primeira avaliação; preenchido = revisão (exige motivo). */
  evaluation: PurchaseOrderSupplierEvaluationDto | null;
  onCancel: () => void;
  onSaved: (payload: PurchaseOrderSupplierEvaluationResponse) => void;
};

export function PurchaseOrderSupplierEvaluationForm({
  purchaseOrderId,
  purchaseOrderCode,
  supplierName,
  evaluation,
  onCancel,
  onSaved,
}: Props) {
  const isRevision = evaluation != null;
  const [draft, setDraft] = useState<ScoreDraft>(() => draftFromEvaluation(evaluation));
  const [notes, setNotes] = useState(evaluation?.notes ?? "");
  const [revisionReason, setRevisionReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(() => {
    try {
      return computeSupplierOrderEvaluation({
        qualityScore: draft.quality,
        deliveryScore: draft.delivery,
        conformityScore: draft.conformity,
        serviceScore: draft.service,
      });
    } catch {
      return null;
    }
  }, [draft]);

  const canSubmit =
    preview != null && !saving && (!isRevision || revisionReason.trim().length > 0);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!preview) {
      setError("Informe as quatro notas de 0 a 10 com no máximo uma casa decimal.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = await savePurchaseOrderSupplierEvaluationRequest(purchaseOrderId, {
        qualityScore: preview.scores.quality,
        deliveryScore: preview.scores.delivery,
        conformityScore: preview.scores.conformity,
        serviceScore: preview.scores.service,
        notes: notes.trim() ? notes.trim() : null,
        expectedRevision: evaluation ? evaluation.revision : null,
        ...(isRevision ? { revisionReason: revisionReason.trim() } : {}),
      });
      onSaved(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar a avaliação.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="space-y-4"
      onSubmit={submit}
      data-testid="supplier-order-evaluation-form"
    >
      <div>
        <h4 className="text-sm font-bold">
          {isRevision ? "Revisar avaliação" : "Avaliar fornecedor"}
        </h4>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {purchaseOrderCode ? `Pedido ${purchaseOrderCode}` : "Pedido de compra"}
          {supplierName ? ` · ${supplierName}` : ""} · notas de 0 a 10, uma casa decimal.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {SUPPLIER_EVALUATION_CRITERIA.map((criterion) => (
          <label key={criterion.key} className="space-y-1">
            <span className={FIELD_LABEL}>{criterion.label}</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={10}
              step={0.1}
              required
              disabled={saving}
              className={FIELD_INPUT}
              data-testid={`supplier-evaluation-score-${criterion.key}`}
              value={draft[criterion.key]}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, [criterion.key]: e.target.value }))
              }
            />
          </label>
        ))}
      </div>

      <label className="block space-y-1">
        <span className={FIELD_LABEL}>Observações (opcional)</span>
        <textarea
          rows={3}
          disabled={saving}
          maxLength={SUPPLIER_EVALUATION_NOTES_MAX_LENGTH}
          className={FIELD_INPUT}
          data-testid="supplier-evaluation-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>

      {isRevision ? (
        <label className="block space-y-1">
          <span className={FIELD_LABEL}>Motivo da revisão (obrigatório)</span>
          <input
            type="text"
            required
            disabled={saving}
            maxLength={SUPPLIER_EVALUATION_REVISION_REASON_MAX_LENGTH}
            className={FIELD_INPUT}
            data-testid="supplier-evaluation-revision-reason"
            placeholder="Ex.: Correção após conferência do pedido com o comprador."
            value={revisionReason}
            onChange={(e) => setRevisionReason(e.target.value)}
          />
        </label>
      ) : null}

      <div className="rounded-xl border border-border bg-accent/20 px-4 py-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Nota calculada
        </p>
        <p
          className="mt-1 text-2xl font-bold tabular-nums"
          data-testid="supplier-evaluation-overall-preview"
        >
          {formatSupplierScore(preview ? preview.overallScore : null)}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Média aritmética dos quatro critérios (25% cada). Confirmada pelo servidor ao salvar.
        </p>
      </div>

      {error ? (
        <div
          className="flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          data-testid="supplier-evaluation-error"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          data-testid="supplier-evaluation-save"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-2 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {isRevision ? "Salvar revisão" : "Salvar avaliação"}
        </button>
      </div>
    </form>
  );
}
