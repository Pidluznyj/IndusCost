/**
 * Modal de Análise de Impacto + Confirmação textual para reclassificar
 * um item (Produto / Componente / Material) no IndusCost.
 *
 * Fase: INDUSCOST-ITEM-RECLASSIFICATION-WORKFLOW-A.
 *
 * Carrega `/api/products/:id/reclassification-impact?targetKind=...` (ou o
 * equivalente para materiais), exibe cards e seções, valida confirmação
 * textual e dispara `POST /api/products/:id/reclassify` quando ok.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ShieldAlert,
  X,
  RefreshCcw,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import { AppAlert } from "@/src/components/shared/AppAlert";
import type {
  ItemReclassificationApplyResult,
  ItemReclassificationImpact,
  ItemReclassificationImpactCard,
  ItemReclassificationKind,
} from "@/src/lib/itemReclassificationTypes";

const KIND_LABEL: Record<ItemReclassificationKind, string> = {
  PRODUCT: "Produto",
  COMPONENT: "Componente",
  MATERIAL: "Material",
};

type ItemReclassificationModalProps = {
  open: boolean;
  /** Identidade do item de origem. Para Product/Component use productId; para Material, materialId. */
  sourceId: string;
  sourceKind: ItemReclassificationKind;
  targetKind: ItemReclassificationKind;
  onClose: () => void;
  onApplied: (result: ItemReclassificationApplyResult) => void;
};

function severityClass(sev: ItemReclassificationImpactCard["severity"]): string {
  switch (sev) {
    case "danger":
      return "border-red-300 bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-100 dark:border-red-900";
    case "warning":
      return "border-amber-300 bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100 dark:border-amber-900";
    default:
      return "border-border bg-card text-foreground";
  }
}

export const ItemReclassificationModal: React.FC<ItemReclassificationModalProps> = ({
  open,
  sourceId,
  sourceKind,
  targetKind,
  onClose,
  onApplied,
}) => {
  const [impact, setImpact] = useState<ItemReclassificationImpact | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationText, setConfirmationText] = useState("");
  const [extraConfirmationText, setExtraConfirmationText] = useState("");
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const impactUrl = useMemo(() => {
    const base =
      sourceKind === "MATERIAL"
        ? `/api/materials/${sourceId}/reclassification-impact`
        : `/api/products/${sourceId}/reclassification-impact`;
    const qs = new URLSearchParams({ targetKind });
    return `${base}?${qs.toString()}`;
  }, [sourceKind, sourceId, targetKind]);

  const loadImpact = useCallback(async () => {
    setLoading(true);
    setError(null);
    setApplyError(null);
    try {
      const data = await fetchJsonOk<ItemReclassificationImpact>(impactUrl);
      setImpact(data);
      setConfirmationText("");
      setExtraConfirmationText("");
    } catch (e) {
      setImpact(null);
      setError(
        e instanceof Error ? e.message : "Erro ao carregar a análise de impacto."
      );
    } finally {
      setLoading(false);
    }
  }, [impactUrl]);

  useEffect(() => {
    if (!open) return;
    void loadImpact();
  }, [open, loadImpact]);

  const requiredConfirmation = impact?.requiredConfirmationText ?? "";
  const extraRequired = impact?.extraConfirmationText ?? null;
  const confirmationOk =
    requiredConfirmation.length > 0 &&
    confirmationText.trim() === requiredConfirmation &&
    (!extraRequired || extraConfirmationText.trim() === extraRequired);

  const canApply =
    !!impact &&
    !applying &&
    !loading &&
    impact.status !== "BLOCKED" &&
    confirmationOk &&
    sourceKind !== "MATERIAL"; // MATERIAL→Produto/Componente está BLOCKED nesta fase

  const handleApply = useCallback(async () => {
    if (!impact || sourceKind === "MATERIAL") return;
    setApplying(true);
    setApplyError(null);
    try {
      const result = await fetchJsonOk<ItemReclassificationApplyResult>(
        `/api/products/${sourceId}/reclassify`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetKind,
            confirmationText: confirmationText.trim(),
            extraConfirmationText: extraConfirmationText.trim() || undefined,
            mode: "SAFE",
          }),
        }
      );
      onApplied(result);
    } catch (e) {
      setApplyError(
        e instanceof Error ? e.message : "Erro ao aplicar a reclassificação."
      );
    } finally {
      setApplying(false);
    }
  }, [
    impact,
    sourceKind,
    sourceId,
    targetKind,
    confirmationText,
    extraConfirmationText,
    onApplied,
  ]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
      <div className="bg-card flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border shadow-2xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-3 bg-accent/30">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className="h-10 w-10 shrink-0 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1 space-y-0.5">
              <h3 className="text-lg font-bold leading-tight">Reclassificar item</h3>
              <p className="text-[12px] text-muted-foreground">
                {KIND_LABEL[sourceKind]} → {KIND_LABEL[targetKind]}. Reveja o impacto
                antes de confirmar.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-accent rounded-full transition-colors shrink-0"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {loading ? (
            <p
              className="text-sm text-muted-foreground inline-flex items-center gap-2"
              aria-busy="true"
              aria-live="polite"
            >
              <Loader2 className="h-4 w-4 animate-spin" /> Calculando impacto…
            </p>
          ) : error ? (
            <AppAlert variant="destructive" title="Análise indisponível" role="alert">
              <p className="text-xs whitespace-pre-wrap break-words opacity-95">{error}</p>
              <div className="mt-2">
                <button
                  type="button"
                  onClick={loadImpact}
                  className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-primary hover:underline"
                >
                  <RefreshCcw className="h-3.5 w-3.5" />
                  Tentar novamente
                </button>
              </div>
            </AppAlert>
          ) : impact ? (
            <>
              {/* Summary */}
              <p className="text-sm">
                <span className="font-semibold text-foreground">{impact.summary}</span>
              </p>

              {/* Cards */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {impact.cards.map((card) => (
                  <div
                    key={card.key}
                    className={cn(
                      "rounded-xl border px-3 py-2 flex flex-col gap-0.5",
                      severityClass(card.severity)
                    )}
                  >
                    <span className="text-[10px] font-bold uppercase tracking-wide opacity-70">
                      {card.label}
                    </span>
                    <span className="text-sm font-bold tabular-nums">{card.value}</span>
                  </div>
                ))}
              </div>

              {/* Warnings */}
              {impact.warnings.length > 0 && (
                <AppAlert variant="warning" role="status">
                  <ul className="space-y-1 text-xs">
                    {impact.warnings.map((w) => (
                      <li key={w.code} className="flex items-start gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        <span>{w.message}</span>
                      </li>
                    ))}
                  </ul>
                </AppAlert>
              )}

              {/* Blocking */}
              {impact.status === "BLOCKED" && impact.blockingReasons.length > 0 && (
                <AppAlert
                  variant="destructive"
                  title="Reclassificação bloqueada"
                  role="alert"
                >
                  <ul className="space-y-1 text-xs">
                    {impact.blockingReasons.map((r) => (
                      <li key={r.code} className="flex items-start gap-1.5">
                        <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        <span>
                          <span className="font-mono text-[10px] opacity-70 mr-1">
                            [{r.code}]
                          </span>
                          {r.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                </AppAlert>
              )}

              {/* Sections */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {impact.sectionsKept.length > 0 && (
                  <Section title="O que será mantido" bullets={impact.sectionsKept} tone="info" />
                )}
                {impact.sectionsChanged.length > 0 && (
                  <Section
                    title="O que será alterado"
                    bullets={impact.sectionsChanged}
                    tone="warning"
                  />
                )}
                {impact.sectionsPreserved.length > 0 && (
                  <Section
                    title="O que será preservado"
                    bullets={impact.sectionsPreserved}
                    tone="info"
                  />
                )}
                {impact.sectionsBlocked.length > 0 && (
                  <Section
                    title="O que está bloqueado"
                    bullets={impact.sectionsBlocked}
                    tone="danger"
                  />
                )}
                {impact.sectionsAtRisk.length > 0 && (
                  <Section
                    title="Pode ser perdido / desvinculado"
                    bullets={impact.sectionsAtRisk}
                    tone="warning"
                  />
                )}
              </div>

              {/* Recommended action */}
              <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
                <span className="font-bold text-primary uppercase tracking-wider text-[10px] mr-1">
                  Recomendação:
                </span>
                {impact.recommendedAction}
              </div>

              {/* Confirmation form */}
              {impact.status !== "BLOCKED" && impact.requiredConfirmationText && (
                <div className="space-y-3 rounded-xl border border-border p-3 bg-accent/15">
                  <label className="block space-y-1 text-xs">
                    <span className="font-semibold text-muted-foreground">
                      Digite exatamente para confirmar:
                    </span>
                    <code className="block text-[12px] bg-background px-2 py-1 rounded border border-border font-mono">
                      {impact.requiredConfirmationText}
                    </code>
                    <input
                      type="text"
                      className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-sm font-mono"
                      value={confirmationText}
                      onChange={(e) => setConfirmationText(e.target.value)}
                      placeholder={impact.requiredConfirmationText}
                      autoComplete="off"
                    />
                  </label>
                  {impact.extraConfirmationText && (
                    <label className="block space-y-1 text-xs">
                      <span className="font-semibold text-muted-foreground">
                        Confirmação adicional (necessária para esta operação):
                      </span>
                      <code className="block text-[12px] bg-background px-2 py-1 rounded border border-border font-mono">
                        {impact.extraConfirmationText}
                      </code>
                      <input
                        type="text"
                        className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-sm font-mono"
                        value={extraConfirmationText}
                        onChange={(e) => setExtraConfirmationText(e.target.value)}
                        placeholder={impact.extraConfirmationText}
                        autoComplete="off"
                      />
                    </label>
                  )}
                </div>
              )}

              {applyError && (
                <AppAlert
                  variant="destructive"
                  title="Não foi possível reclassificar"
                  role="alert"
                >
                  <p className="text-xs whitespace-pre-wrap break-words opacity-95">
                    {applyError}
                  </p>
                </AppAlert>
              )}
            </>
          ) : null}
        </div>

        <div className="px-5 py-3 border-t border-border bg-accent/10 flex items-center justify-between gap-3">
          <p className="text-[11px] text-muted-foreground">
            {impact?.status === "BLOCKED"
              ? "Operação bloqueada. Nenhuma alteração será aplicada."
              : impact?.status === "REQUIRES_CONFIRMATION"
              ? "Operação sensível — confirmação textual obrigatória."
              : impact?.status === "ALLOWED"
              ? "Reclassificação segura."
              : ""}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg font-medium hover:bg-accent transition-colors text-sm"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={!canApply}
              className={cn(
                "inline-flex items-center gap-2 px-5 py-2 rounded-lg font-bold text-sm shadow-lg",
                canApply
                  ? "bg-primary text-primary-foreground hover:opacity-90"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              )}
            >
              {applying ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Aplicando…
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Confirmar reclassificação
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const Section: React.FC<{
  title: string;
  bullets: string[];
  tone: "info" | "warning" | "danger";
}> = ({ title, bullets, tone }) => {
  const toneClass =
    tone === "danger"
      ? "border-red-300 bg-red-50/60 dark:bg-red-950/30"
      : tone === "warning"
      ? "border-amber-300 bg-amber-50/60 dark:bg-amber-950/30"
      : "border-border bg-card";
  return (
    <div className={cn("rounded-xl border px-3 py-2 space-y-1", toneClass)}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      <ul className="space-y-1 text-xs leading-snug">
        {bullets.map((b, idx) => (
          <li key={idx} className="flex items-start gap-1.5">
            <span aria-hidden className="opacity-60 shrink-0 mt-0.5">
              •
            </span>
            <span className="whitespace-pre-wrap break-words">{b}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};
