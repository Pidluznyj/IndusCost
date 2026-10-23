import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CircleCheck, Eye, Loader2, Play, RefreshCw, ShieldCheck } from "lucide-react";
import { AdminMetricGrid } from "@/src/components/admin/adminUi";
import { fetchJsonOk } from "@/src/lib/http";
import {
  formatSyncCardDateTime,
  formatSyncCardDateTimeLine,
  formatSyncDurationMs,
  formatSyncIntOrDash,
} from "@/src/lib/nomusSyncCardFormat";
import { cn } from "@/src/lib/utils";
import { NOMUS_PO_RECONCILE_AUTHORIZE_PHRASE } from "@/src/lib/nomus/nomusPurchaseOrderSyncHealth";
import {
  PURCHASE_ORDER_RUN_STATUS_LABEL,
  PURCHASE_ORDER_SKIP_REASON_LABEL,
  PURCHASE_ORDER_STRATEGY_LABEL,
  PURCHASE_ORDER_TRIGGER_LABEL,
  purchaseOrderSyncOverallLabel,
  purchaseOrderSyncOverallTone,
} from "@/src/lib/nomus/nomusPurchaseOrderSyncUi";

type RunSummary = {
  trigger?: string;
  skipReason?: string;
  scheduleDelaySeconds?: number | null;
  completeness?: { payloadComplete?: boolean; reasons?: string[] };
  alerts?: Array<{ code: string; severity: string; message: string }>;
  previewOnly?: boolean;
  absenceWritesApplied?: boolean;
  missingCandidatesSample?: Array<{ externalId: number; orderNumber: string | null; reason: string }>;
  missingConfirmedSample?: Array<{ externalId: number; orderNumber: string | null; reason: string }>;
  plan?: { counters?: { missingCandidates?: number; missingConfirmed?: number } };
};

type RunDto = {
  id: string;
  status: string;
  strategy: string;
  preview: boolean;
  countsAsSuccess: boolean;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  payloadComplete: boolean;
  pagesRead: number;
  rowsRead: number;
  created: number;
  updated: number;
  unchanged: number;
  missingCandidates: number;
  missingConfirmed: number;
  reactivated: number;
  http429: number;
  errors: number;
  errorMessage: string | null;
  summary: RunSummary | null;
};

type StatusDto = {
  overallStatus: string;
  staleReason: string | null;
  staleHours: number;
  hoursSinceLastSuccess: number | null;
  isRunning: boolean;
  schedule: {
    activeSource: "chain" | "independent";
    cronInstalled: boolean;
    cronFile: string;
    nextHourlyAt: string | null;
    nextDailyAt: string | null;
    chainAfterArEnabled: boolean;
  };
  flags: {
    absenceReconciliationEnabled: boolean;
    previewOnly: boolean;
    applyConfirmedEnabled: boolean;
    operationalExclusionEnabled: boolean;
    directedLookupEnabled: boolean;
    reconcileScope: string;
  };
  presence: Record<string, number>;
  metrics24h: { runs: number; success: number; skipped: number; failed: number; inconclusive: number; http429: number };
  lastRun: RunDto | null;
  lastSuccess: RunDto | null;
  lastFullReconciliation: RunDto | null;
  alerts: Array<{ code: string; severity: string; message: string }>;
};

type MissingDto = {
  id: string;
  externalId: number;
  orderNumber: string | null;
  supplierName: string | null;
  issuedAt: string | null;
  sourcePresenceStatus: string;
  missingSince: string | null;
  missingConsecutiveRuns: number;
};

const toneClass: Record<string, string> = {
  success: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100",
  info: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100",
  warning: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100",
  danger: "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100",
};

function OnOff({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        on ? "border-emerald-300 text-emerald-800 dark:text-emerald-200" : "border-border text-muted-foreground"
      )}
    >
      {label}: {on ? "ligado" : "desligado"}
    </span>
  );
}

export function NomusPurchaseOrdersSyncCard({
  canRun,
  canAuthorize,
}: {
  canRun: boolean;
  /** Super Admin: autoriza gravação de ausências (o backend revalida). */
  canAuthorize: boolean;
}) {
  const [status, setStatus] = useState<StatusDto | null>(null);
  const [runs, setRuns] = useState<RunDto[]>([]);
  const [missing, setMissing] = useState<MissingDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [authorizeOpen, setAuthorizeOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, r, m] = await Promise.all([
        fetchJsonOk<StatusDto>("/api/settings/nomus-sync/purchase-orders-status"),
        fetchJsonOk<{ runs: RunDto[] }>("/api/settings/nomus-sync/purchase-orders-runs?limit=20"),
        fetchJsonOk<{ orders: MissingDto[] }>("/api/settings/nomus-sync/purchase-orders-missing"),
      ]);
      setStatus(s);
      setRuns(r.runs);
      setMissing(m.orders);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar o status de Pedidos de Compra Nomus.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!status?.isRunning) return;
    const id = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(id);
  }, [status?.isRunning, load]);

  const start = async (kind: "run" | "reconcile-preview" | "reconcile-apply") => {
    setStarting(kind);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/settings/nomus-sync/purchase-orders-${kind}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: kind === "reconcile-apply" ? JSON.stringify({ confirmPhrase: confirmText.trim() }) : "{}",
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) {
        throw new Error(body.message ?? body.error ?? "Não foi possível iniciar a rotina de Pedidos de Compra.");
      }
      setMessage(body.message ?? "Rotina iniciada.");
      setAuthorizeOpen(false);
      setConfirmText("");
      window.setTimeout(() => void load(), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao iniciar a rotina.");
    } finally {
      setStarting(null);
    }
  };

  const overall = status?.overallStatus ?? "NEVER_RAN";
  const tone = purchaseOrderSyncOverallTone(overall);
  const last = status?.lastRun ?? null;
  const busy = !!starting || status?.isRunning === true;

  return (
    <div className="rounded-xl border border-border bg-card/60 p-5 space-y-4" data-testid="nomus-po-sync-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h4 className="text-base font-bold text-foreground">Pedidos de Compra Nomus</h4>
          <p className="text-sm text-muted-foreground">
            Espelho somente leitura de <span className="font-mono">pedidoscompra</span>. Incremental horário (minuto 37,
            janela de 45 dias) e reconciliação diária às 03:37 do universo completo. Pedido que some do Nomus nunca é
            apagado nem tratado como cancelado: fica «Ausente no Nomus» até reaparecer.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-accent disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Atualizar status
          </button>
          {canRun ? (
            <>
              <button
                type="button"
                onClick={() => void start("run")}
                disabled={busy}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {starting === "run" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                Rodar incremental agora
              </button>
              <button
                type="button"
                onClick={() => void start("reconcile-preview")}
                disabled={busy}
                title="Varre o universo completo e calcula ausências sem alterar nenhum pedido."
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-accent disabled:opacity-50"
              >
                {starting === "reconcile-preview" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                Prévia de reconciliação
              </button>
            </>
          ) : null}
          {canRun && canAuthorize ? (
            <button
              type="button"
              onClick={() => {
                setConfirmText("");
                setAuthorizeOpen(true);
              }}
              disabled={busy || !status?.flags.absenceReconciliationEnabled}
              title={
                status?.flags.absenceReconciliationEnabled
                  ? "Executa a reconciliação gravando as ausências (guardas de intervalo e volume continuam valendo)."
                  : "Reconciliação de ausências desligada neste ambiente."
              }
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-amber-400 px-3 text-xs font-semibold text-amber-900 hover:bg-amber-50 disabled:opacity-50 dark:text-amber-200 dark:hover:bg-amber-950/40"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Autorizar ausências
            </button>
          ) : null}
        </div>
      </div>

      {status ? (
        <div className={cn("rounded-lg border px-3 py-2.5 space-y-2.5", toneClass[tone])} data-testid="nomus-po-sync-status">
          <div className="flex flex-wrap items-center gap-2">
            {status.isRunning ? (
              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
            ) : tone === "success" ? (
              <CircleCheck className="h-4 w-4 shrink-0" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0" />
            )}
            <p className="font-semibold text-sm">{purchaseOrderSyncOverallLabel(overall)}</p>
            {status.hoursSinceLastSuccess != null ? (
              <span className="text-xs opacity-90">
                último sucesso há {status.hoursSinceLastSuccess.toLocaleString("pt-BR")} h (limite {status.staleHours} h)
              </span>
            ) : null}
          </div>
          {status.staleReason ? <p className="text-xs opacity-90">Motivo: {status.staleReason}</p> : null}
          <p className="text-xs">
            Fonte de agendamento ativa:{" "}
            <strong>{status.schedule.activeSource === "independent" ? "agenda própria (cron)" : "após Contas a Receber"}</strong>
            {" · "}Cron {status.schedule.cronInstalled ? "instalado" : "não instalado"}
            {status.schedule.nextHourlyAt
              ? ` · próximo incremental ${formatSyncCardDateTimeLine(status.schedule.nextHourlyAt)}`
              : ""}
            {status.schedule.nextDailyAt
              ? ` · próxima reconciliação ${formatSyncCardDateTimeLine(status.schedule.nextDailyAt)}`
              : ""}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <OnOff on={status.flags.absenceReconciliationEnabled} label="Reconciliação de ausências" />
            <OnOff on={!status.flags.previewOnly} label="Gravação de ausências" />
            <OnOff on={status.flags.applyConfirmedEnabled} label="Confirmação de ausências" />
            <OnOff on={status.flags.operationalExclusionEnabled} label="Excluir confirmados da carteira" />
            <OnOff on={status.flags.directedLookupEnabled} label="Consulta por ID" />
          </div>
          <AdminMetricGrid
            nomusSyncMetrics
            minColumnWidth={130}
            items={[
              { label: "Presentes", value: formatSyncIntOrDash(status.presence.PRESENT), variant: "success" },
              {
                label: "Ausentes em verificação",
                value: formatSyncIntOrDash(status.presence.MISSING_CANDIDATE),
                variant: (status.presence.MISSING_CANDIDATE ?? 0) > 0 ? "warning" : "neutral",
              },
              {
                label: "Ausentes confirmados",
                value: formatSyncIntOrDash(status.presence.MISSING_CONFIRMED),
                variant: (status.presence.MISSING_CONFIRMED ?? 0) > 0 ? "danger" : "neutral",
              },
              { label: "Execuções 24 h", value: formatSyncIntOrDash(status.metrics24h.runs), variant: "info" },
              { label: "Puladas 24 h", value: formatSyncIntOrDash(status.metrics24h.skipped), variant: "neutral" },
              {
                label: "Falhas/parciais 24 h",
                value: formatSyncIntOrDash(status.metrics24h.failed + status.metrics24h.inconclusive),
                variant: status.metrics24h.failed + status.metrics24h.inconclusive > 0 ? "danger" : "success",
              },
              { label: "HTTP 429 24 h", value: formatSyncIntOrDash(status.metrics24h.http429), variant: "neutral" },
            ]}
          />
          {last ? (
            <AdminMetricGrid
              nomusSyncMetrics
              secondary
              minColumnWidth={110}
              items={[
                { label: "Última execução", ...formatSyncCardDateTime(last.startedAt), variant: "neutral" },
                { label: "Situação", value: PURCHASE_ORDER_RUN_STATUS_LABEL[last.status] ?? last.status, variant: "info" },
                { label: "Duração", value: formatSyncDurationMs(last.durationMs), variant: "neutral" },
                { label: "Páginas", value: formatSyncIntOrDash(last.pagesRead), variant: "neutral" },
                { label: "Lidos", value: formatSyncIntOrDash(last.rowsRead), variant: "info" },
                { label: "Criados", value: formatSyncIntOrDash(last.created), variant: "success" },
                { label: "Atualizados", value: formatSyncIntOrDash(last.updated), variant: "info" },
                { label: "Reativados", value: formatSyncIntOrDash(last.reactivated), variant: "info" },
                { label: "Erros", value: formatSyncIntOrDash(last.errors), variant: last.errors > 0 ? "danger" : "success" },
              ]}
            />
          ) : null}
          {status.alerts.length > 0 ? (
            <ul className="space-y-1 text-xs" data-testid="nomus-po-sync-alerts">
              {status.alerts.map((a) => (
                <li key={a.code} className="font-medium">
                  ⚠ {a.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {message ? <div className="nomus-sync-run-message">{message}</div> : null}
      {error ? <div className="nomus-sync-error-message">{error}</div> : null}

      <div className="space-y-2">
        <h5 className="text-sm font-bold">Execuções recentes</h5>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-2 py-1.5">Início</th>
                <th className="px-2 py-1.5">Origem</th>
                <th className="px-2 py-1.5">Estratégia</th>
                <th className="px-2 py-1.5">Situação</th>
                <th className="px-2 py-1.5 text-right">Lidos</th>
                <th className="px-2 py-1.5 text-right">Ausências</th>
                <th className="px-2 py-1.5">Completa</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-2 py-3 text-center text-muted-foreground">
                    Nenhuma execução registrada.
                  </td>
                </tr>
              ) : (
                runs.map((run) => {
                  const s = run.summary ?? {};
                  const counters = s.plan?.counters ?? {};
                  const open = expandedRun === run.id;
                  return (
                    <React.Fragment key={run.id}>
                      <tr
                        className="border-t border-border cursor-pointer hover:bg-accent/40"
                        onClick={() => setExpandedRun(open ? null : run.id)}
                      >
                        <td className="px-2 py-1.5 whitespace-nowrap">{formatSyncCardDateTime(run.startedAt).value}</td>
                        <td className="px-2 py-1.5">{PURCHASE_ORDER_TRIGGER_LABEL[s.trigger ?? ""] ?? s.trigger ?? "—"}</td>
                        <td className="px-2 py-1.5">{PURCHASE_ORDER_STRATEGY_LABEL[run.strategy] ?? run.strategy}</td>
                        <td className="px-2 py-1.5">
                          {PURCHASE_ORDER_RUN_STATUS_LABEL[run.status] ?? run.status}
                          {run.status === "SKIPPED" && s.skipReason
                            ? ` — ${PURCHASE_ORDER_SKIP_REASON_LABEL[s.skipReason] ?? s.skipReason}`
                            : ""}
                        </td>
                        <td className="px-2 py-1.5 text-right">{formatSyncIntOrDash(run.rowsRead)}</td>
                        <td className="px-2 py-1.5 text-right">
                          {formatSyncIntOrDash((counters.missingCandidates ?? 0) + (counters.missingConfirmed ?? 0))}
                          {s.absenceWritesApplied ? "" : (counters.missingCandidates ?? 0) + (counters.missingConfirmed ?? 0) > 0 ? " (prévia)" : ""}
                        </td>
                        <td className="px-2 py-1.5">{run.payloadComplete ? "sim" : "não"}</td>
                      </tr>
                      {open ? (
                        <tr className="border-t border-border bg-muted/20">
                          <td colSpan={7} className="px-3 py-2 space-y-1">
                            <p>
                              Páginas {run.pagesRead} · criados {run.created} · atualizados {run.updated} · inalterados{" "}
                              {run.unchanged} · reativados {run.reactivated} · HTTP 429 {run.http429} · erros {run.errors}
                              {s.scheduleDelaySeconds != null ? ` · atraso ${s.scheduleDelaySeconds}s` : ""}
                            </p>
                            {run.errorMessage ? <p className="text-rose-700 dark:text-rose-300">{run.errorMessage}</p> : null}
                            {s.completeness?.reasons?.length ? (
                              <p className="font-mono text-[11px] break-all">{s.completeness.reasons.join(" · ")}</p>
                            ) : null}
                            {[...(s.missingCandidatesSample ?? []), ...(s.missingConfirmedSample ?? [])].length > 0 ? (
                              <p>
                                Ausentes:{" "}
                                {[...(s.missingCandidatesSample ?? []), ...(s.missingConfirmedSample ?? [])]
                                  .map((m) => `${m.orderNumber ?? `#${m.externalId}`} (${m.reason})`)
                                  .join(", ")}
                              </p>
                            ) : null}
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-2">
        <h5 className="text-sm font-bold">Pedidos ausentes no Nomus</h5>
        {missing.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum pedido ausente.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs" data-testid="nomus-po-missing-table">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-2 py-1.5">Pedido</th>
                  <th className="px-2 py-1.5">Fornecedor</th>
                  <th className="px-2 py-1.5">Emissão</th>
                  <th className="px-2 py-1.5">Situação</th>
                  <th className="px-2 py-1.5">Ausente desde</th>
                  <th className="px-2 py-1.5 text-right">Varreduras</th>
                </tr>
              </thead>
              <tbody>
                {missing.map((m) => (
                  <tr key={m.id} className="border-t border-border">
                    <td className="px-2 py-1.5 font-mono">{m.orderNumber ?? `#${m.externalId}`}</td>
                    <td className="px-2 py-1.5">{m.supplierName ?? "—"}</td>
                    <td className="px-2 py-1.5">{m.issuedAt ? formatSyncCardDateTime(m.issuedAt).value : "—"}</td>
                    <td className="px-2 py-1.5">
                      {m.sourcePresenceStatus === "MISSING_CONFIRMED" ? "Ausente no Nomus — confirmado" : "Ausente no Nomus — em verificação"}
                    </td>
                    <td className="px-2 py-1.5">{m.missingSince ? formatSyncCardDateTime(m.missingSince).value : "—"}</td>
                    <td className="px-2 py-1.5 text-right">{m.missingConsecutiveRuns}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!canRun ? (
        <p className="text-xs text-muted-foreground">
          Você não tem permissão para disparar a rotina. Necessária: <span className="font-mono">settings.nomus.sync</span>.
        </p>
      ) : null}

      {authorizeOpen ? (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50">
          <div
            className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-xl space-y-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="nomus-po-authorize-title"
          >
            <div>
              <h3 id="nomus-po-authorize-title" className="text-lg font-bold">
                Autorizar gravação de ausências
              </h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                Roda a reconciliação completa e grava a presença dos pedidos não encontrados no Nomus. Nenhum pedido,
                item, avaliação, vínculo de contas a pagar ou pagamento é apagado ou cancelado. A confirmação só ocorre
                em uma segunda varredura completa e respeita o limite de volume.
              </p>
            </div>
            <div className="space-y-2">
              <label htmlFor="nomus-po-authorize-confirm" className="text-xs font-bold uppercase text-muted-foreground">
                Digite para confirmar: {NOMUS_PO_RECONCILE_AUTHORIZE_PHRASE}
              </label>
              <input
                id="nomus-po-authorize-confirm"
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
                onClick={() => setAuthorizeOpen(false)}
                disabled={!!starting}
                className="h-10 rounded-lg border border-border px-4 text-sm font-medium hover:bg-accent"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void start("reconcile-apply")}
                disabled={confirmText.trim() !== NOMUS_PO_RECONCILE_AUTHORIZE_PHRASE || !!starting}
                className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {starting === "reconcile-apply" ? "Iniciando…" : "Autorizar e executar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
