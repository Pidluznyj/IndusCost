/**
 * Avaliação 180° de liderança na área administrativa: modelo, avaliação pelo superior e calibração.
 * A percepção da equipe só chega agregada (servidor); nenhum comentário dos liderados passa por aqui.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Scale, Send, Users } from "lucide-react";
import { Overlay, OverlayBadge, OverlayBody, OverlayField, OverlayFooter, OverlayHeader, OverlayInput, OverlayTextarea, type OverlayBadgeTone } from "@/src/components/ui/overlay";
import { FREQUENCY_SCALE, NOT_OBSERVED_LABEL } from "@/src/lib/hrPerformance/performanceDomain";
import { commentProblem, commentRequired, formatScore, justificationReasons, LEADERSHIP_JUSTIFICATION_MIN, type CompetencyComparison } from "@/src/lib/hrPerformance/performanceLeadership";
import {
  calibrateLeadershipApi,
  createLeadershipModel,
  fetchLeadershipComparison,
  fetchLeadershipList,
  fetchPerformanceModel,
  fetchSuperiorLeadershipForm,
  performanceReportPrintUrl,
  publishPerformanceModel,
  saveLeaderAnswers,
  submitLeaderAssignment,
  updateLeadershipQuestion,
  type LeadershipComparison,
  type LeadershipListRow,
  type LeadershipStatus,
  type ModelDetail,
  type SuperiorLeadershipForm,
} from "@/src/lib/hrPerformance/performanceClient";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, ErrorBanner, InfoBanner, PANEL, PanelState, PERF_EYEBROW, PerformanceModal, TableScroll } from "./performanceUi";

const STATUS_TEXT: Record<LeadershipStatus, string> = {
  NOT_APPLICABLE: "Não é líder no ciclo",
  PENDING: "Pendente",
  AVAILABLE: "Disponível para calibração",
  CALIBRATED: "Calibrada",
  EXCEPTION: "Exceção justificada",
  HOMOLOGATED: "Homologada",
};
const STATUS_TONE: Record<LeadershipStatus, OverlayBadgeTone> = {
  NOT_APPLICABLE: "slate",
  PENDING: "amber",
  AVAILABLE: "sky",
  CALIBRATED: "emerald",
  EXCEPTION: "violet",
  HOMOLOGATED: "primary",
};

export function LeadershipStatusBadge({ status }: { status: LeadershipStatus }) {
  return <OverlayBadge tone={STATUS_TONE[status]}>{STATUS_TEXT[status]}</OverlayBadge>;
}

// ---------------------------------------------------------------- modelo

export function CreateLeadershipModelOverlay({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("Avaliação 180° de liderança");
  return (
    <PerformanceModal
      open={open}
      title="Novo modelo de liderança"
      subtitle="Nasce com as oito competências propostas (LD-01 a LD-08). As três perspectivas usam as mesmas competências e a mesma escala."
      saveLabel="Criar rascunho"
      footerHint="Textos em validação com o RH até a publicação."
      canSave={name.trim().length >= 3}
      size="md"
      testId="perf-leadership-model-create"
      onClose={onClose}
      onSave={async () => {
        const created = await createLeadershipModel(name);
        onCreated(created.modelId);
      }}
    >
      <OverlayField label="Nome do modelo" required>
        {(p) => <OverlayInput {...p} value={name} onChange={(e) => setName(e.target.value)} data-testid="perf-leadership-model-name" />}
      </OverlayField>
    </PerformanceModal>
  );
}

type QuestionDraft = { competency: string; behavior: string; selfText: string; upwardText: string; superiorText: string };

export function LeadershipModelEditorOverlay({ modelId, canManage, onClose, onToast, onChanged }: { modelId: string; canManage: boolean; onClose: () => void; onToast: (m: string) => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<ModelDetail | null>(null);
  const [drafts, setDrafts] = useState<Record<string, QuestionDraft>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const d = await fetchPerformanceModel(modelId);
      setDetail(d);
      setDrafts(
        Object.fromEntries(
          d.questions.map((q) => [q.code, { competency: q.competency, behavior: q.description ?? "", selfText: q.selfText, upwardText: q.upwardText ?? "", superiorText: q.leaderText }])
        )
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível abrir o modelo.");
    }
  }, [modelId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const editable = Boolean(detail && canManage && detail.model.status === "DRAFT");
  const changed = (code: string) => {
    const q = detail?.questions.find((x) => x.code === code);
    const d = drafts[code];
    return Boolean(q && d && (q.competency !== d.competency || (q.description ?? "") !== d.behavior || q.selfText !== d.selfText || (q.upwardText ?? "") !== d.upwardText || q.leaderText !== d.superiorText));
  };

  const act = async (key: string, fn: () => Promise<unknown>, message: string) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      onToast(message);
      await reload();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível concluir.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Overlay open onClose={onClose} size="xl" ariaLabel="Modelo de liderança" testId="perf-leadership-model-editor">
      <OverlayHeader
        eyebrow={PERF_EYEBROW}
        title={detail ? `${detail.model.name} · v${detail.model.version}` : "Modelo de liderança"}
        subtitle="Mesma competência, mesmo comportamento e mesma escala nas três perspectivas. Muda só o sujeito da frase."
        onClose={onClose}
      />
      <OverlayBody>
        <ErrorBanner message={error} />
        {!detail && !error ? <PanelState kind="loading" message="Carregando…" /> : null}
        {detail ? (
          <div className="space-y-3">
            {detail.model.status !== "DRAFT" ? <InfoBanner tone="slate">Versão publicada: somente leitura. Para mudar, duplique.</InfoBanner> : null}
            {detail.problems.length > 0 && editable ? <InfoBanner tone="amber">{detail.problems.join(" ")}</InfoBanner> : null}
            {detail.questions.map((q) => {
              const d = drafts[q.code];
              if (!d) return null;
              const set = (patch: Partial<QuestionDraft>) => setDrafts((all) => ({ ...all, [q.code]: { ...all[q.code]!, ...patch } }));
              return (
                <div key={q.code} className="rounded-lg border border-border p-3" data-testid={`perf-leadership-q-${q.code}`}>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-sm">
                      {q.code} · {d.competency}
                    </strong>
                    {editable && changed(q.code) ? (
                      <button
                        type="button"
                        className={BTN_SECONDARY}
                        disabled={busy !== null}
                        onClick={() => void act(q.code, () => updateLeadershipQuestion(detail.model.id, q.code, d), `${q.code} salva`)}
                        data-testid={`perf-leadership-q-save-${q.code}`}
                      >
                        Salvar {q.code}
                      </button>
                    ) : null}
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <OverlayField label="Competência">{(p) => <OverlayInput {...p} value={d.competency} disabled={!editable} onChange={(e) => set({ competency: e.target.value })} />}</OverlayField>
                    <OverlayField label="Comportamento observável">{(p) => <OverlayInput {...p} value={d.behavior} disabled={!editable} onChange={(e) => set({ behavior: e.target.value })} />}</OverlayField>
                    <OverlayField label="O líder sobre si (autoavaliação)">{(p) => <OverlayTextarea {...p} rows={2} value={d.selfText} disabled={!editable} onChange={(e) => set({ selfText: e.target.value })} />}</OverlayField>
                    <OverlayField label="O liderado sobre o líder">{(p) => <OverlayTextarea {...p} rows={2} value={d.upwardText} disabled={!editable} onChange={(e) => set({ upwardText: e.target.value })} />}</OverlayField>
                    <OverlayField label="O superior sobre o líder" colSpan={2}>
                      {(p) => <OverlayTextarea {...p} rows={2} value={d.superiorText} disabled={!editable} onChange={(e) => set({ superiorText: e.target.value })} />}
                    </OverlayField>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </OverlayBody>
      <OverlayFooter>
        <button type="button" className={BTN_SECONDARY} onClick={onClose}>
          Fechar
        </button>
        {editable ? (
          <button
            type="button"
            className={BTN_PRIMARY}
            disabled={busy !== null || Object.keys(drafts).some(changed)}
            title={Object.keys(drafts).some(changed) ? "Salve as competências alteradas antes de publicar." : undefined}
            onClick={() => {
              if (!window.confirm("Publicar esta versão? Depois de publicada ela não muda.")) return;
              void act("publish", () => publishPerformanceModel(modelId), "Modelo de liderança publicado");
            }}
            data-testid="perf-leadership-model-publish"
          >
            Publicar
          </button>
        ) : null}
      </OverlayFooter>
    </Overlay>
  );
}

// ---------------------------------------------------------------- avaliação pelo superior

type Draft = { kind: "pending" } | { kind: "notObserved"; comment: string } | { kind: "score"; score: number; comment: string };

export function SuperiorLeadershipOverlay({ assignmentId, onClose, onDone }: { assignmentId: string; onClose: () => void; onDone: (message: string) => void }) {
  const [form, setForm] = useState<SuperiorLeadershipForm | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetchSuperiorLeadershipForm(assignmentId)
      .then((f) => {
        setForm(f);
        setVersion(f.assignment.version);
        setDrafts(
          Object.fromEntries(
            f.answers.map((a) => [
              a.questionCode,
              a.kind === "score" && a.score ? { kind: "score", score: a.score, comment: a.comment ?? "" } : a.kind === "notObserved" ? { kind: "notObserved", comment: a.comment ?? "" } : { kind: "pending" },
            ])
          )
        );
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Não foi possível abrir a avaliação."));
  }, [assignmentId]);

  const readOnly = form?.assignment.status === "SUBMITTED";
  const min = form?.rules.commentMinLetters ?? 15;
  const issue = (d: Draft | undefined) => (d && d.kind === "score" && commentRequired(d.score) ? commentProblem(d.comment, min) : null);
  const pending = form ? form.questions.filter((q) => !drafts[q.code] || drafts[q.code]!.kind === "pending").length : 0;
  const issues = form ? form.questions.filter((q) => issue(drafts[q.code])).length : 0;

  const save = async () => {
    if (!form) return false;
    const answers = form.questions.map((q) => {
      const d = drafts[q.code] ?? { kind: "pending" };
      return { code: q.code, answer: d.kind === "score" ? { kind: "score" as const, score: d.score, evidence: d.comment || null } : d.kind === "notObserved" ? { kind: "notObserved" as const, evidence: d.comment || null } : { kind: "pending" as const } };
    });
    const out = await saveLeaderAnswers(form.assignment.id, version, answers);
    setVersion(out.version);
    return out.version;
  };

  return (
    <Overlay open onClose={onClose} size="xl" ariaLabel="Avaliação de liderança" testId="perf-superior-leadership">
      <OverlayHeader
        eyebrow={PERF_EYEBROW}
        title={form ? `Avaliação de liderança · ${form.participant.employeeName}` : "Avaliação de liderança"}
        subtitle={
          form
            ? `${form.participant.roleName} · lidera ${form.participant.directReportCount} pessoa(s). É diferente da avaliação individual: aqui você avalia como a pessoa lidera a equipe, nas mesmas oito competências que a equipe e o próprio líder respondem.`
            : ""
        }
        onClose={onClose}
      />
      <OverlayBody>
        <ErrorBanner message={error} />
        {!form && !error ? <PanelState kind="loading" message="Carregando…" /> : null}
        {form ? (
          <ol className="space-y-3">
            {form.questions.map((q, i) => {
              const d = drafts[q.code] ?? { kind: "pending" };
              const set = (next: Draft) => setDrafts((all) => ({ ...all, [q.code]: next }));
              const comment = d.kind === "pending" ? "" : d.comment;
              return (
                <li key={q.code} className="rounded-lg border border-border p-3" data-testid={`perf-superior-q-${q.code}`}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {i + 1}. {q.competency}
                  </p>
                  <p className="mt-1 text-sm font-medium">{q.text}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={q.text}>
                    {FREQUENCY_SCALE.map((s) => (
                      <button
                        key={s.score}
                        type="button"
                        disabled={readOnly}
                        aria-pressed={d.kind === "score" && d.score === s.score}
                        className={`rounded-md border px-2.5 py-1.5 text-xs ${d.kind === "score" && d.score === s.score ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted"}`}
                        onClick={() => set({ kind: "score", score: s.score, comment })}
                        data-testid={`perf-superior-${q.code}-${s.score}`}
                      >
                        {s.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      disabled={readOnly}
                      aria-pressed={d.kind === "notObserved"}
                      className={`rounded-md border px-2.5 py-1.5 text-xs ${d.kind === "notObserved" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted"}`}
                      onClick={() => set({ kind: "notObserved", comment })}
                    >
                      {NOT_OBSERVED_LABEL}
                    </button>
                  </div>
                  {d.kind !== "pending" ? (
                    <OverlayTextarea
                      className="mt-2"
                      rows={2}
                      disabled={readOnly}
                      value={comment}
                      placeholder={d.kind === "score" && commentRequired(d.score) ? "Obrigatório: descreva um comportamento ou situação observada" : "Comentário (opcional)"}
                      onChange={(e) => set({ ...d, comment: e.target.value })}
                      data-testid={`perf-superior-comment-${q.code}`}
                    />
                  ) : null}
                  {issue(d) ? <p className="mt-1 text-xs text-amber-700">{issue(d)}</p> : null}
                </li>
              );
            })}
          </ol>
        ) : null}
      </OverlayBody>
      <OverlayFooter>
        <span className="mr-auto text-xs text-muted-foreground">{readOnly ? "Enviada." : `${pending} sem resposta · ${issues} comentário(s) pendente(s)`}</span>
        <button type="button" className={BTN_SECONDARY} onClick={onClose}>
          Fechar
        </button>
        {!readOnly && form ? (
          <>
            <button
              type="button"
              className={BTN_SECONDARY}
              disabled={busy || issues > 0}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await save();
                  onDone("Rascunho salvo");
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : "Não foi possível salvar.");
                } finally {
                  setBusy(false);
                }
              }}
              data-testid="perf-superior-save"
            >
              Salvar rascunho
            </button>
            <button
              type="button"
              className={BTN_PRIMARY}
              disabled={busy || pending > 0 || issues > 0}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  const v = await save();
                  if (v === false) return;
                  await submitLeaderAssignment(form.assignment.id, v);
                  onDone("Avaliação de liderança enviada");
                  onClose();
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : "Não foi possível enviar.");
                } finally {
                  setBusy(false);
                }
              }}
              data-testid="perf-superior-submit"
            >
              <Send className="h-4 w-4" aria-hidden /> Enviar
            </button>
          </>
        ) : null}
      </OverlayFooter>
    </Overlay>
  );
}

// ---------------------------------------------------------------- calibração

export function LeadershipCalibrationSection({ cycleId, onToast }: { cycleId: string; onToast: (m: string) => void }) {
  const [rows, setRows] = useState<LeadershipListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setRows((await fetchLeadershipList(cycleId)).rows);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar a liderança.");
    }
  }, [cycleId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  if (rows && rows.length === 0 && !error) return null;
  return (
    <section className={`${PANEL} space-y-3 p-4`} data-testid="perf-leadership-calibration">
      <div>
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <Users className="h-4 w-4" aria-hidden /> Calibração de liderança (180°)
        </h3>
        <p className="text-sm text-muted-foreground">Separada da Nine-Box. A equipe aparece só como média, quando há respostas suficientes; comentários dos liderados não são exibidos.</p>
      </div>
      <ErrorBanner message={error} />
      {rows === null && !error ? <PanelState kind="loading" message="Carregando…" /> : null}
      {rows && rows.length > 0 ? (
        <TableScroll>
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-semibold">Líder</th>
                <th className="px-2 py-2 font-semibold">Equipe</th>
                <th className="px-2 py-2 font-semibold">Autoavaliação</th>
                <th className="px-2 py-2 font-semibold">Superior</th>
                <th className="px-2 py-2 font-semibold">Situação</th>
                <th className="px-2 py-2 font-semibold">Índice calibrado</th>
                <th className="px-3 py-2 text-right font-semibold">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.participantId} data-testid={`perf-leadership-row-${r.employeeName}`}>
                  <td className="px-3 py-2">
                    <p className="font-medium">{r.employeeName}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.roleName} · lidera {r.directReportCount}
                    </p>
                  </td>
                  <td className="px-2 py-2 tabular-nums">{r.teamInvited} convidado(s)</td>
                  <td className="px-2 py-2 text-xs">{r.selfStatus === "SUBMITTED" ? "Enviada" : "Pendente"}</td>
                  <td className="px-2 py-2 text-xs">{r.superiorStatus === "SUBMITTED" ? "Enviada" : r.superiorStatus ? "Pendente" : "Sem superior"}</td>
                  <td className="px-2 py-2">
                    <LeadershipStatusBadge status={r.status} />
                  </td>
                  <td className="px-2 py-2 tabular-nums">{formatScore(r.calibratedIndex)}</td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" className={BTN_GHOST} onClick={() => setOpen(r.participantId)} data-testid={`perf-leadership-open-${r.employeeName}`}>
                      <Scale className="h-3.5 w-3.5" aria-hidden /> {r.status === "CALIBRATED" || r.status === "EXCEPTION" || r.status === "HOMOLOGATED" ? "Ver" : "Calibrar"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      ) : null}
      {open ? (
        <LeadershipCalibrationOverlay
          participantId={open}
          onClose={() => setOpen(null)}
          onDone={(message) => {
            onToast(message);
            void reload();
          }}
        />
      ) : null}
    </section>
  );
}

export function LeadershipCalibrationOverlay({ participantId, onClose, onDone }: { participantId: string; onClose: () => void; onDone: (message: string) => void }) {
  const [view, setView] = useState<LeadershipComparison | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [generalNote, setGeneralNote] = useState("");
  const [exceptionReason, setExceptionReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const v = await fetchLeadershipComparison(participantId);
      setView(v);
      setScores(Object.fromEntries(v.rows.map((r) => [r.code, v.result?.scores[r.code] ?? r.superior ?? 0])));
      setNotes(v.result?.justifications ?? {});
      setGeneralNote(v.result?.generalNote ?? "");
      setExceptionReason(v.result?.exceptionReason ?? "");
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível abrir a calibração.");
    }
  }, [participantId]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const locked = Boolean(view?.result?.official) || !(view && (view.cycle.status === "CONSOLIDATION" || view.cycle.status === "CALIBRATION"));
  const missingSources = view ? [!view.coverage.superiorSubmitted ? "avaliação do superior" : null, !view.coverage.selfSubmitted ? "autoavaliação de liderança" : null].filter(Boolean) : [];
  const needs = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const r of view?.rows ?? []) {
      const s = scores[r.code];
      out[r.code] = s && s >= 1 && s <= 4 ? justificationReasons(r as CompetencyComparison, s) : [];
    }
    return out;
  }, [view, scores]);
  const blockers = view
    ? [
        ...view.rows.filter((r) => !(scores[r.code]! >= 1 && scores[r.code]! <= 4)).map((r) => `${r.code} sem nota`),
        ...view.rows.filter((r) => needs[r.code]!.length > 0 && commentProblem(notes[r.code], LEADERSHIP_JUSTIFICATION_MIN)).map((r) => `${r.code} sem justificativa`),
        ...(commentProblem(generalNote, LEADERSHIP_JUSTIFICATION_MIN) ? ["fundamentação geral"] : []),
        ...(missingSources.length > 0 && commentProblem(exceptionReason, LEADERSHIP_JUSTIFICATION_MIN) ? ["motivo da exceção"] : []),
      ]
    : [];

  return (
    <Overlay open onClose={onClose} size="full" ariaLabel="Calibração de liderança" testId="perf-leadership-calibration-overlay">
      <OverlayHeader
        eyebrow={PERF_EYEBROW}
        title={view ? `Calibração de liderança · ${view.participant.employeeName}` : "Calibração de liderança"}
        subtitle="Três perspectivas sobre as mesmas oito competências. A nota calibrada não é média automática: é a sua decisão, inteira de 1 a 4, com fundamentação."
        onClose={onClose}
      />
      <OverlayBody>
        <ErrorBanner message={error} />
        {!view && !error ? <PanelState kind="loading" message="Carregando…" /> : null}
        {view ? (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-3" data-testid="perf-leadership-summary">
              <div className="rounded-lg border border-border p-3 text-sm">
                <p className="text-xs uppercase text-muted-foreground">Equipe</p>
                <p className="text-lg font-semibold tabular-nums">{view.team.disclosed ? formatScore(view.team.index) : "—"}</p>
                <p className="text-xs text-muted-foreground">
                  {view.coverage.teamRespondents == null ? "Aparece depois que a coleta é encerrada." : `${view.coverage.teamRespondents} de ${view.coverage.teamInvited} responderam · mínimo ${view.rules.minRespondents}`}
                  {view.team.message ? ` · ${view.team.message}` : ""}
                </p>
              </div>
              <div className="rounded-lg border border-border p-3 text-sm">
                <p className="text-xs uppercase text-muted-foreground">Autoavaliação</p>
                <p className="text-lg font-semibold tabular-nums">{formatScore(view.self.index)}</p>
                <p className="text-xs text-muted-foreground">{view.coverage.selfSubmitted ? `${view.self.coverage} de 8 competências` : "Não enviada"}</p>
              </div>
              <div className="rounded-lg border border-border p-3 text-sm">
                <p className="text-xs uppercase text-muted-foreground">Superior</p>
                <p className="text-lg font-semibold tabular-nums">{formatScore(view.superior.index)}</p>
                <p className="text-xs text-muted-foreground">{view.coverage.superiorSubmitted ? `${view.superior.coverage} de 8 competências` : "Não enviada"}</p>
              </div>
            </div>
            {!view.team.disclosed ? (
              <InfoBanner tone="amber" testId="perf-leadership-insufficient">
                Amostra insuficiente para divulgação da percepção da equipe. Calibre com as perspectivas disponíveis e registre a limitação de evidência; não use informação que a tela não mostra.
              </InfoBanner>
            ) : null}
            <TableScroll>
              <table className="w-full min-w-[980px] text-left text-sm" data-testid="perf-leadership-table">
                <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 font-semibold">Competência</th>
                    <th className="px-2 py-2 font-semibold">Equipe</th>
                    <th className="px-2 py-2 font-semibold">Auto</th>
                    <th className="px-2 py-2 font-semibold">Superior</th>
                    <th className="px-2 py-2 font-semibold">Divergência</th>
                    <th className="px-2 py-2 font-semibold">Calibrada</th>
                    <th className="px-2 py-2 font-semibold">Justificativa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {view.rows.map((r) => (
                    <tr key={r.code} className="align-top" data-testid={`perf-leadership-row-${r.code}`}>
                      <td className="px-2 py-2">
                        <p className="font-medium">
                          {r.code} · {r.competency}
                        </p>
                        <p className="text-xs text-muted-foreground">{r.behavior}</p>
                      </td>
                      <td className="px-2 py-2 tabular-nums">{r.teamDisclosed ? `${formatScore(r.team)} (${r.teamValidCount})` : <span className="text-xs text-muted-foreground">Insuficiente</span>}</td>
                      <td className="px-2 py-2 tabular-nums">{r.self ?? "—"}</td>
                      <td className="px-2 py-2 tabular-nums">{r.superior ?? "—"}</td>
                      <td className="px-2 py-2 text-xs">{r.divergences.length ? r.divergences.join("; ") : "—"}</td>
                      <td className="px-2 py-2">
                        <select
                          className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                          disabled={locked}
                          value={scores[r.code] ?? 0}
                          onChange={(e) => setScores((all) => ({ ...all, [r.code]: Number(e.target.value) }))}
                          data-testid={`perf-leadership-score-${r.code}`}
                        >
                          <option value={0}>—</option>
                          {FREQUENCY_SCALE.map((s) => (
                            <option key={s.score} value={s.score}>
                              {s.score} · {s.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2">
                        <OverlayTextarea
                          rows={2}
                          disabled={locked}
                          value={notes[r.code] ?? ""}
                          placeholder={needs[r.code]!.length ? `Obrigatória: ${needs[r.code]!.join(", ").toLowerCase()}` : "Opcional"}
                          onChange={(e) => setNotes((all) => ({ ...all, [r.code]: e.target.value }))}
                          data-testid={`perf-leadership-note-${r.code}`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
            {missingSources.length > 0 ? (
              <OverlayField label={`Exceção: falta ${missingSources.join(" e ")}`} required>
                {(p) => (
                  <OverlayTextarea {...p} rows={2} disabled={locked} value={exceptionReason} onChange={(e) => setExceptionReason(e.target.value)} placeholder="Por que calibrar sem esta fonte" data-testid="perf-leadership-exception" />
                )}
              </OverlayField>
            ) : null}
            <OverlayField label="Fundamentação geral" required>
              {(p) => <OverlayTextarea {...p} rows={3} disabled={locked} value={generalNote} onChange={(e) => setGeneralNote(e.target.value)} data-testid="perf-leadership-general" />}
            </OverlayField>
            {view.result ? (
              <div className="grid gap-2 sm:grid-cols-2 text-sm" data-testid="perf-leadership-result">
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs uppercase text-muted-foreground">Índice calibrado (v{view.result.version})</p>
                  <p className="text-lg font-semibold">{formatScore(view.result.index)}</p>
                  <p className="text-xs">{view.result.status === "EXCEPTION" ? `Exceção: ${view.result.exceptionReason}` : view.result.official ? "Homologada" : "Calibrada"}</p>
                </div>
                <div className="rounded-lg border border-border p-3 text-xs">
                  <p>
                    <strong>Mais fortes:</strong> {view.result.strengths.map((s) => s.competency).join(", ") || "—"}
                  </p>
                  <p>
                    <strong>Prioridades de desenvolvimento:</strong> {view.result.priorities.map((s) => s.competency).join(", ") || "—"}
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </OverlayBody>
      <OverlayFooter>
        {!locked && blockers.length ? <span className="mr-auto text-xs text-amber-700">Falta: {blockers.slice(0, 4).join(", ")}{blockers.length > 4 ? "…" : ""}</span> : null}
        {view?.result ? (
          <a className={BTN_SECONDARY} href={performanceReportPrintUrl(view.cycle.id, "lideranca", view.participant.id)} target="_blank" rel="noopener" data-testid="perf-leadership-pdf">
            Documento de liderança (PDF)
          </a>
        ) : null}
        <button type="button" className={BTN_SECONDARY} onClick={onClose}>
          Fechar
        </button>
        {!locked && view ? (
          <button
            type="button"
            className={BTN_PRIMARY}
            disabled={busy || blockers.length > 0}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const out = await calibrateLeadershipApi(participantId, { scores, justifications: notes, generalNote, exceptionReason: missingSources.length ? exceptionReason : null });
                onDone(out.status === "EXCEPTION" ? "Liderança calibrada como exceção registrada" : "Liderança calibrada");
                await reload();
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "Não foi possível calibrar.");
              } finally {
                setBusy(false);
              }
            }}
            data-testid="perf-leadership-save"
          >
            {view.result ? "Registrar nova versão" : "Registrar calibração"}
          </button>
        ) : null}
      </OverlayFooter>
    </Overlay>
  );
}
