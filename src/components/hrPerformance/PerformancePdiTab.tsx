/**
 * Devolutivas e PDI: pendências de devolutiva do ciclo (RH) e acompanhamento das ações
 * com filtro de prazo e situação. O líder vê só a própria equipe (filtrado no servidor).
 */
import React, { useCallback, useEffect, useState } from "react";
import { MessageSquareText, Printer, Target } from "lucide-react";
import { PDI_STATUSES, PDI_STATUS_LABELS } from "@/src/lib/hrPerformance/performanceDomain";
import { fetchCycleWorkspace, fetchPdiTracking, performanceReportPrintUrl, type CycleWorkspace, type PdiTrackingRow, type WorkspacePerson } from "@/src/lib/hrPerformance/performanceClient";
import { BTN_GHOST, BTN_SECONDARY, ErrorBanner, InfoBanner, PANEL, PanelState, PdiBadge, TableScroll, dateBr, quadrantText } from "./performanceUi";
import { AckDialog, CheckinDialog, FeedbackDialog, PdiDialog, PdiStatusDialog } from "./PerformanceFollowUpDialogs";
import { cn } from "@/src/lib/utils";

type Dialog =
  | { kind: "feedback"; person: WorkspacePerson }
  | { kind: "ack"; person: WorkspacePerson }
  | { kind: "pdi"; person: WorkspacePerson }
  | { kind: "checkin"; row: PdiTrackingRow }
  | { kind: "status"; row: PdiTrackingRow }
  | null;

export function PerformancePdiTab({ cycleId, canReport, actorName, onToast }: { cycleId: string | null; canReport: boolean; actorName: string; onToast: (message: string) => void }) {
  const [ws, setWs] = useState<CycleWorkspace | null>(null);
  const [rows, setRows] = useState<PdiTrackingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [due, setDue] = useState<"all" | "late" | "next30">("all");
  const [status, setStatus] = useState("");
  const [onlyCycle, setOnlyCycle] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);

  const reload = useCallback(async () => {
    try {
      const filters: Record<string, string> = { due };
      if (status) filters.status = status;
      if (onlyCycle && cycleId) filters.cycleId = cycleId;
      const [workspace, tracking] = await Promise.all([cycleId ? fetchCycleWorkspace(cycleId) : Promise.resolve(null), fetchPdiTracking(filters)]);
      setWs(workspace);
      setRows(tracking.items);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar.");
    }
  }, [cycleId, due, status, onlyCycle]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const homologated = (ws?.people ?? []).filter((p) => p.result?.official && !p.participant.removedAt);
  const done = () => {
    setDialog(null);
    void reload();
  };

  return (
    <section className="space-y-4" data-testid="perf-pdi-tab">
      <ErrorBanner message={error} />
      {ws ? (
        <div className={`${PANEL} space-y-3 p-4`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Devolutivas · {ws.cycle.name}</h3>
            <span className="text-xs text-muted-foreground">
              {homologated.filter((p) => p.feedback).length} de {homologated.length} registradas · {homologated.filter((p) => p.feedback?.acknowledgedAt).length} com ciência
            </span>
          </div>
          {homologated.length === 0 ? (
            <InfoBanner tone="slate">A devolutiva oficial só existe depois da homologação do ciclo.</InfoBanner>
          ) : (
            <TableScroll>
              <table className="w-full min-w-[820px] text-left text-sm" data-testid="perf-feedback-table">
                <thead className="border-b border-border text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-2">Pessoa</th>
                    <th className="py-2">Resultado</th>
                    <th className="py-2">Devolutiva</th>
                    <th className="py-2">Ciência</th>
                    <th className="py-2">PDI</th>
                    <th className="py-2 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {homologated.map((person) => (
                    <tr key={person.participant.id} className="align-top" data-testid={`perf-fb-row-${person.participant.employeeName}`}>
                      <td className="py-2">
                        <p className="font-medium">{person.participant.employeeName}</p>
                        <p className="text-xs text-muted-foreground">{person.participant.departmentName}</p>
                      </td>
                      <td className="py-2 text-xs">{quadrantText(person.result?.quadrant)}</td>
                      <td className="py-2 text-xs">
                        {person.feedback ? (
                          <>
                            <p>
                              <strong>Forte:</strong> {person.feedback.strength}
                            </p>
                            <p>
                              <strong>Desenvolver:</strong> {person.feedback.improvement}
                            </p>
                          </>
                        ) : (
                          <span className="text-amber-700">Pendente</span>
                        )}
                      </td>
                      <td className="py-2 text-xs">
                        {person.feedback?.acknowledgedAt ? (
                          <>
                            Ciência em {dateBr(person.feedback.acknowledgedAt)}
                            {person.feedback.acknowledgedVia === "ASSISTED" ? " (presencial)" : ""}
                            <br />
                            {person.feedback.agreedAt ? "Concorda" : "Concordância não registrada"}
                            {person.feedback.contestation ? <span className="block text-rose-700">Contestou: {person.feedback.contestation}</span> : null}
                            {person.feedback.collaboratorNote ? <span className="block text-muted-foreground">Obs.: {person.feedback.collaboratorNote}</span> : null}
                          </>
                        ) : person.feedback ? (
                          "Aguardando"
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2 text-xs">{person.pdis.length ? person.pdis.map((p) => <React.Fragment key={p.id}><PdiBadge status={p.status} /> </React.Fragment>) : "—"}</td>
                      <td className="py-2">
                        <div className="flex flex-wrap justify-end gap-1">
                          {!person.feedback ? (
                            <button type="button" className={BTN_GHOST} onClick={() => setDialog({ kind: "feedback", person })} data-testid={`perf-fb-create-${person.participant.employeeName}`}>
                              <MessageSquareText className="h-3.5 w-3.5" aria-hidden /> Registrar
                            </button>
                          ) : null}
                          {person.feedback ? (
                            <button type="button" className={BTN_GHOST} onClick={() => setDialog({ kind: "ack", person })} data-testid={`perf-fb-ack-${person.participant.employeeName}`}>
                              Registro da pessoa
                            </button>
                          ) : null}
                          {person.feedback ? (
                            <button type="button" className={BTN_GHOST} onClick={() => setDialog({ kind: "pdi", person })} data-testid={`perf-fb-pdi-${person.participant.employeeName}`}>
                              <Target className="h-3.5 w-3.5" aria-hidden /> {person.pdis.length ? "Nova ação" : "Criar PDI"}
                            </button>
                          ) : null}
                          {canReport && person.feedback ? (
                            <a className={BTN_GHOST} href={performanceReportPrintUrl(ws.cycle.id, "devolutiva", person.participant.id)} target="_blank" rel="noopener">
                              <Printer className="h-3.5 w-3.5" aria-hidden /> PDF
                            </a>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </div>
      ) : null}

      <div className={`${PANEL} space-y-3 p-4`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Acompanhamento do PDI</h3>
          <div className="flex flex-wrap gap-2">
            <select className="h-9 rounded-lg border border-border bg-card px-2 text-sm" aria-label="Prazo" value={due} onChange={(e) => setDue(e.target.value as typeof due)} data-testid="perf-pdi-filter-due">
              <option value="all">Todos os prazos</option>
              <option value="late">Vencidas</option>
              <option value="next30">Vencem em 30 dias</option>
            </select>
            <select className="h-9 rounded-lg border border-border bg-card px-2 text-sm" aria-label="Situação" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Todas as situações</option>
              {PDI_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PDI_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            {cycleId ? (
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4" checked={onlyCycle} onChange={(e) => setOnlyCycle(e.target.checked)} /> Só este ciclo
              </label>
            ) : null}
          </div>
        </div>
        {rows === null ? (
          <PanelState kind="loading" message="Carregando ações…" />
        ) : rows.length === 0 ? (
          <PanelState kind="empty" message="Nenhuma ação nesta seleção." />
        ) : (
          <ul className="divide-y divide-border" data-testid="perf-pdi-list">
            {rows.map((row) => (
              <li key={row.id} className="py-3" data-testid={`perf-pdi-row-${row.employeeName}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {row.title} {row.priority ? <span className="text-xs text-primary">· prioritária</span> : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {row.employeeName} · {row.departmentName} · {row.cycleName} · responsável {row.ownerName}
                    </p>
                    <p className={cn("text-xs", row.late ? "font-semibold text-rose-700" : "text-muted-foreground")}>
                      Prazo {dateBr(row.dueAt)}
                      {row.late ? " · vencida" : ""}
                      {row.lastCheckinAt ? ` · último acompanhamento ${dateBr(row.lastCheckinAt)}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <PdiBadge status={row.status} />
                    {row.open ? (
                      <>
                        <button type="button" className={BTN_GHOST} onClick={() => setDialog({ kind: "checkin", row })} data-testid={`perf-pdi-checkin-${row.employeeName}`}>
                          Acompanhar
                        </button>
                        <button type="button" className={BTN_GHOST} onClick={() => setDialog({ kind: "status", row })} data-testid={`perf-pdi-status-${row.employeeName}`}>
                          Mudar situação
                        </button>
                      </>
                    ) : null}
                    <button type="button" className={BTN_GHOST} onClick={() => setExpanded(expanded === row.id ? null : row.id)} aria-expanded={expanded === row.id}>
                      Histórico ({row.checkins.length})
                    </button>
                  </div>
                </div>
                {expanded === row.id ? (
                  <ol className="mt-2 space-y-1 border-l-2 border-border pl-3 text-xs">
                    {row.objective ? <li>Objetivo: {row.objective}</li> : null}
                    {row.justification ? <li>Justificativa: {row.justification}</li> : null}
                    {row.checkins.map((c) => (
                      <li key={c.id}>
                        <strong>{dateBr(c.createdAt)}</strong> · {c.note}
                        {c.obstacle ? ` · obstáculo: ${c.obstacle}` : ""}
                        {c.nextStep ? ` · próximo passo: ${c.nextStep}` : ""}
                      </li>
                    ))}
                    {row.evidence ? <li>Evidência: {row.evidence}</li> : null}
                  </ol>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {dialog?.kind === "feedback" ? (
        <FeedbackDialog participantId={dialog.person.participant.id} employeeName={dialog.person.participant.employeeName} ownerName={dialog.person.participant.managerName ?? actorName} onClose={() => setDialog(null)} onDone={() => { onToast("Devolutiva registrada"); done(); }} />
      ) : null}
      {dialog?.kind === "ack" && dialog.person.feedback ? (
        <AckDialog feedbackId={dialog.person.feedback.id} employeeName={dialog.person.participant.employeeName} onClose={() => setDialog(null)} onDone={() => { onToast("Registro salvo"); done(); }} />
      ) : null}
      {dialog?.kind === "pdi" && dialog.person.feedback && ws ? (
        <PdiDialog
          feedbackId={dialog.person.feedback.id}
          cycleId={ws.cycle.id}
          employeeName={dialog.person.participant.employeeName}
          ownerName={dialog.person.participant.managerName ?? actorName}
          hasPriority={dialog.person.pdis.some((p) => p.priority && p.status !== "CANCELLED")}
          onClose={() => setDialog(null)}
          onDone={() => {
            onToast("Ação do PDI criada");
            done();
          }}
        />
      ) : null}
      {dialog?.kind === "checkin" ? <CheckinDialog pdiId={dialog.row.id} title={dialog.row.title} onClose={() => setDialog(null)} onDone={() => { onToast("Acompanhamento registrado"); done(); }} /> : null}
      {dialog?.kind === "status" ? <PdiStatusDialog pdiId={dialog.row.id} title={dialog.row.title} current={dialog.row.status} onClose={() => setDialog(null)} onDone={() => { onToast("Situação atualizada"); done(); }} /> : null}
    </section>
  );
}

