import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CircleCheck, Clock, FileText, Loader2, Play, RefreshCw, Timer } from "lucide-react";
import { AdminKpiSection, AdminMetricGrid } from "@/src/components/admin/adminUi";
import { MetricCard } from "@/src/components/ui/MetricCard";
import { fetchJsonOk } from "@/src/lib/http";
import {
  formatSyncCardDateTime,
  formatSyncDurationMs,
  formatSyncIntOrDash,
} from "@/src/lib/nomusSyncCardFormat";
import { cn } from "@/src/lib/utils";
import { NOMUS_AR_SYNC_CONFIRM_PHRASE } from "@/src/lib/nomusAccountsReceivableSyncConstants";
import type { NomusAccountsReceivableSyncStatusPayload } from "@/src/lib/nomusAccountsReceivableSyncStatusTypes";
import {
  arOverallStatusBadgeClass,
  arOverallStatusLabel,
  arPrimaryButtonLabel,
} from "@/src/lib/nomusAccountsReceivableSyncStatusTypes";

export function NomusAccountsReceivableSyncCard({
  canRun,
  onLogsRefresh,
}: {
  canRun: boolean;
  onLogsRefresh: () => void;
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
        e instanceof Error
          ? e.message
          : "Não foi possível carregar o status de Contas a Receber Nomus."
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
    }, 15000);
    return () => window.clearInterval(id);
  }, [status?.isActuallyRunning, loadStatus]);

  const handleRefresh = () => {
    void loadStatus();
    onLogsRefresh();
  };

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
      if (res.status === 409) {
        setError(
          body.message ??
            "Já existe uma sincronização de Contas a Receber em andamento. Aguarde finalizar."
        );
        setModalOpen(false);
        void loadStatus();
        return;
      }
      if (!res.ok) {
        throw new Error(body.error ?? "Não foi possível iniciar a sincronização de Contas a Receber.");
      }
      setRunMessage(
        body.message ??
          "Sincronização de Contas a Receber iniciada. Acompanhe o status e os logs abaixo."
      );
      setModalOpen(false);
      setConfirmText("");
      void loadStatus();
      onLogsRefresh();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Não foi possível iniciar a sincronização. Verifique logs do servidor."
      );
    } finally {
      setStarting(false);
    }
  };

  const overall = status?.overallStatus ?? "IDLE";
  const isActuallyRunning = status?.isActuallyRunning === true;
  const confirmOk = confirmText.trim() === NOMUS_AR_SYNC_CONFIRM_PHRASE;
  const buttonLabel = arPrimaryButtonLabel(overall, isActuallyRunning);
  const showSpinnerOnMainButton = isActuallyRunning || starting;
  const metrics = status?.metrics;

  return (
    <>
      <div className="rounded-xl border border-border bg-card/60 p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h4 className="text-base font-bold text-foreground">Contas a Receber Nomus</h4>
            <p className="text-sm text-muted-foreground">
              Rotina isolada de contas a receber (modo apply). Agendamento automático a cada 2 horas;
              upsert completo controlado — não remove registros locais ausentes na API.
            </p>
            <p className="text-xs text-muted-foreground">
              Não inclui clientes, produtos, BOM, propostas ou pedidos. Status «rodando» só com
              processo vivo ou lock dedicado.
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
                title="Executa manualmente somente a sincronização de Contas a Receber Nomus."
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
              "nomus-sync-status-panel rounded-lg border px-3 py-2.5 space-y-2.5",
              arOverallStatusBadgeClass(overall)
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              {isActuallyRunning ? (
                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
              ) : overall === "SUCCESS" ? (
                <CircleCheck className="h-4 w-4 shrink-0" />
              ) : overall === "FAILED" || overall === "STALE" ? (
                <AlertTriangle className="h-4 w-4 shrink-0" />
              ) : null}
              <p className="nomus-sync-status-panel__title">{arOverallStatusLabel(overall)}</p>
              {status.syncStrategy ? (
                <span className="nomus-sync-status-panel__chip font-mono">{status.syncStrategy}</span>
              ) : null}
            </div>
            {status.staleReason ? (
              <p className="text-xs leading-snug opacity-90">{status.staleReason}</p>
            ) : null}
            {status.recommendedAction ? (
              <p className="text-xs leading-snug font-medium opacity-90">{status.recommendedAction}</p>
            ) : null}
            <AdminMetricGrid
              nomusSyncMetrics
              minColumnWidth={140}
              items={[
                { label: "Início", ...formatSyncCardDateTime(status.startedAt), variant: "neutral" },
                { label: "Fim", ...formatSyncCardDateTime(status.finishedAt), variant: "neutral" },
                {
                  label: "Duração",
                  value: formatSyncDurationMs(status.durationMs),
                  variant: "info",
                },
                {
                  label: "Erros",
                  value: formatSyncIntOrDash(metrics?.errors),
                  variant: (metrics?.errors ?? 0) > 0 ? "danger" : "success",
                },
              ]}
            />
            <AdminMetricGrid
              nomusSyncMetrics
              secondary
              minColumnWidth={120}
              items={[
                { label: "Páginas", value: formatSyncIntOrDash(metrics?.pagesRead), variant: "neutral" },
                { label: "Lidos", value: formatSyncIntOrDash(metrics?.recordsRead), variant: "info" },
                { label: "Mapeados", value: formatSyncIntOrDash(metrics?.mapped), variant: "info" },
                { label: "Criados", value: formatSyncIntOrDash(metrics?.created), variant: "success" },
                { label: "Atualizados", value: formatSyncIntOrDash(metrics?.updated), variant: "info" },
                { label: "Inalterados", value: formatSyncIntOrDash(metrics?.unchanged), variant: "neutral" },
              ]}
            />
            <p className="nomus-sync-status-panel__meta">
              Processo vivo: {status.hasLiveProcess ? "sim" : "não"} · Lock ativo:{" "}
              {status.hasActiveLock ? "sim" : "não"}
            </p>
          </div>
        ) : null}

        {runMessage ? <div className="nomus-sync-run-message">{runMessage}</div> : null}

        {error ? <div className="nomus-sync-error-message">{error}</div> : null}

        <AdminKpiSection
          title="Referência da sync Contas a Receber"
          eyebrow="Histórico, logs e periodicidade"
          minColumnWidth={180}
          testId="nomus-ar-sync-kpi"
          embedded
          nomusSyncMetrics
        >
          <MetricCard
            label="Última execução"
            value={
              status?.lastRun
                ? formatSyncCardDateTime(status.lastRun.finishedAt ?? status.lastRun.startedAt).value
                : "Nenhuma execução encontrada"
            }
            subtitle={
              status?.lastRun
                ? [
                    formatSyncCardDateTime(status.lastRun.finishedAt ?? status.lastRun.startedAt)
                      .subtitle,
                    status.lastRun.exitCode != null ? `exit ${status.lastRun.exitCode}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || undefined
                : undefined
            }
            variant="info"
            icon={<Clock className="h-3.5 w-3.5" />}
            compact
          />
          <MetricCard
            label="Último sucesso"
            value={status?.lastSuccess?.fileName ?? "—"}
            subtitle={formatSyncCardDateTime(status?.lastSuccess?.finishedAt).value}
            variant="success"
            icon={<FileText className="h-3.5 w-3.5" />}
            valueWrap
            compact
          />
          <MetricCard
            label="Último log"
            value={status?.lastRunnerLogFile ?? "—"}
            subtitle={status?.runnerLogDir ?? "—"}
            variant="neutral"
            icon={<FileText className="h-3.5 w-3.5" />}
            valueWrap
            compact
          />
          <MetricCard
            label="Periodicidade"
            value="A cada 2 horas"
            subtitle="Cron automático no servidor"
            variant="neutral"
            icon={<Timer className="h-3.5 w-3.5" />}
            compact
          />
        </AdminKpiSection>

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
            aria-labelledby="nomus-ar-sync-title"
          >
            <div>
              <h3 id="nomus-ar-sync-title" className="text-lg font-bold">
                Confirmar Contas a Receber Nomus
              </h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                A rotina roda em modo <strong>apply</strong>, buscando todas as páginas da API e
                fazendo upsert local. Não remove títulos ausentes na API.
              </p>
            </div>
            <div className="space-y-2">
              <label
                htmlFor="nomus-ar-confirm"
                className="text-xs font-bold uppercase text-muted-foreground"
              >
                Digite para confirmar: {NOMUS_AR_SYNC_CONFIRM_PHRASE}
              </label>
              <input
                id="nomus-ar-confirm"
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
