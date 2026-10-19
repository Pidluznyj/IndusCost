/**
 * Formulário do líder, em terceira pessoa. A autoavaliação só aparece depois do envio
 * desta tarefa. Nota 1 ou 4 pede exemplo observado quando o modelo exige. Depois de
 * enviada, a avaliação não muda: só uma devolução formal do RH abre nova versão.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Save, Send } from "lucide-react";
import { Overlay, OverlayBody, OverlayFooter, OverlayHeader, OverlayBadge } from "@/src/components/ui/overlay";
import { FREQUENCY_SCALE, NOT_OBSERVED_LABEL, PILLARS, PILLAR_LABELS, scoreLabel, type Pillar } from "@/src/lib/hrPerformance/performanceDomain";
import { fetchLeaderAssignment, saveLeaderAnswers, submitLeaderAssignment, type LeaderAnswerDraft, type LeaderForm } from "@/src/lib/hrPerformance/performanceClient";
import { AssignmentBadge, BTN_PRIMARY, BTN_SECONDARY, ErrorBanner, InfoBanner, PERF_EYEBROW, PanelState, dateBr } from "./performanceUi";
import { cn } from "@/src/lib/utils";

type Draft = Record<string, LeaderAnswerDraft>;

function fromServer(form: LeaderForm): Draft {
  const next: Draft = {};
  for (const answer of form.answers) {
    if (answer.kind === "score" && answer.score) next[answer.questionCode] = { kind: "score", score: answer.score, evidence: answer.evidence ?? "" };
    else if (answer.kind === "notObserved") next[answer.questionCode] = { kind: "notObserved", evidence: answer.evidence ?? "" };
    else next[answer.questionCode] = { kind: "pending" };
  }
  return next;
}

export function LeaderAssignmentPanel({ assignmentId, onClose, onSubmitted }: { assignmentId: string; onClose: () => void; onSubmitted: () => void }) {
  const [form, setForm] = useState<LeaderForm | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [saved, setSaved] = useState<Draft>({});
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState<"save" | "submit" | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await fetchLeaderAssignment(assignmentId);
      setForm(payload);
      const d = fromServer(payload);
      setDraft(d);
      setSaved(d);
      setVersion(payload.assignment.version);
      setError(null);
      setConflict(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível abrir a avaliação.");
    }
  }, [assignmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const editable = Boolean(form?.editable);
  const minChars = form?.rules.evidenceMinChars ?? 8;
  const needsEvidence = (answer: LeaderAnswerDraft | undefined) =>
    Boolean(form?.rules.requireExtremeEvidence && answer?.kind === "score" && (answer.score === 1 || answer.score === 4));
  const evidenceOk = (answer: LeaderAnswerDraft | undefined) => !needsEvidence(answer) || ((answer as { evidence?: string | null }).evidence ?? "").trim().length >= Math.max(1, minChars);

  const answered = form ? form.questions.filter((q) => draft[q.code] && draft[q.code]!.kind !== "pending").length : 0;
  const missingEvidence = form ? form.questions.filter((q) => !evidenceOk(draft[q.code])).map((q) => q.code) : [];
  const changed = useMemo(() => (form ? form.questions.filter((q) => JSON.stringify(draft[q.code]) !== JSON.stringify(saved[q.code])).map((q) => q.code) : []), [draft, saved, form]);

  const persist = async (): Promise<number | null> => {
    if (changed.length === 0) return version;
    const rows = changed.map((code) => ({ code, answer: draft[code] ?? { kind: "pending" as const } }));
    try {
      const result = await saveLeaderAnswers(assignmentId, version, rows);
      setVersion(result.version);
      setSaved(draft);
      return result.version;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Não foi possível salvar.";
      if ((cause as { code?: string }).code === "VERSION_CONFLICT") setConflict(true);
      setError(message);
      return null;
    }
  };

  const save = async () => {
    setBusy("save");
    setError(null);
    const ok = await persist();
    setBusy(null);
    if (ok != null) setNotice("Rascunho salvo. Você pode continuar depois.");
  };

  const submit = async () => {
    setBusy("submit");
    setError(null);
    const current = await persist();
    if (current == null) {
      setBusy(null);
      return;
    }
    try {
      await submitLeaderAssignment(assignmentId, current);
      setConfirm(false);
      await load();
      setNotice("Avaliação enviada. A autoavaliação da pessoa agora aparece ao lado das suas respostas.");
      onSubmitted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível enviar.");
    } finally {
      setBusy(null);
    }
  };

  const selfByCode = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of form?.selfAnswers ?? []) map[a.questionCode] = a.kind === "score" ? scoreLabel(a.score) : a.kind === "notObserved" ? NOT_OBSERVED_LABEL : "Sem resposta";
    return map;
  }, [form]);
  const divergent = new Set((form?.divergences ?? []).map((d) => d.questionCode));

  return (
    <Overlay open onClose={onClose} size="lg" ariaLabelledBy="perf-leader-form-title" testId="perf-leader-form">
      <OverlayHeader
        titleId="perf-leader-form-title"
        eyebrow={PERF_EYEBROW}
        title={form ? `Avaliação de ${form.employee.name}` : "Avaliação"}
        subtitle={form ? `${form.employee.roleName} · ${form.employee.departmentName} · ${form.cycle.name} · prazo ${dateBr(form.cycle.dueAt)}` : "Carregando…"}
        onClose={onClose}
        actions={form ? <AssignmentBadge status={form.assignment.status} /> : null}
      />
      <OverlayBody>
        <div className="space-y-4">
          {!form && !error ? <PanelState kind="loading" message="Carregando…" /> : null}
          <ErrorBanner message={error} testId="perf-leader-form-error" />
          {conflict ? (
            <button type="button" className={BTN_SECONDARY} onClick={() => void load()}>
              Recarregar a versão atual
            </button>
          ) : null}
          {notice ? <InfoBanner testId="perf-leader-form-notice">{notice}</InfoBanner> : null}
          {form?.assignment.returnReason && form.assignment.status !== "SUBMITTED" ? (
            <InfoBanner tone="amber" testId="perf-leader-returned">
              <strong>O RH devolveu para revisão (versão {form.assignment.revision}).</strong> {form.assignment.returnReason}
            </InfoBanner>
          ) : null}
          {form ? (
            <InfoBanner tone="slate">
              {form.instructions} Avalie o que você observou. {form.rules.requireExtremeEvidence ? `Nas notas 1 e 4, escreva um exemplo (mínimo de ${minChars} caracteres).` : ""} A autoavaliação só aparece depois do seu envio.
            </InfoBanner>
          ) : null}
          {form && !editable && form.assignment.status !== "SUBMITTED" ? <InfoBanner tone="amber">A coleta deste ciclo está fechada para edição.</InfoBanner> : null}
          {form
            ? PILLARS.map((pillar) => (
                <section key={pillar} className="space-y-3">
                  <h3 className="text-sm font-semibold text-primary">{PILLAR_LABELS[pillar as Pillar]}</h3>
                  {form.questions
                    .filter((q) => q.pillar === pillar)
                    .map((q) => {
                      const answer = draft[q.code];
                      const extreme = needsEvidence(answer);
                      const missing = extreme && !evidenceOk(answer);
                      return (
                        <fieldset key={q.code} className={cn("rounded-lg border p-3", divergent.has(q.code) ? "border-amber-300 bg-amber-50/40" : "border-border")} data-testid={`perf-leader-q-${q.code}`}>
                          <legend className="px-1 text-xs font-semibold text-muted-foreground">
                            {q.code} · {q.competency}
                          </legend>
                          <p className="mb-1 font-medium">{q.text}</p>
                          {q.hint ? <p className="mb-2 text-xs text-muted-foreground">{q.hint}</p> : null}
                          {q.description || q.roleExample || q.positiveExample || q.negativeExample ? (
                            <details className="mb-2 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground" data-testid={`perf-leader-q-${q.code}-guide`}>
                              <summary className="cursor-pointer font-semibold text-foreground">O que observar</summary>
                              {q.description ? <p className="mt-1">{q.description}</p> : null}
                              {q.roleExample ? (
                                <p className="mt-1">
                                  <strong className="text-foreground">Para {form.employee.roleName}:</strong> {q.roleExample}
                                </p>
                              ) : null}
                              {q.positiveExample ? <p className="mt-1">Exemplo de “sempre”: {q.positiveExample}</p> : null}
                              {q.negativeExample ? <p className="mt-1">Exemplo de “nunca”: {q.negativeExample}</p> : null}
                            </details>
                          ) : null}
                          <div className="grid gap-1.5 sm:grid-cols-2" role="radiogroup" aria-label={q.text}>
                            {FREQUENCY_SCALE.map((item) => {
                              const on = answer?.kind === "score" && answer.score === item.score;
                              return (
                                <label key={item.score} className={cn("flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm", on ? "border-primary bg-primary/10 font-medium" : "border-border hover:bg-muted", !editable && "cursor-default")}>
                                  <input
                                    type="radio"
                                    className="h-4 w-4"
                                    name={q.code}
                                    disabled={!editable}
                                    checked={on}
                                    onChange={() => setDraft({ ...draft, [q.code]: { kind: "score", score: item.score, evidence: (answer as { evidence?: string | null })?.evidence ?? "" } })}
                                    data-testid={`perf-leader-q-${q.code}-${item.score}`}
                                  />
                                  {item.score} · {item.label}
                                </label>
                              );
                            })}
                            <label className={cn("flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm sm:col-span-2", answer?.kind === "notObserved" ? "border-primary bg-primary/10 font-medium" : "border-border hover:bg-muted")}>
                              <input type="radio" className="h-4 w-4" name={q.code} disabled={!editable} checked={answer?.kind === "notObserved"} onChange={() => setDraft({ ...draft, [q.code]: { kind: "notObserved", evidence: "" } })} data-testid={`perf-leader-q-${q.code}-no`} />
                              {NOT_OBSERVED_LABEL}
                            </label>
                          </div>
                          {answer && answer.kind !== "pending" ? (
                            <label className="mt-2 block text-sm">
                              <span className={cn("font-medium", missing && "text-rose-700")}>{extreme ? "Exemplo observado (obrigatório)" : "Exemplo ou observação (opcional)"}</span>
                              <textarea
                                className={cn("mt-1 min-h-16 w-full rounded-lg border p-2 text-sm", missing ? "border-rose-300" : "border-border")}
                                disabled={!editable}
                                maxLength={600}
                                value={(answer as { evidence?: string | null }).evidence ?? ""}
                                onChange={(e) => setDraft({ ...draft, [q.code]: { ...answer, evidence: e.target.value } as LeaderAnswerDraft })}
                                data-testid={`perf-leader-q-${q.code}-evidence`}
                              />
                            </label>
                          ) : null}
                          {selfByCode[q.code] ? (
                            <p className="mt-2 text-sm text-muted-foreground">
                              Autoavaliação: <strong className="text-foreground">{selfByCode[q.code]}</strong>
                              {divergent.has(q.code) ? <OverlayBadge tone="amber" className="ml-2">diferença relevante</OverlayBadge> : null}
                            </p>
                          ) : null}
                        </fieldset>
                      );
                    })}
                </section>
              ))
            : null}
        </div>
      </OverlayBody>
      <OverlayFooter hint={form ? `${answered} de ${form.questions.length} respondidas${missingEvidence.length ? ` · ${missingEvidence.length} sem exemplo` : ""}${changed.length ? " · alterações não salvas" : ""}` : ""}>
        <button type="button" className={BTN_SECONDARY} onClick={onClose} disabled={busy !== null}>
          Fechar
        </button>
        {editable ? (
          <>
            <button type="button" className={BTN_SECONDARY} onClick={() => void save()} disabled={busy !== null || changed.length === 0} data-testid="perf-leader-save">
              {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />} Salvar rascunho
            </button>
            <button
              type="button"
              className={BTN_PRIMARY}
              onClick={() => setConfirm(true)}
              disabled={busy !== null || !form || answered < form.questions.length || missingEvidence.length > 0}
              data-testid="perf-leader-submit"
            >
              <Send className="h-4 w-4" aria-hidden /> Enviar avaliação
            </button>
          </>
        ) : null}
      </OverlayFooter>
      {confirm ? (
        <Overlay open onClose={() => setConfirm(false)} size="sm" ariaLabel="Confirmar envio" testId="perf-leader-confirm">
          <OverlayHeader eyebrow={PERF_EYEBROW} title="Enviar a avaliação?" subtitle="Depois do envio, as respostas não mudam. Só o RH pode devolver para revisão, com motivo." onClose={() => setConfirm(false)} />
          <OverlayBody>
            <p className="text-sm">{answered} respostas serão enviadas para {form?.employee.name}.</p>
          </OverlayBody>
          <OverlayFooter>
            <button type="button" className={BTN_SECONDARY} onClick={() => setConfirm(false)}>
              Voltar
            </button>
            <button type="button" className={BTN_PRIMARY} onClick={() => void submit()} disabled={busy !== null} data-testid="perf-leader-confirm-send">
              {busy === "submit" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Enviar
            </button>
          </OverlayFooter>
        </Overlay>
      ) : null}
    </Overlay>
  );
}
