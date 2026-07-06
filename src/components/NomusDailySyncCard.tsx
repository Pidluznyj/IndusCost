import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CircleCheck, Loader2, Play, RefreshCw } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { NOMUS_DAILY_SYNC_CONFIRM_PHRASE } from "@/src/lib/nomusDailySyncConstants";
import type { NomusDailySyncStatusPayload } from "@/src/lib/nomusDailySyncStatusTypes";
import {
  overallStatusBadgeClass,
  overallStatusLabel,
  primaryButtonLabel,
} from "@/src/lib/nomusDailySyncStatusTypes";

function formatDateTimeSafe(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR");
}

function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const totalSec = Math.floor(ms / 1000);
  const hh = Math.floor(totalSec / 3600);
  const mm = Math.floor((totalSec % 3600) / 60);
  const ss = totalSec % 60;
  if (hh > 0) return `${hh}h ${mm}m`;
  return `${mm}m ${ss}s`;
}

function targetLabel(target: string): string {
  switch (target) {
    case "customers":
      return "Clientes";
    case "products":
      return "Produtos";
    case "bom-components":
      return "Componentes da BOM";
    case "proposals":
      return "Propostas";
    default:
      return target;
  }
}

export function NomusDailySyncCard({
  canRun,
  onLogsRefresh,
}: {
  canRun: boolean;
  onLogsRefresh: () => void;
}) {
  const [status, setStatus] = useState<NomusDailySyncStatusPayload | null>(null);
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
      const data = await fetchJsonOk<NomusDailySyncStatusPayload>(
        "/api/settings/nomus-sync/daily-status"
      );
      setStatus(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar o status da rotina diária.");
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
    }, 15000);
    return () => window.clearInterval(id);
  }, [status?.isActuallyRunning, loadStatus]);

  const handleRefresh = () => {
    void loadStatus();
    onLogsRefresh();
  };

  const handleConfirmRun = async () => {
    if (confirmText.trim() !== NOMUS_DAILY_SYNC_CONFIRM_PHRASE) return;
    setStarting(true);
    setRunMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/settings/nomus-sync/daily-run", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (res.status === 409) {
        setError(
          body.message ??
            "Já existe uma rotina Nomus em andamento. Aguarde finalizar antes de iniciar outra."
        );
        setModalOpen(false);
        void loadStatus();
        return;
      }
      if (!res.ok) {
        throw new Error(body.error ?? "Não foi possível iniciar a rotina diária Nomus.");
      }
      setRunMessage(
        body.message ?? "Rotina diária Nomus iniciada com sucesso. Acompanhe pelos logs."
      );
      setModalOpen(false);
      setConfirmText("");
      void loadStatus();
      onLogsRefresh();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Não foi possível iniciar a rotina diária Nomus. Verifique logs do servidor."
      );
    } finally {
      setStarting(false);
    }
  };

  const overall = status?.overallStatus ?? "IDLE";
  const isActuallyRunning = status?.isActuallyRunning === true;
  const confirmOk = confirmText.trim() === NOMUS_DAILY_SYNC_CONFIRM_PHRASE;
  const buttonLabel = primaryButtonLabel(overall, isActuallyRunning);
  const showSpinnerOnMainButton = isActuallyRunning || starting;

  return (
    <>
      <div className="rounded-xl border border-border bg-card/60 p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h4 className="text-base font-bold text-foreground">Rotina diária Nomus</h4>
            <p className="text-sm text-muted-foreground">
              Executa clientes, produtos, BOM/components e propostas, igual à rotina automática da
              madrugada (modo apply).
            </p>
            <p className="text-xs text-muted-foreground">
              Não inclui a rotina horária de pedidos de venda. Status «rodando» só com processo vivo
              ou lock ativo — não fica preso por log incompleto.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-accent disabled:opacity-50"
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
                title="Executa manualmente a mesma rotina automática diária que roda de madrugada em modo apply."
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {showSpinnerOnMainButton ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                {buttonLabel}
              </button>
            ) : null}
          </div>
        </div>

        {status ? (
          <div
            className={cn(
              "rounded-lg border px-3 py-2.5 space-y-2",
              overallStatusBadgeClass(overall)
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              {isActuallyRunning ? (
                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
              ) : overall === "SUCCESS" ? (
                <CircleCheck className="h-4 w-4 shrink-0" />
              ) : overall === "PARTIAL_FAILED" || overall === "FAILED" || overall === "STALE" ? (
                <AlertTriangle className="h-4 w-4 shrink-0" />
              ) : null}
              <p className="font-bold text-sm">{overallStatusLabel(overall)}</p>
              {status.ranToday ? (
                <span className="text-[10px] rounded-full border border-current/30 px-2 py-0.5 opacity-80">
                  Houve execução hoje
                </span>
              ) : (
                <span className="text-[10px] rounded-full border border-current/30 px-2 py-0.5 opacity-80">
                  Sem execução hoje
                </span>
              )}
            </div>
            {status.staleReason ? (
              <p className="text-xs leading-snug">{status.staleReason}</p>
            ) : null}
            {status.recommendedAction ? (
              <p className="text-xs leading-snug font-medium">{status.recommendedAction}</p>
            ) : null}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] pt-1">
              <div>
                <span className="opacity-70">Início</span>
                <p className="font-semibold">{formatDateTimeSafe(status.startedAt)}</p>
              </div>
              <div>
                <span className="opacity-70">Etapa (últ./atual)</span>
                <p className="font-semibold">
                  {status.currentOrLastStep ? targetLabel(status.currentOrLastStep) : "—"}
                </p>
              </div>
              <div>
                <span className="opacity-70">Fim</span>
                <p className="font-semibold">{formatDateTimeSafe(status.finishedAt)}</p>
              </div>
              <div>
                <span className="opacity-70">Duração</span>
                <p className="font-semibold">{formatDurationMs(status.durationMs)}</p>
              </div>
            </div>
            <p className="text-[10px] opacity-80">
              Processo vivo: {status.hasLiveProcess ? "sim" : "não"} · Lock ativo:{" "}
              {status.hasActiveLock ? "sim" : "não"}
            </p>
          </div>
        ) : null}

        {status?.failedSteps && status.failedSteps.length > 0 ? (
          <div className="rounded-lg border border-orange-200 bg-orange-50/90 px-3 py-2 text-sm text-orange-950 space-y-1">
            <p className="font-semibold">Etapas com falha</p>
            {status.failedSteps.map((s) => (
              <p key={s.target} className="text-xs">
                <span className="font-bold">{targetLabel(s.target)}</span>
                {s.exitCode != null ? ` · exit ${s.exitCode}` : ""}
                {s.finishedAt ? ` · ${formatDateTimeSafe(s.finishedAt)}` : ""}
                {s.message ? ` — ${s.message}` : ""}
              </p>
            ))}
          </div>
        ) : null}

        {runMessage ? (
          <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
            {runMessage}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
          <div className="rounded-lg border border-border bg-background px-3 py-2">
            <p className="text-[10px] font-bold uppercase text-muted-foreground">Resultado geral</p>
            <p className="mt-1 font-semibold">{overallStatusLabel(overall)}</p>
          </div>
          <div className="rounded-lg border border-border bg-background px-3 py-2">
            <p className="text-[10px] font-bold uppercase text-muted-foreground">Última execução</p>
            {status?.lastRun ? (
              <>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDateTimeSafe(status.lastRun.finishedAt ?? status.lastRun.startedAt)}
                </p>
                {status.lastRun.exitCode != null ? (
                  <p className="text-xs font-mono">exit {status.lastRun.exitCode}</p>
                ) : null}
              </>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">Nenhuma execução diária encontrada</p>
            )}
          </div>
          <div className="rounded-lg border border-border bg-background px-3 py-2">
            <p className="text-[10px] font-bold uppercase text-muted-foreground">Último sucesso</p>
            <p className="mt-1 text-xs font-mono break-all">{status?.lastSuccess?.fileName ?? "—"}</p>
            <p className="text-xs text-muted-foreground">
              {formatDateTimeSafe(status?.lastSuccess?.finishedAt)}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-background px-3 py-2 min-w-0">
            <p className="text-[10px] font-bold uppercase text-muted-foreground">Último log diário</p>
            <p className="mt-1 text-xs font-mono break-all" title={status?.lastRunnerLogFile ?? undefined}>
              {status?.lastRunnerLogFile ?? "—"}
            </p>
            <p className="text-[10px] text-muted-foreground truncate" title={status?.runnerLogDir}>
              {status?.runnerLogDir ?? "—"}
            </p>
          </div>
        </div>

        {!canRun ? (
          <p className="text-xs text-muted-foreground">
            Você não tem permissão para disparar a rotina. Necessária:{" "}
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
            aria-labelledby="nomus-daily-sync-title"
          >
            <div>
              <h3 id="nomus-daily-sync-title" className="text-lg font-bold">
                Confirmar rotina diária Nomus
              </h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                A rotina roda em modo <strong>apply</strong>. Pode atualizar clientes, produtos,
                BOM/components e propostas conforme a integração Nomus.
              </p>
            </div>
            <div className="space-y-2">
              <label htmlFor="nomus-daily-confirm" className="text-xs font-bold uppercase text-muted-foreground">
                Digite para confirmar: {NOMUS_DAILY_SYNC_CONFIRM_PHRASE}
              </label>
              <input
                id="nomus-daily-confirm"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm font-mono"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                disabled={starting}
                className="h-10 rounded-lg border border-border px-4 text-sm font-medium hover:bg-accent"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmRun()}
                disabled={!confirmOk || starting}
                className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {starting ? (
                  <>
                    <Loader2 className="inline h-4 w-4 animate-spin mr-2" />
                    Iniciando…
                  </>
                ) : (
                  "Confirmar e rodar agora"
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
