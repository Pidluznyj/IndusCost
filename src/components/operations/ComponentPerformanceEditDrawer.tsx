import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, Save, X } from "lucide-react";
import { cn } from "@/src/lib/utils";
import type { ComponentPerformanceListItem } from "@/src/lib/componentPerformanceClient";
import {
  OPERATIONS_PERFORMANCE_FROZEN_COST_NOTICE,
  validatePerformanceEditForm,
} from "@/src/lib/componentPerformanceUi";
import { ComponentInjectionCalculationBreakdown } from "@/src/components/product/ComponentInjectionCalculationBreakdown";

type Props = {
  open: boolean;
  item: ComponentPerformanceListItem | null;
  canEdit: boolean;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (payload: {
    cycleTimeSeconds: number;
    cavities: number;
    setupTimeMin: number;
    efficiencyExpected: number;
    responsiblePersonName: string;
    note: string | null;
  }) => void;
};

function fieldNeedsAttention(message: string | null | undefined, token: string): boolean {
  if (!message) return false;
  return message.toLowerCase().includes(token.toLowerCase());
}

export function ComponentPerformanceEditDrawer({
  open,
  item,
  canEdit,
  saving,
  error,
  onClose,
  onSave,
}: Props) {
  const [cycleTimeSeconds, setCycleTimeSeconds] = useState("");
  const [cavities, setCavities] = useState("");
  const [setupTimeMin, setSetupTimeMin] = useState("");
  const [efficiencyExpected, setEfficiencyExpected] = useState("");
  const [responsiblePersonName, setResponsiblePersonName] = useState("");
  const [note, setNote] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const setupInputRef = useRef<HTMLInputElement>(null);
  const formScrollRef = useRef<HTMLDivElement>(null);

  const setupMissingOnItem = item?.process.setupTimeMin == null;
  const efficiencyMissingOnItem = item?.process.efficiencyExpected == null;
  const displayError = validationError || error;

  useEffect(() => {
    if (!open || !item) return;
    setCycleTimeSeconds(
      item.process.cycleTimeSeconds != null ? String(item.process.cycleTimeSeconds) : ""
    );
    setCavities(item.process.cavities != null ? String(item.process.cavities) : "");
    // Setup ausente no cadastro bloqueava o save — default 0 para completar o processo padrão.
    setSetupTimeMin(
      item.process.setupTimeMin != null ? String(item.process.setupTimeMin) : "0"
    );
    setEfficiencyExpected(
      item.process.efficiencyExpected != null
        ? String(item.process.efficiencyExpected)
        : "100"
    );
    setResponsiblePersonName("");
    setNote("");
    setValidationError(null);
  }, [open, item]);

  useEffect(() => {
    if (!open || !displayError) return;
    if (!fieldNeedsAttention(displayError, "setup")) return;
    const node = setupInputRef.current;
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    node.focus({ preventScroll: true });
  }, [open, displayError]);

  if (!open || !item) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const message = validatePerformanceEditForm({
      responsiblePersonName,
      cycleTimeSeconds,
      cavities,
      setupTimeMin,
      efficiencyExpected,
    });
    if (message) {
      setValidationError(message);
      if (fieldNeedsAttention(message, "setup")) {
        setupInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        setupInputRef.current?.focus({ preventScroll: true });
      } else {
        formScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      }
      return;
    }
    setValidationError(null);
    onSave({
      cycleTimeSeconds: Number(cycleTimeSeconds),
      cavities: Number(cavities),
      setupTimeMin: Number(setupTimeMin),
      efficiencyExpected: Number(efficiencyExpected),
      responsiblePersonName: responsiblePersonName.trim(),
      note: note.trim() || null,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-stretch sm:justify-end bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="component-performance-edit-title"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-lg h-[90vh] sm:h-full bg-background border-l border-border shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-4">
          <div className="min-w-0">
            <h3 id="component-performance-edit-title" className="text-lg font-bold">
              Editar performance
            </h3>
            <p className="text-sm text-muted-foreground mt-1 truncate">
              {item.sku} — {item.name}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-accent" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div ref={formScrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
            <div
              className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
              data-testid="performance-frozen-cost-notice"
            >
              {OPERATIONS_PERFORMANCE_FROZEN_COST_NOTICE}
            </div>

            {setupMissingOnItem || efficiencyMissingOnItem ? (
              <div
                className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-950 flex gap-2"
                data-testid="performance-incomplete-process-notice"
              >
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  Processo padrão incompleto no cadastro
                  {setupMissingOnItem ? ": setup (minutos) ausente" : ""}
                  {setupMissingOnItem && efficiencyMissingOnItem ? " e " : ""}
                  {efficiencyMissingOnItem ? `${setupMissingOnItem ? "" : ": "}eficiência ausente` : ""}
                  . Informe os valores abaixo (use <strong>0</strong> no setup se não houver tempo de
                  setup).
                </span>
              </div>
            ) : null}

            {item.routingStepCount > 0 ? (
              <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-900 flex gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  Este componente possui roteiro cadastrado ({item.routingStepCount} operação(ões)).
                  O motor de custo pode priorizar o roteiro em vez do processo padrão.
                </span>
              </div>
            ) : null}

            {!canEdit ? (
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                Você possui permissão de visualização, mas não pode registrar alterações.
              </div>
            ) : null}

            <div>
              <p className="text-xs font-bold uppercase text-muted-foreground mb-2">Valores atuais</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold uppercase text-muted-foreground">Ciclo (s)</label>
                  <p className="mt-1 text-sm font-medium tabular-nums">
                    {item.process.cycleTimeSeconds ?? "—"}
                  </p>
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-muted-foreground">Cavidades</label>
                  <p className="mt-1 text-sm font-medium tabular-nums">{item.process.cavities ?? "—"}</p>
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-muted-foreground">Setup (min)</label>
                  <p className="mt-1 text-sm font-medium tabular-nums">
                    {item.process.setupTimeMin ?? "—"}
                  </p>
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-muted-foreground">Eficiência (%)</label>
                  <p className="mt-1 text-sm font-medium tabular-nums">
                    {item.process.efficiencyExpected ?? "—"}
                  </p>
                </div>
              </div>
            </div>

            <div>
              <p className="text-xs font-bold uppercase text-muted-foreground mb-2">
                Novos valores *
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="perf-cycle" className="text-xs font-bold uppercase text-muted-foreground">
                    Ciclo (s)
                  </label>
                  <input
                    id="perf-cycle"
                    type="number"
                    step="0.1"
                    min="0"
                    disabled={!canEdit || saving}
                    value={cycleTimeSeconds}
                    onChange={(e) => setCycleTimeSeconds(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="perf-cav" className="text-xs font-bold uppercase text-muted-foreground">
                    Cavidades
                  </label>
                  <input
                    id="perf-cav"
                    type="number"
                    min="1"
                    step="1"
                    disabled={!canEdit || saving}
                    value={cavities}
                    onChange={(e) => setCavities(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="perf-setup" className="text-xs font-bold uppercase text-muted-foreground">
                    Setup (min) *
                  </label>
                  <input
                    ref={setupInputRef}
                    id="perf-setup"
                    type="number"
                    step="0.1"
                    min="0"
                    disabled={!canEdit || saving}
                    value={setupTimeMin}
                    onChange={(e) => setSetupTimeMin(e.target.value)}
                    className={cn(
                      "mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm",
                      setupMissingOnItem || fieldNeedsAttention(displayError, "setup")
                        ? "border-rose-400 ring-1 ring-rose-200"
                        : "border-border"
                    )}
                    data-testid="performance-edit-setup"
                    aria-invalid={setupMissingOnItem || fieldNeedsAttention(displayError, "setup")}
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Obrigatório. Use 0 se não houver setup.
                  </p>
                </div>
                <div>
                  <label htmlFor="perf-eff" className="text-xs font-bold uppercase text-muted-foreground">
                    Eficiência (%) *
                  </label>
                  <input
                    id="perf-eff"
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    disabled={!canEdit || saving}
                    value={efficiencyExpected}
                    onChange={(e) => setEfficiencyExpected(e.target.value)}
                    className={cn(
                      "mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm",
                      efficiencyMissingOnItem || fieldNeedsAttention(displayError, "efici")
                        ? "border-rose-400 ring-1 ring-rose-200"
                        : "border-border"
                    )}
                    data-testid="performance-edit-efficiency"
                  />
                </div>
              </div>
            </div>

            <div>
              <label htmlFor="perf-responsible" className="text-xs font-bold uppercase text-muted-foreground">
                Responsável pela alteração *
              </label>
              <input
                id="perf-responsible"
                type="text"
                disabled={!canEdit || saving}
                value={responsiblePersonName}
                onChange={(e) => setResponsiblePersonName(e.target.value)}
                placeholder="Ex.: João da Produção"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label htmlFor="perf-note" className="text-xs font-bold uppercase text-muted-foreground">
                Motivo / observação
              </label>
              <textarea
                id="perf-note"
                rows={3}
                disabled={!canEdit || saving}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ex.: Redução de ciclo após ajuste de processo"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none"
              />
            </div>

            <details className="rounded-xl border border-border bg-card overflow-hidden" open={false}>
              <summary className="cursor-pointer select-none bg-muted px-4 py-3 text-sm font-bold list-none flex items-center justify-between">
                <span>Cálculo da injeção (informativo)</span>
                <span className="text-xs font-medium text-muted-foreground">Exibir / ocultar</span>
              </summary>
              <div className="px-2 pb-2">
                <ComponentInjectionCalculationBreakdown
                  cycleTimeSeconds={cycleTimeSeconds}
                  cavities={cavities}
                  efficiencyExpectedPercent={efficiencyExpected || item.process.efficiencyExpected || 100}
                  disabled={!canEdit}
                />
              </div>
            </details>
          </div>

          <div className="border-t border-border p-4 space-y-3">
            {displayError ? (
              <p
                className="text-sm text-destructive"
                data-testid="performance-edit-validation"
                role="alert"
              >
                {displayError}
              </p>
            ) : null}
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-accent"
              >
                Cancelar
              </button>
              {canEdit ? (
                <button
                  type="submit"
                  disabled={saving}
                  className={cn(
                    "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold",
                    "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                  )}
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Salvar alteração
                </button>
              ) : null}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
