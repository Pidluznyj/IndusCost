/**
 * Formulário do líder. A autoavaliação só chega depois do envio desta tarefa.
 */
import React, { useEffect, useState } from "react";
import { BTN_PRIMARY, BTN_SECONDARY } from "@/src/components/competencies/competencyUi";
import { FREQUENCY_SCALE, NOT_OBSERVED_LABEL, PILLAR_LABELS, PROPOSED_EVIDENCE_MIN_CHARS, type Pillar } from "@/src/lib/hrPerformance/performanceDomain";
import { fetchLeaderAssignment, saveLeaderAnswers, submitLeaderAssignment, type LeaderAnswerDraft } from "@/src/lib/hrPerformance/performanceClient";

type Draft = Record<string, LeaderAnswerDraft>;

export function LeaderAssignmentPanel({ assignmentId, onClose }: { assignmentId: string; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState("");
  const [questions, setQuestions] = useState<{ code: string; text: string; pillar: string; hint: string | null }[]>([]);
  const [draft, setDraft] = useState<Draft>({});
  const [selfByCode, setSelfByCode] = useState<Record<string, string>>({});
  const [divergences, setDivergences] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const locked = status === "SUBMITTED";

  useEffect(() => {
    void fetchLeaderAssignment(assignmentId)
      .then((payload) => {
        const next: Draft = {};
        for (const answer of payload.answers) {
          if (answer.kind === "score" && answer.score) next[answer.questionCode] = { kind: "score", score: answer.score, evidence: answer.evidence };
          else if (answer.kind === "notObserved") next[answer.questionCode] = { kind: "notObserved" };
          else next[answer.questionCode] = { kind: "pending" };
        }
        const selfLabels: Record<string, string> = {};
        for (const answer of payload.selfAnswers) {
          selfLabels[answer.questionCode] =
            answer.kind === "score" && answer.score
              ? FREQUENCY_SCALE.find((item) => item.score === answer.score)?.label ?? String(answer.score)
              : answer.kind === "notObserved"
                ? NOT_OBSERVED_LABEL
                : "Sem resposta";
        }
        setVersion(payload.assignment.version);
        setStatus(payload.assignment.status);
        setQuestions(payload.questions);
        setDraft(next);
        setSelfByCode(selfLabels);
        setDivergences(payload.divergences.map((item) => item.questionCode));
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Não foi possível abrir a avaliação."));
  }, [assignmentId]);

  function setAnswer(code: string, answer: LeaderAnswerDraft) {
    setDraft((current) => ({ ...current, [code]: answer }));
  }

  function answeredRows() {
    return questions
      .filter((question) => draft[question.code] && draft[question.code].kind !== "pending")
      .map((question) => ({ code: question.code, answer: draft[question.code] }));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const saved = await saveLeaderAnswers(assignmentId, version, answeredRows());
      setVersion(saved.version);
      setStatus("IN_PROGRESS");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const saved = await saveLeaderAnswers(assignmentId, version, answeredRows());
      setVersion(saved.version);
      await submitLeaderAssignment(assignmentId, saved.version);
      setStatus("SUBMITTED");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível enviar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-4 flex flex-col gap-4 border-t border-border pt-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Avaliação do liderado</h2>
        <button type="button" className={BTN_SECONDARY} onClick={onClose}>Fechar</button>
      </div>
      <p className="text-sm text-muted-foreground">
        A autoavaliação só aparece depois que você enviar a sua. Notas 1 e 4 pedem um exemplo observável de pelo menos {PROPOSED_EVIDENCE_MIN_CHARS} caracteres. Esse mínimo ainda é proposta.
      </p>
      {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
      {questions.map((question) => {
        const answer = draft[question.code];
        const extreme = answer?.kind === "score" && (answer.score === 1 || answer.score === 4);
        return (
          <fieldset key={question.code} className="rounded-lg border border-border p-3">
            <legend className="px-1 text-xs font-medium text-primary">{PILLAR_LABELS[question.pillar as Pillar] ?? question.pillar}</legend>
            <p className="mb-2 font-medium">{question.text}</p>
            {question.hint && <p className="mb-2 text-sm text-muted-foreground">{question.hint}</p>}
            <div className="flex flex-col gap-2" role="radiogroup" aria-label={question.text}>
              {FREQUENCY_SCALE.map((item) => (
                <label key={item.score} className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name={question.code}
                    disabled={locked}
                    checked={answer?.kind === "score" && answer.score === item.score}
                    onChange={() => setAnswer(question.code, { kind: "score", score: item.score, evidence: answer?.kind === "score" ? answer.evidence : "" })}
                  />
                  {item.label}
                </label>
              ))}
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="radio" name={question.code} disabled={locked} checked={answer?.kind === "notObserved"} onChange={() => setAnswer(question.code, { kind: "notObserved" })} />
                {NOT_OBSERVED_LABEL}
              </label>
            </div>
            {extreme && (
              <label className="mt-2 block text-sm">
                Exemplo observável
                <textarea
                  className="mt-1 min-h-20 w-full rounded-lg border border-border p-2"
                  disabled={locked}
                  value={answer.kind === "score" ? answer.evidence ?? "" : ""}
                  onChange={(event) => setAnswer(question.code, { kind: "score", score: answer.score, evidence: event.target.value })}
                />
              </label>
            )}
            {selfByCode[question.code] && <p className="mt-2 text-sm text-muted-foreground">Autoavaliação, depois do seu envio: {selfByCode[question.code]}</p>}
            {divergences.includes(question.code) && <p className="mt-1 text-sm">Diferença relevante nesta pergunta. A regra de corte ainda está em validação.</p>}
          </fieldset>
        );
      })}
      {!locked && questions.length > 0 && (
        <div className="flex gap-2">
          <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => void save()}>Salvar rascunho</button>
          <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => void submit()}>Enviar</button>
        </div>
      )}
      {locked && <p className="text-sm">Enviada. Uma nova versão só nasce se o RH devolver para revisão.</p>}
    </section>
  );
}
