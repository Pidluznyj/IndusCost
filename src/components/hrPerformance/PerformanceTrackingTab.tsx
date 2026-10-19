/**
 * Central de acompanhamento do ciclo (RH Operacional e RH Gestor).
 * Só situação, responsável, prazo e motivo de cada obrigação: nenhuma nota, comentário ou
 * resposta chega a esta tela (o servidor monta o quadro sem ler respostas).
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, Send, ShieldOff } from "lucide-react";
import { OverlayBadge, type OverlayBadgeTone } from "@/src/components/ui/overlay";
import { CYCLE_STATUS_LABELS, type CycleStatus } from "@/src/lib/hrPerformance/performanceDomain";
import {
  fetchPerformanceCycles,
  fetchTrackingBoard,
  issuePerformanceInvite,
  revokePerformanceInvite,
  trackingExportUrl,
  type CoverageRow,
  type CycleSummary,
  type ObligationKey,
  type ObligationStatus,
  type PerformanceCapabilities,
  type TrackingBoard,
  type TrackingFilterInput,
  type TrackingObligation,
} from "@/src/lib/hrPerformance/performanceClient";
import { BTN_GHOST, BTN_SECONDARY, ErrorBanner, InfoBanner, KpiTile, PANEL, PanelState, TableScroll, copyText, dateBr } from "./performanceUi";

const STATUS_LABEL: Record<ObligationStatus, string> = {
  NOT_APPLICABLE: "Não se aplica",
  PENDING: "Pendente",
  STARTED: "Iniciada",
  SUBMITTED: "Enviada",
  OVERDUE: "Vencida",
  DONE: "Concluída",
};
const STATUS_TONE: Record<ObligationStatus, OverlayBadgeTone> = {
  NOT_APPLICABLE: "slate",
  PENDING: "amber",
  STARTED: "sky",
  SUBMITTED: "emerald",
  OVERDUE: "rose",
  DONE: "emerald",
};
const COLUMNS: { key: ObligationKey; short: string }[] = [
  { key: "self", short: "Autoavaliação" },
  { key: "leader", short: "Líder" },
  { key: "upward", short: "Ascendente" },
  { key: "leadershipSelf", short: "Autoaval. liderança" },
  { key: "superior", short: "Superior" },
  { key: "calibration", short: "Calibração" },
  { key: "leadershipCalibration", short: "Calib. liderança" },
  { key: "homologation", short: "Homologação" },
  { key: "feedback", short: "Devolutiva" },
];
const MODALITY_LABEL: Record<string, string> = { INDIVIDUAL: "Individual", LIDERANCA: "Liderança (180°)", CALIBRACAO: "Calibração", FECHAMENTO: "Homologação e devolutiva" };

function ObligationCell({ item, label }: { item: TrackingObligation; label: string }) {
  const title = [label, item.responsible ? `Responsável: ${item.responsible}` : null, item.dueAt ? `Prazo: ${dateBr(item.dueAt)}` : null, item.reason].filter(Boolean).join("\n");
  return (
    <div className="flex min-w-[96px] flex-col gap-0.5" title={title}>
      <OverlayBadge tone={STATUS_TONE[item.status]} variant={item.status === "NOT_APPLICABLE" ? "outline" : "soft"}>
        {STATUS_LABEL[item.status]}
      </OverlayBadge>
      {item.status !== "NOT_APPLICABLE" && item.responsible ? <span className="truncate text-[11px] text-muted-foreground">{item.responsible}</span> : null}
      {item.reason && item.status !== "SUBMITTED" && item.status !== "DONE" ? <span className="line-clamp-2 text-[11px] text-muted-foreground">{item.reason}</span> : null}
    </div>
  );
}

function CoverageTable({ title, rows, testId }: { title: string; rows: CoverageRow[]; testId: string }) {
  return (
    <div className={`${PANEL} p-4`} data-testid={testId}>
      <p className="mb-2 text-sm font-semibold">{title}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">Sem pessoas elegíveis no recorte.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="py-1 text-left font-medium">Grupo</th>
              <th className="py-1 text-right font-medium">Elegíveis</th>
              <th className="py-1 text-right font-medium">Pesquisas concluídas</th>
              <th className="py-1 text-right font-medium">Avaliação do líder</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.group}>
                <td className="py-1.5">{r.group}</td>
                <td className="py-1.5 text-right tabular-nums">{r.eligible}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {r.completed} ({Math.round((r.completed / Math.max(1, r.eligible)) * 100)}%)
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {r.leaderCompleted} ({Math.round((r.leaderCompleted / Math.max(1, r.eligible)) * 100)}%)
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function PerformanceTrackingTab({ cycleId, caps, onSelectCycle, onToast }: { cycleId: string | null; caps: PerformanceCapabilities; onSelectCycle: (id: string) => void; onToast: (message: string) => void }) {
  const [cycles, setCycles] = useState<CycleSummary[] | null>(null);
  const [board, setBoard] = useState<TrackingBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<TrackingFilterInput>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [lastIssued, setLastIssued] = useState<{ name: string; url: string; otp: string } | null>(null);

  useEffect(() => {
    void fetchPerformanceCycles()
      .then((payload) => setCycles(payload.cycles))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Falha ao carregar os ciclos."));
  }, []);
  // Vazio = nenhum ciclo escolhido (o seletor nativo devolve "" quando a opção ainda não carregou).
  const current = (cycleId || null) ?? cycles?.[0]?.id ?? null;

  const reload = useCallback(async () => {
    if (!current) return;
    try {
      setBoard(await fetchTrackingBoard(current, filters));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao carregar o acompanhamento.");
    }
  }, [current, filters]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const labels = board?.labels;
  const i = board?.indicators;
  const columns = useMemo(() => (board?.cycle.leadership ? COLUMNS : COLUMNS.filter((c) => !["upward", "leadershipSelf", "superior", "leadershipCalibration"].includes(c.key))), [board]);

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível concluir.");
    } finally {
      setBusy(null);
    }
  };

  if (cycles && cycles.length === 0) return <div className={PANEL}><PanelState kind="empty" message="Nenhum ciclo criado ainda." /></div>;

  return (
    <section className="space-y-4" data-testid="perf-tracking-tab">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <select
            className="h-9 max-w-full rounded-lg border border-border bg-card px-2 text-sm"
            aria-label="Ciclo"
            value={current ?? ""}
            onChange={(e) => {
              if (e.target.value) onSelectCycle(e.target.value);
            }}
            data-testid="perf-tracking-cycle"
          >
            {(cycles ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {CYCLE_STATUS_LABELS[c.status as CycleStatus] ?? c.status}
              </option>
            ))}
          </select>
          <button type="button" className={BTN_GHOST} onClick={() => void reload()} aria-label="Atualizar">
            <RefreshCw className="h-4 w-4" aria-hidden />
          </button>
        </div>
        {caps.trackExport && current ? (
          <a className={BTN_SECONDARY} href={trackingExportUrl(current, filters)} data-testid="perf-tracking-export">
            <Download className="h-4 w-4" aria-hidden /> Relatório operacional (CSV)
          </a>
        ) : null}
      </div>
      <InfoBanner tone="slate" testId="perf-tracking-privacy">
        Esta central mostra só a situação de cada obrigação, quem responde e o prazo. Notas, comentários e respostas não aparecem aqui.
      </InfoBanner>
      <ErrorBanner message={error} />
      {!board && !error ? <PanelState kind="loading" message="Carregando…" /> : null}
      {board && i ? (
        <>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6" data-testid="perf-tracking-kpis">
            <KpiTile label="Elegíveis" value={i.eligible} testId="perf-kpi-eligible" />
            <KpiTile label="Convites gerados" value={i.invitesGenerated} hint={`${i.invitesAccessed} acessado(s) com código`} testId="perf-kpi-invites" />
            <KpiTile label="Convites entregues" value="—" hint="Sem confirmação confiável de entrega" testId="perf-kpi-delivered" />
            <KpiTile label="Pesquisas iniciadas" value={i.surveysStarted} testId="perf-kpi-started" />
            <KpiTile label="Pesquisas concluídas" value={i.surveysCompleted} tone="positive" testId="perf-kpi-completed" />
            <KpiTile label="Participantes pendentes" value={i.participantsPending} tone={i.participantsPending ? "warning" : "neutral"} testId="perf-kpi-pending" />
            <KpiTile label="Avaliações de líderes pendentes" value={i.leaderEvaluationsPending} tone={i.leaderEvaluationsPending ? "warning" : "neutral"} testId="perf-kpi-leaders" />
            <KpiTile label="Calibrações pendentes" value={i.calibrationsPending} testId="perf-kpi-calibrations" />
            <KpiTile label="Obrigações vencidas" value={i.overdueObligations} tone={i.overdueObligations ? "warning" : "neutral"} testId="perf-kpi-overdue" />
            <KpiTile label="Homologados" value={i.homologated} testId="perf-kpi-homologated" />
            <KpiTile label="Devolutivas concluídas" value={i.feedbackDone} testId="perf-kpi-feedback" />
          </div>

          <div className="flex flex-wrap gap-2" data-testid="perf-tracking-filters">
            {(
              [
                ["department", "setor", board.filters.departments],
                ["directorate", "diretoria", board.filters.directorates],
                ["manager", "líder responsável", board.filters.managers],
                ["modality", "modalidade", board.filters.modalities],
                ["status", "situação", board.filters.statuses],
              ] as const
            ).map(([field, label, options]) => (
              <select
                key={field}
                className="h-9 max-w-full rounded-lg border border-border bg-card px-2 text-sm"
                aria-label={`Filtrar ${label}`}
                value={filters[field] ?? ""}
                onChange={(e) => setFilters({ ...filters, [field]: e.target.value || undefined })}
                data-testid={`perf-tracking-filter-${field}`}
              >
                <option value="">{`Todos: ${label}`}</option>
                {options.map((o) => (
                  <option key={o} value={o}>
                    {field === "modality" ? MODALITY_LABEL[o] ?? o : field === "status" ? STATUS_LABEL[o as ObligationStatus] ?? o : o}
                  </option>
                ))}
              </select>
            ))}
          </div>

          {lastIssued ? (
            <InfoBanner tone="amber" testId="perf-tracking-issued">
              Novo convite de {lastIssued.name}. Código (fale à pessoa, não escreva na folha): <strong>{lastIssued.otp}</strong>.{" "}
              <button type="button" className="underline" onClick={() => void copyText(lastIssued.url).then(() => onToast("Link copiado"))}>
                Copiar link
              </button>
            </InfoBanner>
          ) : null}

          <div className={`${PANEL} p-0`}>
            <TableScroll testId="perf-tracking-table">
              <table className="w-full min-w-[1100px] text-left text-sm">
                <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Pessoa</th>
                    {columns.map((c) => (
                      <th key={c.key} className="px-2 py-2 font-semibold" title={labels?.[c.key]}>
                        {c.short}
                      </th>
                    ))}
                    {caps.invites ? <th className="px-3 py-2 text-right font-semibold">Convite</th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {board.rows.length === 0 ? (
                    <tr>
                      <td colSpan={columns.length + 2} className="px-3 py-6 text-center text-sm text-muted-foreground">
                        Ninguém neste recorte.
                      </td>
                    </tr>
                  ) : null}
                  {board.rows.map((row) => {
                    const self = row.obligations.find((o) => o.key === "self")!;
                    const canReissue = caps.invites && row.selfAssignmentId && board.cycle.status === "OPEN" && self.status !== "SUBMITTED" && row.eligibility === "ELIGIBLE";
                    return (
                      <tr key={row.participantId} className="align-top" data-testid={`perf-tracking-row-${row.employeeName}`}>
                        <td className="px-3 py-2">
                          <p className="font-medium">{row.employeeName}</p>
                          <p className="text-xs text-muted-foreground">
                            {row.roleName} · {row.departmentName}
                            {row.directorateName !== "Sem diretoria" ? ` · ${row.directorateName}` : ""}
                          </p>
                          <p className="text-xs text-muted-foreground">Líder: {row.managerName ?? (row.managerSource === "TOPO" ? "topo da estrutura" : "sem líder")}</p>
                        </td>
                        {columns.map((c) => (
                          <td key={c.key} className="px-2 py-2" data-testid={`perf-tracking-${row.employeeName}-${c.key}`}>
                            <ObligationCell item={row.obligations.find((o) => o.key === c.key)!} label={labels?.[c.key] ?? c.short} />
                          </td>
                        ))}
                        {caps.invites ? (
                          <td className="px-3 py-2 text-right">
                            {canReissue ? (
                              <div className="flex flex-col items-end gap-1">
                                <button
                                  type="button"
                                  className={BTN_GHOST}
                                  disabled={busy !== null}
                                  onClick={() =>
                                    void act(`issue-${row.participantId}`, async () => {
                                      const issued = await issuePerformanceInvite(row.selfAssignmentId!);
                                      setLastIssued({ name: row.employeeName, url: issued.url, otp: issued.otp });
                                      onToast("Convite reemitido; o anterior deixou de valer");
                                    })
                                  }
                                  data-testid={`perf-tracking-reissue-${row.employeeName}`}
                                >
                                  <Send className="h-3.5 w-3.5" aria-hidden /> Reemitir
                                </button>
                                <button
                                  type="button"
                                  className={BTN_GHOST}
                                  disabled={busy !== null}
                                  onClick={() => {
                                    const reason = window.prompt("Motivo da revogação (ex.: convite extraviado ou exposto):", "");
                                    if (!reason || reason.trim().length < 8) {
                                      if (reason !== null) onToast("Informe um motivo com pelo menos 8 caracteres.");
                                      return;
                                    }
                                    void act(`revoke-${row.participantId}`, async () => {
                                      await revokePerformanceInvite(row.selfAssignmentId!, reason.trim());
                                      onToast("Convite revogado");
                                    });
                                  }}
                                  data-testid={`perf-tracking-revoke-${row.employeeName}`}
                                >
                                  <ShieldOff className="h-3.5 w-3.5" aria-hidden /> Revogar
                                </button>
                              </div>
                            ) : null}
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroll>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <CoverageTable title="Cobertura por setor" rows={board.coverage.byDepartment} testId="perf-tracking-coverage-department" />
            <CoverageTable title="Cobertura por diretoria" rows={board.coverage.byDirectorate} testId="perf-tracking-coverage-directorate" />
          </div>
          <p className="text-xs text-muted-foreground">
            Prazos: autoavaliação e etapas de liderança até {dateBr(board.cycle.selfDueAt)}; avaliações de líderes até {dateBr(board.cycle.leaderDueAt)}. “Vencida” = prazo passado sem envio,
            ou coleta encerrada sem envio. Exceções (troca de líder, elegibilidade, calibração sem fonte) ficam na aba Ciclos e na Calibração, com motivo e auditoria.
          </p>
        </>
      ) : null}
    </section>
  );
}
