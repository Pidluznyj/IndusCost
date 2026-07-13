import React, { useEffect, useState } from "react";
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
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div
              className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
              data-testid="performance-frozen-cost-notice"
            >
              {OPERATIONS_PERFORMANCE_FROZEN_COST_NOTICE}
            </div>

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

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold uppercase text-muted-foreground">Ciclo atual (s)</label>
                <p className="mt-1 text-sm font-medium tabular-nums">
                  {item.process.cycleTimeSeconds ?? "—"}
                </p>
              </div>
              <div>
                <label className="text-xs font-bold uppercase text-muted-foreground">Cavidades atuais</label>
                <p className="mt-1 text-sm font-medium tabular-nums">{item.process.cavities ?? "—"}</p>
              </div>
              <div>
                <label className="text-xs font-bold uppercase text-muted-foreground">Setup atual (min)</label>
                <p className="mt-1 text-sm font-medium tabular-nums">
                  {item.process.setupTimeMin ?? "—"}
                </p>
              </div>
              <div>
                <label className="text-xs font-bold uppercase text-muted-foreground">Eficiência atual (%)</label>
                <p className="mt-1 text-sm font-medium tabular-nums">
                  {item.process.efficiencyExpected ?? "—"}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="perf-cycle" className="text-xs font-bold uppercase text-muted-foreground">
                  Novo ciclo (s)
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
                  Novas cavidades
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
                  Novo setup (min) *
                </label>
                <input
                  id="perf-setup"
                  type="number"
                  step="0.1"
                  min="0"
                  disabled={!canEdit || saving}
                  value={setupTimeMin}
                  onChange={(e) => setSetupTimeMin(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  data-testid="performance-edit-setup"
                />
              </div>
              <div>
                <label htmlFor="perf-eff" className="text-xs font-bold uppercase text-muted-foreground">
                  Nova eficiência (%) *
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
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  data-testid="performance-edit-efficiency"
                />
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

            <ComponentInjectionCalculationBreakdown
              cycleTimeSeconds={cycleTimeSeconds}
              cavities={cavities}
              efficiencyExpectedPercent={efficiencyExpected || item.process.efficiencyExpected || 100}
              disabled={!canEdit}
            />

            {validationError ? (
              <p className="text-sm text-destructive" data-testid="performance-edit-validation">
                {validationError}
              </p>
            ) : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>

          <div className="border-t border-border p-4 flex gap-2 justify-end">
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
        </form>
      </div>
    </div>
  );
}
