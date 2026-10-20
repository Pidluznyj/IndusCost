/**
 * Minha equipe: só as avaliações atribuídas a quem está logado (o servidor filtra).
 * Depois da homologação, mostra o resultado oficial, a devolutiva e o PDI da equipe.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardCheck, MessageSquareText, Target } from "lucide-react";
import { fetchLeaderQueue, type LeaderQueueItem, type SuperiorLeadershipItem } from "@/src/lib/hrPerformance/performanceClient";
import { LeadershipCalibrationOverlay, LeadershipStatusBadge, SuperiorLeadershipOverlay } from "./PerformanceLeadershipUi";
import { AssignmentBadge, BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CultureBadge, ErrorBanner, InfoBanner, PANEL, PanelState, PdiBadge, dateBr, mean, quadrantText, todayIso } from "./performanceUi";
import { LeaderAssignmentPanel } from "./LeaderAssignmentPanel";
import { AckDialog, FeedbackDialog, PdiDialog } from "./PerformanceFollowUpDialogs";
import { cn } from "@/src/lib/utils";

type Filter = "pending" | "submitted" | "all";
type Dialog = { kind: "feedback" | "ack" | "pdi"; item: LeaderQueueItem } | null;

export function PerformanceTeamTab({ onToast, actorName, linkedEmployee = true }: { onToast: (message: string) => void; actorName: string; linkedEmployee?: boolean }) {
  const [items, setItems] = useState<LeaderQueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("pending");
  const [cycle, setCycle] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [leadership, setLeadership] = useState<SuperiorLeadershipItem[]>([]);
  const [leadershipOpen, setLeadershipOpen] = useState<{ kind: "evaluate" | "calibrate"; item: SuperiorLeadershipItem } | null>(null);

  const reload = useCallback(async () => {
    try {
      const queue = await fetchLeaderQueue();
      setLeadership(queue.leadership ?? []);
      setItems(queue.items);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar a sua equipe.");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const today = todayIso();
  const cycles = useMemo(() => [...new Map((items ?? []).map((i) => [i.cycleId, i.cycleName])).entries()], [items]);
  const shown = (items ?? [])
    .filter((i) => !cycle || i.cycleId === cycle)
    .filter((i) => (filter === "pending" ? i.status !== "SUBMITTED" : filter === "submitted" ? i.status === "SUBMITTED" : true))
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.employeeName.localeCompare(b.employeeName, "pt-BR"));
  const pending = (items ?? []).filter((i) => i.status !== "SUBMITTED").length;
  // Resumo do que falta para o líder, numa linha: avaliações individuais, de liderança e calibrações.
  const leadershipPending = leadership.filter((i) => i.status !== "SUBMITTED").length;
  const calibrationsPending = leadership.filter((i) => i.leadershipStatus === "AVAILABLE").length;
  const nextDue = (items ?? []).filter((i) => i.status !== "SUBMITTED").map((i) => i.dueAt).sort()[0] ?? null;
  const todo = [
    pending ? `${pending} avaliação(ões) da equipe` : null,
    leadershipPending ? `${leadershipPending} avaliação(ões) de liderança` : null,
    calibrationsPending ? `${calibrationsPending} calibração(ões) de liderança` : null,
  ].filter(Boolean);

  return (
    <section className="space-y-4" data-testid="perf-team-tab">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Avaliações que o ciclo atribuiu a você. A autoavaliação de cada pessoa só aparece depois que você envia a sua. Pessoas de outras equipes não aparecem aqui.
        </p>
        <div className="flex flex-wrap gap-2">
          <div role="radiogroup" aria-label="Situação" className="inline-flex rounded-md border border-border bg-muted/60 p-0.5">
            {(
              [
                ["pending", `Pendentes (${pending})`],
                ["submitted", "Enviadas"],
                ["all", "Todas"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={filter === value}
                onClick={() => setFilter(value)}
                className={cn("rounded px-3 py-1.5 text-sm font-medium", filter === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}
                data-testid={`perf-team-filter-${value}`}
              >
                {label}
              </button>
            ))}
          </div>
          {cycles.length > 1 ? (
            <select className="h-9 rounded-lg border border-border bg-card px-2 text-sm" aria-label="Ciclo" value={cycle} onChange={(e) => setCycle(e.target.value)}>
              <option value="">Todos os ciclos</option>
              {cycles.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </div>
      <ErrorBanner message={error} />
      {items !== null ? (
        <div className={`${PANEL} flex flex-wrap items-center justify-between gap-2 p-3`} data-testid="perf-team-todo">
          <p className="text-sm">
            {todo.length === 0 ? (
              <span className="text-emerald-700">Tudo em dia: nenhuma avaliação pendente com você.</span>
            ) : (
              <>
                <strong>Falta com você:</strong> {todo.join(" · ")}
                {nextDue ? <span className="text-muted-foreground"> · prazo mais próximo {dateBr(nextDue)}</span> : null}
              </>
            )}
          </p>
          {leadershipPending ? (
            <a href="#perf-team-leadership" className={BTN_SECONDARY} data-testid="perf-team-goto-leadership">
              Ir para liderança
            </a>
          ) : null}
        </div>
      ) : null}
      {items === null ? (
        <div className={PANEL}>
          <PanelState kind="loading" message="Carregando a sua equipe…" />
        </div>
      ) : shown.length === 0 ? (
        <div className={PANEL}>
          <PanelState
            kind="empty"
            message={
              !linkedEmployee
                ? "Seu usuário não está ligado a um cadastro de colaborador. As avaliações são atribuídas ao colaborador líder; peça ao RH o vínculo em Configurações › Usuários."
                : items.length === 0
                  ? "Nenhuma avaliação atribuída a você."
                  : "Nada nesta situação."
            }
          />
        </div>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2" data-testid="perf-team-list">
          {shown.map((item) => {
            const late = item.status !== "SUBMITTED" && item.dueAt < today && item.editable;
            return (
              <li key={item.assignmentId} className={`${PANEL} space-y-3 p-4`} data-testid={`perf-team-item-${item.employeeName}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{item.employeeName}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.roleName} · {item.departmentName} · {item.cycleName}
                    </p>
                  </div>
                  <AssignmentBadge status={item.status} />
                </div>
                <p className={cn("text-xs", late ? "font-semibold text-rose-700" : "text-muted-foreground")}>
                  Prazo {dateBr(item.dueAt)}
                  {late ? " · atrasada" : ""}
                  {item.revision > 1 ? ` · revisão ${item.revision}` : ""}
                </p>
                {item.returnReason && item.status !== "SUBMITTED" ? (
                  <InfoBanner tone="amber">
                    <strong>Devolvida pelo RH:</strong> {item.returnReason}
                  </InfoBanner>
                ) : null}
                {item.selfVisible && item.divergences.length ? <p className="text-xs text-amber-800">{item.divergences.length} pergunta(s) com diferença relevante para a autoavaliação.</p> : null}
                {item.officialResult ? (
                  <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm" data-testid={`perf-team-result-${item.employeeName}`}>
                    <p className="font-medium">Resultado homologado: {quadrantText(item.officialResult.quadrant)}</p>
                    <p className="text-xs text-muted-foreground">
                      Técnico {mean(item.officialResult.technicalSum, item.officialResult.technicalCount)} · Potencial {mean(item.officialResult.potentialSum, item.officialResult.potentialCount)}
                    </p>
                    <div className="mt-1">
                      <CultureBadge band={item.officialResult.cultureBand} />
                    </div>
                  </div>
                ) : null}
                {item.pdis.length ? (
                  <ul className="space-y-1 text-sm">
                    {item.pdis.map((pdi) => (
                      <li key={pdi.id} className="flex flex-wrap items-center gap-2">
                        <Target className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                        <span>{pdi.title}</span>
                        <PdiBadge status={pdi.status} />
                        <span className="text-xs text-muted-foreground">até {dateBr(pdi.dueAt)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={item.editable && item.status !== "SUBMITTED" ? BTN_PRIMARY : BTN_SECONDARY} onClick={() => setOpen(item.assignmentId)} data-testid={`perf-team-open-${item.employeeName}`}>
                    <ClipboardCheck className="h-4 w-4" aria-hidden />
                    {item.status === "NOT_STARTED" ? "Avaliar" : item.status === "SUBMITTED" || !item.editable ? "Ver avaliação" : "Continuar"}
                  </button>
                  {item.officialResult && !item.feedback ? (
                    <button type="button" className={BTN_SECONDARY} onClick={() => setDialog({ kind: "feedback", item })} data-testid={`perf-team-feedback-${item.employeeName}`}>
                      <MessageSquareText className="h-4 w-4" aria-hidden /> Registrar devolutiva
                    </button>
                  ) : null}
                  {item.feedback && !item.feedback.acknowledgedAt ? (
                    <button type="button" className={BTN_GHOST} onClick={() => setDialog({ kind: "ack", item })}>
                      Registrar ciência presencial
                    </button>
                  ) : null}
                  {item.feedback ? (
                    <button type="button" className={BTN_GHOST} onClick={() => setDialog({ kind: "pdi", item })} data-testid={`perf-team-pdi-${item.employeeName}`}>
                      <Target className="h-3.5 w-3.5" aria-hidden /> {item.pdis.length ? "Nova ação do PDI" : "Criar PDI"}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {open ? (
        <LeaderAssignmentPanel
          assignmentId={open}
          onClose={() => {
            setOpen(null);
            void reload();
          }}
          onSubmitted={() => {
            onToast("Avaliação enviada");
            void reload();
          }}
        />
      ) : null}
      {dialog?.kind === "feedback" ? (
        <FeedbackDialog
          participantId={dialog.item.participantId}
          employeeName={dialog.item.employeeName}
          ownerName={actorName}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            onToast("Devolutiva registrada");
            void reload();
          }}
        />
      ) : null}
      {dialog?.kind === "ack" && dialog.item.feedback ? (
        <AckDialog
          feedbackId={dialog.item.feedback.id}
          employeeName={dialog.item.employeeName}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            onToast("Registro da pessoa salvo");
            void reload();
          }}
        />
      ) : null}
      {dialog?.kind === "pdi" && dialog.item.feedback ? (
        <PdiDialog
          feedbackId={dialog.item.feedback.id}
          cycleId={dialog.item.cycleId}
          employeeName={dialog.item.employeeName}
          ownerName={actorName}
          hasPriority={dialog.item.pdis.some((p) => p.status !== "CANCELLED")}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            onToast("Ação do PDI criada");
            void reload();
          }}
        />
      ) : null}
      {leadership.length > 0 ? (
        <section id="perf-team-leadership" className={`${PANEL} space-y-3 p-4`} data-testid="perf-team-leadership">
          <div>
            <h3 className="text-base font-semibold">Liderança da sua equipe (180°)</h3>
            <p className="text-sm text-muted-foreground">
              Para quem lidera pessoas na sua equipe. É diferente da avaliação individual acima: aqui você avalia como a pessoa lidera e, depois do fechamento da coleta, calibra comparando com a autoavaliação e com a média da equipe.
            </p>
          </div>
          <ul className="grid gap-2 lg:grid-cols-2">
            {leadership.map((item) => {
              const canCalibrate = item.leadershipStatus !== "PENDING" && item.leadershipStatus !== "NOT_APPLICABLE";
              return (
                <li key={item.assignmentId} className="rounded-lg border border-border p-3" data-testid={`perf-team-leadership-${item.employeeName}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold">{item.employeeName}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.roleName} · lidera {item.directReportCount} · {item.cycleName}
                      </p>
                    </div>
                    <LeadershipStatusBadge status={item.leadershipStatus} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span>Avaliação de liderança:</span>
                    <AssignmentBadge status={item.status} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" className={item.status === "SUBMITTED" ? BTN_GHOST : BTN_SECONDARY} onClick={() => setLeadershipOpen({ kind: "evaluate", item })} data-testid={`perf-team-leadership-evaluate-${item.employeeName}`}>
                      {item.status === "SUBMITTED" ? "Ver avaliação de liderança" : "Avaliar liderança"}
                    </button>
                    {canCalibrate ? (
                      <button type="button" className={BTN_PRIMARY} onClick={() => setLeadershipOpen({ kind: "calibrate", item })} data-testid={`perf-team-leadership-calibrate-${item.employeeName}`}>
                        {item.leadershipStatus === "AVAILABLE" ? "Calibrar liderança" : "Ver calibração"}
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {leadershipOpen?.kind === "evaluate" ? (
        <SuperiorLeadershipOverlay
          assignmentId={leadershipOpen.item.assignmentId}
          onClose={() => setLeadershipOpen(null)}
          onDone={(message) => {
            onToast(message);
            void reload();
          }}
        />
      ) : null}
      {leadershipOpen?.kind === "calibrate" ? (
        <LeadershipCalibrationOverlay
          participantId={leadershipOpen.item.participantId}
          onClose={() => setLeadershipOpen(null)}
          onDone={(message) => {
            onToast(message);
            void reload();
          }}
        />
      ) : null}
    </section>
  );
}
