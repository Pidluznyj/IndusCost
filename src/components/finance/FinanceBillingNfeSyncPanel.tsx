import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CircleCheck, Loader2, Play, RefreshCw } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { NOMUS_NFE_SYNC_CONFIRM_PHRASE } from "@/src/lib/nomusNfesSyncConstants";
import type { NomusNfesSyncStatusPayload } from "@/src/lib/nomusNfesSyncStatusTypes";
import {
  nfeOverallStatusBadgeClass,
  nfeOverallStatusLabel,
  nfePrimaryButtonLabel,
} from "@/src/lib/nomusNfesSyncStatusTypes";
import { interpretFinanceBillingNfeSyncRunResponse } from "@/src/lib/financeBillingNfeSyncRun";
import { formatFinanceDateTime, formatFinanceInteger } from "@/src/lib/financeAccountsPayableFormat";

function formatIntOrDash(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatFinanceInteger(value);
}

export function FinanceBillingNfeSyncPanel({
  canRun,
  onSyncFinished,
  embedded = false,
}: {
  canRun: boolean;
  onSyncFinished?: () => void;
  embedded?: boolean;
}) {
  const [status, setStatus] = useState<NomusNfesSyncStatusPayload | null>(null);
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
      const data = await fetchJsonOk<NomusNfesSyncStatusPayload>("/api/finance/billing/sync-status");
      setStatus(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar o status da sync de NF-e.");
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
    if (confirmText.trim() !== NOMUS_NFE_SYNC_CONFIRM_PHRASE) return;
    setStarting(true);
    setRunMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/finance/billing/sync", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      const result = interpretFinanceBillingNfeSyncRunResponse(res.status, body);
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
      setError(e instanceof Error ? e.message : "Não foi possível iniciar a sincronização.");
    } finally {
      setStarting(false);
    }
  };

  const overall = status?.overallStatus ?? "IDLE";
  const isRunning = Boolean(status?.isActuallyRunning);

  return (
  <>
    <section
      className={
        embedded
          ? "space-y-3"
          : "rounded-xl border border-border bg-card/50 p-4 space-y-3"
      }
      data-testid={embedded ? "finance-billing-nfe-sync-panel-embedded" : "finance-billing-nfe-sync-panel"}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Sincronização NF-e Nomus
          </p>
          <p className="text-[11px] text-muted-foreground max-w-2xl">
            Faturamento calculado com base nas NF-e do Nomus. Data fiscal considerada: emissão da NF
            no XML, quando disponível.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void loadStatus()}
            disabled={loading}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-semibold hover:bg-accent disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Atualizar status
          </button>
          {canRun ? (
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              disabled={isRunning || starting}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {isRunning || starting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              {nfePrimaryButtonLabel(overall, isRunning)}
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50/80 px-3 py-2 text-xs text-red-900 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      ) : null}

      {runMessage ? (
        <div className="rounded-lg border border-green-200 bg-green-50/80 px-3 py-2 text-xs text-green-900 flex items-start gap-2">
          <CircleCheck className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{runMessage}</span>
        </div>
      ) : null}

      {status ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div className="rounded-lg border border-border/60 bg-background/40 p-3 space-y-1">
            <p className="text-[10px] font-bold uppercase text-muted-foreground">Status</p>
            <span
              className={cn(
                "inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold",
                nfeOverallStatusBadgeClass(overall)
              )}
            >
              {nfeOverallStatusLabel(overall)}
            </span>
          </div>
          <div className="rounded-lg border border-border/60 bg-background/40 p-3 space-y-1">
            <p className="text-[10px] font-bold uppercase text-muted-foreground">Última execução</p>
            <p className="font-semibold text-foreground">
              {status.lastSuccess?.finishedAt
                ? formatFinanceDateTime(status.lastSuccess.finishedAt)
                : status.finishedAt
                  ? formatFinanceDateTime(status.finishedAt)
                  : "—"}
            </p>
          </div>
          <div className="rounded-lg border border-border/60 bg-background/40 p-3 space-y-1">
            <p className="text-[10px] font-bold uppercase text-muted-foreground">Registros</p>
            <p className="font-semibold text-foreground">
              {formatIntOrDash(status.metrics.mapped)} mapeados ·{" "}
              {formatIntOrDash(status.metrics.created)} novos ·{" "}
              {formatIntOrDash(status.metrics.updated)} atualizados
            </p>
          </div>
          <div className="rounded-lg border border-border/60 bg-background/40 p-3 space-y-1">
            <p className="text-[10px] font-bold uppercase text-muted-foreground">Estratégia</p>
            <p className="font-semibold text-foreground">{status.syncStrategy ?? "—"}</p>
          </div>
        </div>
      ) : null}

      {!canRun ? (
        <p className="text-[11px] text-muted-foreground">
          Para executar manualmente, é necessária a permissão{" "}
          <span className="font-mono">settings.nomus.sync</span>.
        </p>
      ) : null}
    </section>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-lg space-y-4">
            <h4 className="text-sm font-bold text-foreground">Confirmar sincronização de NF-e</h4>
            <p className="text-xs text-muted-foreground">
              Digite <span className="font-mono font-semibold">{NOMUS_NFE_SYNC_CONFIRM_PHRASE}</span>{" "}
              para iniciar a rotina oficial de NF-e Nomus.
            </p>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono"
              placeholder={NOMUS_NFE_SYNC_CONFIRM_PHRASE}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setModalOpen(false);
                  setConfirmText("");
                }}
                className="h-9 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-accent"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmRun()}
                disabled={confirmText.trim() !== NOMUS_NFE_SYNC_CONFIRM_PHRASE || starting}
                className="h-9 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
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
