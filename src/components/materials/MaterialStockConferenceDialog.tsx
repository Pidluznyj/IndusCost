/**
 * Diálogo de conferência manual — poucos toques, teclado numérico, sem custos.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  createConferenceIdempotencyKey,
  listMaterialStockConferenceReasons,
  MATERIAL_STOCK_CONFERENCE_DEFAULT_REASON,
  parseStockConferenceQuantityInput,
  previewStockConferenceDifference,
  submitMaterialStockConference,
  type MaterialStockConferenceConflictDetails,
  type MaterialStockConferenceApiResult,
} from "@/src/lib/materialStockConferenceClient";
import type { MaterialStockConferenceReason } from "@/src/lib/materialStockConferenceRules";
import {
  formatStockConferenceQuantity,
} from "@/src/lib/materialStockConferenceUi";
import type { MaterialStockTabletListItem } from "@/src/lib/materialStockTabletTypes";

export type MaterialStockConferenceDialogProps = {
  item: MaterialStockTabletListItem;
  open: boolean;
  onClose: () => void;
  onSuccess: (result: MaterialStockConferenceApiResult) => void;
  onReloadRequired: () => void;
};

type ConflictState = MaterialStockConferenceConflictDetails & {
  openedQuantity: number;
};

export function MaterialStockConferenceDialog({
  item,
  open,
  onClose,
  onSuccess,
  onReloadRequired,
}: MaterialStockConferenceDialogProps) {
  const [reportedRaw, setReportedRaw] = useState("");
  const [reason, setReason] = useState<MaterialStockConferenceReason>(
    MATERIAL_STOCK_CONFERENCE_DEFAULT_REASON
  );
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [baselineQuantity, setBaselineQuantity] = useState(item.currentQuantity);
  const [baselineVersion, setBaselineVersion] = useState(item.stockConferenceVersion);
  const [baselineUpdatedAt, setBaselineUpdatedAt] = useState(item.updatedAt);

  const idempotencyKeyRef = useRef(createConferenceIdempotencyKey());
  const inFlightRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setReportedRaw("");
    setReason(MATERIAL_STOCK_CONFERENCE_DEFAULT_REASON);
    setNotes("");
    setSaving(false);
    setError(null);
    setConflict(null);
    setBaselineQuantity(item.currentQuantity);
    setBaselineVersion(item.stockConferenceVersion);
    setBaselineUpdatedAt(item.updatedAt);
    idempotencyKeyRef.current = createConferenceIdempotencyKey();
    inFlightRef.current = false;
    const t = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [open, item.id, item.currentQuantity, item.stockConferenceVersion, item.updatedAt]);

  const preview = useMemo(
    () => previewStockConferenceDifference(baselineQuantity, reportedRaw),
    [baselineQuantity, reportedRaw]
  );
  const parsed = parseStockConferenceQuantityInput(reportedRaw);
  const canSave = parsed.ok && !saving;
  const reasons = listMaterialStockConferenceReasons();

  if (!open) return null;

  const handleSave = async (overrides?: {
    expectedVersion?: number;
    expectedUpdatedAt?: string | null;
    openedQuantity?: number;
  }) => {
    if (inFlightRef.current || saving) return;
    const qty = parseStockConferenceQuantityInput(reportedRaw);
    if (!qty.ok) {
      setError(
        qty.reason === "EMPTY"
          ? "Informe o novo saldo contado."
          : "Saldo inválido. Use apenas números decimais."
      );
      return;
    }

    const expectedVersion = overrides?.expectedVersion ?? baselineVersion;
    const expectedUpdatedAt =
      overrides?.expectedUpdatedAt !== undefined
        ? overrides.expectedUpdatedAt
        : baselineUpdatedAt;
    const openedForConflict = overrides?.openedQuantity ?? baselineQuantity;

    inFlightRef.current = true;
    setSaving(true);
    setError(null);
    setConflict(null);

    const result = await submitMaterialStockConference({
      materialId: item.id,
      reportedQuantity: qty.value,
      reason,
      notes,
      expectedVersion,
      expectedUpdatedAt,
      idempotencyKey: idempotencyKeyRef.current,
    });

    if (result.ok) {
      inFlightRef.current = false;
      setSaving(false);
      onSuccess(result.data);
      onClose();
      return;
    }

    if (result.kind === "conflict") {
      setConflict({
        ...result.conflict,
        openedQuantity: openedForConflict,
        reportedQuantity: qty.value,
      });
      setError(null);
    } else {
      setError(result.message);
      // nova chave para nova tentativa após erro (não reutiliza envio falho sem intenção)
      idempotencyKeyRef.current = createConferenceIdempotencyKey();
    }

    inFlightRef.current = false;
    setSaving(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="presentation"
      data-testid="stock-conference-dialog-backdrop"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="stock-conference-dialog-title"
        data-testid="stock-conference-dialog"
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-xl border border-border bg-card p-4 shadow-sm sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          id="stock-conference-dialog-title"
          className="text-lg font-semibold text-foreground"
        >
          Conferir e atualizar estoque
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {item.code} — {item.description}
        </p>

        <div className="mt-4 space-y-3">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-foreground">
              Novo saldo contado ({item.unit})
            </span>
            <div className="flex items-stretch gap-2">
              <input
                ref={inputRef}
                type="text"
                inputMode="decimal"
                enterKeyHint="done"
                autoComplete="off"
                value={reportedRaw}
                disabled={saving}
                onChange={(e) => {
                  setReportedRaw(e.target.value);
                  setError(null);
                  setConflict(null);
                }}
                placeholder="Ex.: 450,5"
                className="min-h-12 flex-1 rounded-lg border border-border bg-background px-3 py-3 text-base tabular-nums outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
                data-testid="stock-conference-reported-input"
              />
              <span
                className="inline-flex min-h-12 min-w-[3.5rem] items-center justify-center rounded-lg border border-border bg-muted px-3 text-sm font-semibold"
                data-testid="stock-conference-unit"
              >
                {item.unit}
              </span>
            </div>
          </label>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-foreground">Motivo</span>
            <select
              value={reason}
              disabled={saving}
              onChange={(e) =>
                setReason(e.target.value as MaterialStockConferenceReason)
              }
              className="min-h-12 w-full rounded-lg border border-border bg-background px-3 py-3 text-base outline-none disabled:opacity-60"
              data-testid="stock-conference-reason"
            >
              {reasons.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-foreground">
              Observação (opcional)
            </span>
            <textarea
              value={notes}
              disabled={saving}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-border bg-background px-3 py-3 text-base outline-none disabled:opacity-60"
              data-testid="stock-conference-notes"
            />
          </label>

          <div
            className="rounded-lg border border-border bg-muted/40 px-3 py-3 text-sm"
            data-testid="stock-conference-preview"
          >
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Saldo anterior</span>
              <span className="font-semibold tabular-nums">
                {formatStockConferenceQuantity(baselineQuantity)} {item.unit}
              </span>
            </div>
            <div className="mt-2 flex justify-between gap-3">
              <span className="text-muted-foreground">Novo saldo</span>
              <span className="font-semibold tabular-nums">
                {preview.reported == null
                  ? "—"
                  : `${formatStockConferenceQuantity(preview.reported)} ${item.unit}`}
              </span>
            </div>
            <div className="mt-2 flex justify-between gap-3">
              <span className="text-muted-foreground">Diferença</span>
              <span className="font-semibold tabular-nums">
                {preview.difference == null
                  ? "—"
                  : `${formatStockConferenceQuantity(preview.difference)} ${item.unit}`}
              </span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              O estoque oficial só muda após a confirmação do servidor.
            </p>
          </div>

          {error ? (
            <div
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
              data-testid="stock-conference-submit-error"
            >
              {error}
            </div>
          ) : null}

          {conflict ? (
            <div
              className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-950"
              data-testid="stock-conference-conflict"
            >
              <p className="font-semibold">Conflito de atualização (409)</p>
              <p>{conflict.message}</p>
              <dl className="space-y-1">
                <div className="flex justify-between gap-2">
                  <dt>Saldo que você abriu</dt>
                  <dd className="font-semibold tabular-nums">
                    {formatStockConferenceQuantity(conflict.openedQuantity)} {item.unit}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Saldo informado</dt>
                  <dd className="font-semibold tabular-nums">
                    {formatStockConferenceQuantity(conflict.reportedQuantity)} {item.unit}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Saldo atual no servidor</dt>
                  <dd className="font-semibold tabular-nums">
                    {Number.isFinite(conflict.serverQuantity)
                      ? `${formatStockConferenceQuantity(conflict.serverQuantity)} ${item.unit}`
                      : "—"}
                  </dd>
                </div>
              </dl>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  className="min-h-11 rounded-lg border border-amber-400 bg-card px-3 py-2 text-sm font-semibold"
                  data-testid="stock-conference-conflict-reload"
                  onClick={() => {
                    onReloadRequired();
                    onClose();
                  }}
                >
                  Recarregar
                </button>
                <button
                  type="button"
                  className="min-h-11 rounded-lg border border-amber-400 bg-card px-3 py-2 text-sm font-semibold"
                  data-testid="stock-conference-conflict-review"
                  onClick={() => {
                    if (Number.isFinite(conflict.serverQuantity)) {
                      setBaselineQuantity(conflict.serverQuantity);
                    }
                    if (
                      conflict.stockConferenceVersion != null &&
                      Number.isFinite(conflict.stockConferenceVersion)
                    ) {
                      setBaselineVersion(conflict.stockConferenceVersion);
                    }
                    if (conflict.updatedAt) {
                      setBaselineUpdatedAt(conflict.updatedAt);
                    }
                    setConflict(null);
                    idempotencyKeyRef.current = createConferenceIdempotencyKey();
                  }}
                >
                  Revisar
                </button>
                <button
                  type="button"
                  className="min-h-11 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
                  data-testid="stock-conference-conflict-reconfirm"
                  disabled={saving}
                  onClick={() => {
                    const nextVersion =
                      conflict.stockConferenceVersion != null &&
                      Number.isFinite(conflict.stockConferenceVersion)
                        ? conflict.stockConferenceVersion
                        : baselineVersion;
                    const nextUpdatedAt = conflict.updatedAt ?? baselineUpdatedAt;
                    const nextOpened = Number.isFinite(conflict.serverQuantity)
                      ? conflict.serverQuantity
                      : baselineQuantity;
                    if (Number.isFinite(conflict.serverQuantity)) {
                      setBaselineQuantity(conflict.serverQuantity);
                    }
                    setBaselineVersion(nextVersion);
                    setBaselineUpdatedAt(nextUpdatedAt);
                    setConflict(null);
                    idempotencyKeyRef.current = createConferenceIdempotencyKey();
                    void handleSave({
                      expectedVersion: nextVersion,
                      expectedUpdatedAt: nextUpdatedAt,
                      openedQuantity: nextOpened,
                    });
                  }}
                >
                  Nova confirmação
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            className="min-h-12 rounded-lg border border-border px-4 py-3 text-sm font-semibold disabled:opacity-50"
            onClick={onClose}
            disabled={saving}
            data-testid="stock-conference-cancel"
          >
            Cancelar
          </button>
          <button
            type="button"
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            onClick={() => void handleSave()}
            disabled={!canSave || !parsed.ok}
            data-testid="stock-conference-save"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Salvando…
              </>
            ) : (
              "Salvar conferência"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
