import React from "react";
import { History, Loader2, X } from "lucide-react";
import { cn } from "@/src/lib/utils";
import type { ComponentPerformanceChangeLogItem } from "@/src/lib/componentPerformanceClient";
import {
  formatPerformanceDateTime,
  formatPerformanceNumber,
} from "@/src/lib/componentPerformanceUi";

type Props = {
  open: boolean;
  loading: boolean;
  error: string | null;
  sku: string;
  name: string;
  items: ComponentPerformanceChangeLogItem[];
  onClose: () => void;
};

function fieldLabel(field: string): string {
  switch (field) {
    case "cycleTimeSeconds":
      return "Ciclo (s)";
    case "cavities":
      return "Cavidades";
    case "setupTimeMin":
      return "Setup (min)";
    case "efficiencyExpected":
      return "Eficiência (%)";
    default:
      return field;
  }
}

export function ComponentPerformanceHistoryDrawer({
  open,
  loading,
  error,
  sku,
  name,
  items,
  onClose,
}: Props) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-stretch sm:justify-end bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="component-performance-history-title"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-xl h-[85vh] sm:h-full bg-background border-l border-border shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-4">
          <div className="min-w-0">
            <h3 id="component-performance-history-title" className="text-lg font-bold flex items-center gap-2">
              <History className="h-5 w-5 text-primary shrink-0" />
              Histórico de alterações
            </h3>
            <p className="text-sm text-muted-foreground mt-1 truncate">
              {sku} — {name}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 hover:bg-accent"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Carregando histórico…
            </div>
          ) : error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              {error}
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Nenhuma alteração registrada para este componente.
            </div>
          ) : (
            items.map((entry) => {
              const fields = Array.isArray(entry.changedFields)
                ? entry.changedFields
                : [];
              return (
                <article
                  key={entry.id}
                  className="rounded-xl border border-border bg-card p-4 space-y-3"
                  data-testid="performance-history-entry"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="font-semibold">{formatPerformanceDateTime(entry.changedAt)}</span>
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">
                      {entry.source}
                    </span>
                  </div>
                  <div className="grid gap-1 text-sm">
                    <p>
                      <span className="text-muted-foreground">Responsável informado:</span>{" "}
                      <strong>{entry.responsiblePersonName}</strong>
                    </p>
                    <p>
                      <span className="text-muted-foreground">Usuário logado:</span>{" "}
                      {entry.changedByUserName} ({entry.changedByUserEmail})
                    </p>
                    {entry.note ? (
                      <p>
                        <span className="text-muted-foreground">Observação:</span> {entry.note}
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    {fields.length > 0 ? (
                      fields.map((field) => {
                        const oldVal =
                          field === "cycleTimeSeconds"
                            ? entry.oldCycleTimeSeconds
                            : field === "cavities"
                              ? entry.oldCavities
                              : entry.oldValuesJson?.[field as keyof typeof entry.oldValuesJson] ??
                                null;
                        const newVal =
                          field === "cycleTimeSeconds"
                            ? entry.newCycleTimeSeconds
                            : field === "cavities"
                              ? entry.newCavities
                              : entry.newValuesJson?.[field as keyof typeof entry.newValuesJson] ??
                                null;
                        return (
                          <div
                            key={`${entry.id}-${field}`}
                            className="rounded-lg bg-muted/40 px-3 py-2 text-sm"
                          >
                            <p className="font-medium">{fieldLabel(field)}</p>
                            <p className="text-muted-foreground">
                              {formatPerformanceNumber(oldVal as number | null)}{" "}
                              <span aria-hidden="true">→</span>{" "}
                              <span className="text-foreground font-semibold">
                                {formatPerformanceNumber(newVal as number | null)}
                              </span>
                            </p>
                          </div>
                        );
                      })
                    ) : (
                      <div className="rounded-lg bg-muted/40 px-3 py-2 text-sm">
                        <p className="font-medium">Ciclo / cavidades</p>
                        <p className="text-muted-foreground">
                          {formatPerformanceNumber(entry.oldCycleTimeSeconds)} s /{" "}
                          {formatPerformanceNumber(entry.oldCavities, 0)} cav →{" "}
                          <span className="text-foreground font-semibold">
                            {formatPerformanceNumber(entry.newCycleTimeSeconds)} s /{" "}
                            {formatPerformanceNumber(entry.newCavities, 0)} cav
                          </span>
                        </p>
                      </div>
                    )}
                  </div>
                </article>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export function ComponentPerformanceHistoryDrawerNotice() {
  return (
    <p className="text-xs text-muted-foreground" data-testid="performance-frozen-cost-notice">
      Alterações registradas aqui não recalculam custo publicado nem alteram BOM/Nomus.
    </p>
  );
}
