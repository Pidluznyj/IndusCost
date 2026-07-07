import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CircleCheck, Loader2, Play, RefreshCw } from "lucide-react";
import { AdminMetricGrid } from "@/src/components/admin/adminUi";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { NOMUS_AP_SYNC_CONFIRM_PHRASE } from "@/src/lib/nomusAccountsPayableSyncConstants";
import type { NomusAccountsPayableSyncStatusPayload } from "@/src/lib/nomusAccountsPayableSyncStatusTypes";
import {
  apOverallStatusBadgeClass,
  apOverallStatusLabel,
  apPrimaryButtonLabel,
} from "@/src/lib/nomusAccountsPayableSyncStatusTypes";
import {
  formatFinanceApSyncDurationMs,
  interpretFinanceApSyncRunResponse,
} from "@/src/lib/financeAccountsPayableSyncRun";
import { formatFinanceDateTime, formatFinanceInteger } from "@/src/lib/financeAccountsPayableFormat";

function formatIntOrDash(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatFinanceInteger(value);
}

export function FinanceAccountsPayableSyncPanel({
  canRun,
  onSyncFinished,
  embedded = false,
}: {
  canRun: boolean;
  onSyncFinished?: () => void;
  embedded?: boolean;
}) {
  const [status, setStatus] = useState<NomusAccountsPayableSyncStatusPayload | null>(null);
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
      const data = await fetchJsonOk<NomusAccountsPayableSyncStatusPayload>(
        "/api/settings/nomus-sync/accounts-payable-status"
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
    if (confirmText.trim() !== NOMUS_AP_SYNC_CONFIRM_PHRASE) return;
    setStarting(true);
    setRunMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/settings/nomus-sync/accounts-payable-run", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      const result = interpretFinanceApSyncRunResponse(res.status, body);
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
  const confirmOk = confirmText.trim() === NOMUS_AP_SYNC_CONFIRM_PHRASE;

  return (
    <>
      <div
        className={
          embedded
            ? "space-y-3"
            : "rounded-xl border border-border bg-card/50 p-4 space-y-3"
        }
        data-testid={embedded ? "finance-ap-sync-panel-embedded" : "finance-ap-sync-panel"}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Sync Nomus — Contas a Pagar
            </p>
            {status ? (
              <div
                className={cn(
                  "inline-flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs",
                  apOverallStatusBadgeClass(overall)
                )}
              >
                {isActuallyRunning ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                ) : overall === "SUCCESS" ? (
                  <CircleCheck className="h-3.5 w-3.5 shrink-0" />
                ) : overall === "FAILED" || overall === "STALE" ? (
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                ) : null}
                <span className="font-bold">{apOverallStatusLabel(overall)}</span>
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
                {apPrimaryButtonLabel(overall, isActuallyRunning)}
              </button>
            ) : null}
          </div>
        </div>

        {status ? (
          <AdminMetricGrid
            minColumnWidth={132}
            testId="finance-ap-sync-metrics"
            items={[
              { label: "Última sync", value: formatFinanceDateTime(status.finishedAt ?? status.startedAt), variant: "info" },
              { label: "Duração", value: formatFinanceApSyncDurationMs(status.durationMs), variant: "neutral" },
              { label: "Lidos", value: formatIntOrDash(metrics?.recordsRead), variant: "info" },
              { label: "Criados", value: formatIntOrDash(metrics?.created), variant: "success" },
              { label: "Atualizados", value: formatIntOrDash(metrics?.updated), variant: "info" },
              { label: "Inalterados", value: formatIntOrDash(metrics?.unchanged), variant: "neutral" },
              {
                label: "Erros",
                value: formatIntOrDash(metrics?.errors),
                variant: (metrics?.errors ?? 0) > 0 ? "danger" : "success",
              },
              { label: "Estratégia", value: status.syncStrategy ?? "—", variant: "neutral" },
            ]}
          />
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
              <h3 className="text-lg font-bold">Rodar sync Contas a Pagar</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Confirme para disparar a rotina Nomus (modo apply). Se já houver execução em
                andamento, o servidor retornará conflito.
              </p>
            </div>
            <label className="space-y-2 block">
              <span className="text-xs font-bold uppercase text-muted-foreground">
                Digite: {NOMUS_AP_SYNC_CONFIRM_PHRASE}
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
