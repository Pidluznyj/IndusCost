import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CircleCheck, Loader2, Play, RefreshCw } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { NOMUS_AR_SYNC_CONFIRM_PHRASE } from "@/src/lib/nomusAccountsReceivableSyncConstants";
import type { NomusAccountsReceivableSyncStatusPayload } from "@/src/lib/nomusAccountsReceivableSyncStatusTypes";
import {
  arOverallStatusBadgeClass,
  arOverallStatusLabel,
  arPrimaryButtonLabel,
} from "@/src/lib/nomusAccountsReceivableSyncStatusTypes";
import {
  formatFinanceArSyncDurationMs,
  interpretFinanceArSyncRunResponse,
} from "@/src/lib/financeAccountsReceivableSyncRun";
import { formatFinanceDateTime, formatFinanceInteger } from "@/src/lib/financeAccountsReceivableFormat";

function formatIntOrDash(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatFinanceInteger(value);
}

export function FinanceAccountsReceivableSyncPanel({
  canRun,
  onSyncFinished,
}: {
  canRun: boolean;
  onSyncFinished?: () => void;
}) {
  const [status, setStatus] = useState<NomusAccountsReceivableSyncStatusPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [starting, setStarting] = useState(false);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJsonOk<NomusAccountsReceivableSyncStatusPayload>(
        "/api/settings/nomus-sync/accounts-receivable-status"
      );
      setStatus(data);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Não foi possível carregar o status da sync Nomus."
      );
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (!status?.isActuallyRunning) return;
    const id = window.setInterval(() => {
      void loadStatus();
    }, 12000);
    return () => window.clearInterval(id);
  }, [status?.isActuallyRunning, loadStatus]);

  const handleConfirmRun = async () => {
    if (confirmText.trim() !== NOMUS_AR_SYNC_CONFIRM_PHRASE) return;
    setStarting(true);
    setRunMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/settings/nomus-sync/accounts-receivable-run", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      const result = interpretFinanceArSyncRunResponse(res.status, body);
      if (!result.ok) {
        setError(result.message);
        if ("conflict" in result && result.conflict) {
          setModalOpen(false);
        }
        void loadStatus();
        return;
      }
      setRunMessage(result.message);
      setModalOpen(false);
      setConfirmText("");
      void loadStatus();
      onSyncFinished?.();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Não foi possível iniciar a sincronização."
      );
    } finally {
      setStarting(false);
    }
  };

  const overall = status?.overallStatus ?? "IDLE";
  const isActuallyRunning = status?.isActuallyRunning === true;
  const metrics = status?.metrics;
  const confirmOk = confirmText.trim() === NOMUS_AR_SYNC_CONFIRM_PHRASE;

  return (
    <>
      <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Sync Nomus — Contas a Receber
            </p>
            {status ? (
              <div
                className={cn(
                  "inline-flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs",
                  arOverallStatusBadgeClass(overall)
                )}
              >
                {isActuallyRunning ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                ) : overall === "SUCCESS" ? (
                  <CircleCheck className="h-3.5 w-3.5 shrink-0" />
                ) : overall === "FAILED" || overall === "STALE" ? (
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                ) : null}
                <span className="font-bold">{arOverallStatusLabel(overall)}</span>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Status indisponível</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void loadStatus()}
              disabled={loading}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-semibold hover:bg-accent disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Atualizar status
            </button>
            {canRun ? (
              <button
                type="button"
                onClick={() => {
                  setConfirmText("");
                  setModalOpen(true);
                }}
                disabled={isActuallyRunning || starting}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {isActuallyRunning || starting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                {arPrimaryButtonLabel(overall, isActuallyRunning)}
              </button>
            ) : null}
          </div>
        </div>

        {status ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 text-[11px]">
            <Metric label="Última sync" value={formatFinanceDateTime(status.finishedAt ?? status.startedAt)} />
            <Metric label="Duração" value={formatFinanceArSyncDurationMs(status.durationMs)} />
            <Metric label="Lidos" value={formatIntOrDash(metrics?.recordsRead)} />
            <Metric label="Criados" value={formatIntOrDash(metrics?.created)} />
            <Metric label="Atualizados" value={formatIntOrDash(metrics?.updated)} />
            <Metric label="Inalterados" value={formatIntOrDash(metrics?.unchanged)} />
            <Metric label="Erros" value={formatIntOrDash(metrics?.errors)} />
            <Metric label="Estratégia" value={status.syncStrategy ?? "—"} mono />
          </div>
        ) : null}

        {status?.recommendedAction ? (
          <p className="text-xs text-muted-foreground">{status.recommendedAction}</p>
        ) : null}

        {runMessage ? (
          <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-900">
            {runMessage}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            {error}
          </div>
        ) : null}

        {!canRun ? (
          <p className="text-[11px] text-muted-foreground">
            Para rodar sync manualmente é necessária a permissão{" "}
            <span className="font-mono">settings.nomus.sync</span>.
          </p>
        ) : null}
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50">
          <div
            className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-xl space-y-4"
            role="dialog"
            aria-modal="true"
          >
            <div>
              <h3 className="text-lg font-bold">Rodar sync Contas a Receber</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Confirme para disparar a rotina Nomus (modo apply). Se já houver execução em
                andamento, o servidor retornará conflito.
              </p>
            </div>
            <label className="space-y-2 block">
              <span className="text-xs font-bold uppercase text-muted-foreground">
                Digite: {NOMUS_AR_SYNC_CONFIRM_PHRASE}
              </span>
              <input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm font-mono"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                disabled={starting}
                className="h-10 rounded-lg border border-border px-4 text-sm hover:bg-accent"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmRun()}
                disabled={!confirmOk || starting}
                className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                {starting ? "Iniciando…" : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Metric({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-background/80 px-2 py-1.5 min-w-0">
      <p className="text-[10px] uppercase opacity-70 truncate">{label}</p>
      <p className={cn("font-semibold truncate", mono ? "font-mono text-[10px]" : "text-xs")}>{value}</p>
    </div>
  );
}
