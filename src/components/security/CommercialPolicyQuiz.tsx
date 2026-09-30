import React, { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, Lightbulb } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { submitPolicyAttempt, type PendingPolicy } from "@/src/lib/commercialPolicy/commercialPolicyClient";

type Question = PendingPolicy["questions"][number];

/** Resultado da última conferência de cada pergunta; ausente = ainda não conferida (ou respondida de novo). */
export type PolicyQuizResults = Record<string, { correct: boolean; explanation: string }>;

const LETTERS = ["A", "B", "C", "D", "E", "F"];

function hashText(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Ordem de exibição das alternativas: estável para a mesma pessoa e pergunta
 * (não muda ao voltar da leitura), mas sem posição fixa para a resposta certa.
 * A conferência continua pelo id da alternativa, no servidor.
 */
export function orderQuizOptions<T extends { id: string }>(options: readonly T[], seed: string): T[] {
  return [...options]
    .map((option) => ({ option, rank: hashText(`${seed}:${option.id}`) }))
    .sort((a, b) => a.rank - b.rank || a.option.id.localeCompare(b.option.id))
    .map((item) => item.option);
}

export const CommercialPolicyQuiz: React.FC<{
  policyVersionId: string;
  questions: Question[];
  /** Semente da ordem das alternativas (ex.: usuário + versão). */
  seed: string;
  answers: Record<string, string>;
  onAnswer: (questionId: string, optionId: string) => void;
  results: PolicyQuizResults;
  onResults: (results: PolicyQuizResults) => void;
  onPassed: () => void;
  onBack: () => void;
  onReview: (chapterId: string) => void;
  onError: (error: unknown) => void;
}> = ({ policyVersionId, questions, seed, answers, onAnswer, results, onResults, onPassed, onBack, onReview, onError }) => {
  const firstWrong = questions.findIndex((question) => results[question.id]?.correct === false);
  const firstOpen = questions.findIndex((question) => !answers[question.id]);
  // Ao voltar da releitura, retoma na pergunta que ainda precisa de atenção.
  const [index, setIndex] = useState(() => (firstWrong >= 0 ? firstWrong : firstOpen >= 0 ? firstOpen : 0));
  const [busy, setBusy] = useState(false);

  const total = questions.length;
  const question = questions[Math.min(index, total - 1)];
  const options = useMemo(() => (question ? orderQuizOptions(question.options, `${seed}:${question.id}`) : []), [question, seed]);

  if (!question) return null;

  const answered = questions.filter((item) => answers[item.id]).length;
  const wrong = questions.filter((item) => results[item.id]?.correct === false);
  const checkedCount = questions.filter((item) => results[item.id]).length;
  const correctCount = questions.filter((item) => results[item.id]?.correct).length;
  const result = results[question.id];
  const isLast = index === total - 1;
  const allAnswered = answered === total;

  const choose = (optionId: string) => {
    if (answers[question.id] === optionId) return;
    onAnswer(question.id, optionId);
    // Resposta trocada: a conferência anterior desta pergunta deixa de valer.
    if (result) {
      const { [question.id]: _dropped, ...rest } = results;
      onResults(rest);
    }
  };

  const check = () => {
    setBusy(true);
    void submitPolicyAttempt(
      policyVersionId,
      questions.map((item) => ({ questionId: item.id, optionId: answers[item.id] ?? "" }))
    )
      .then((attempt) => {
        if (attempt.passed) {
          onResults({});
          onPassed();
          return;
        }
        const next: PolicyQuizResults = {};
        for (const item of attempt.results) next[item.questionId] = { correct: item.correct, explanation: item.explanation };
        onResults(next);
        const target = questions.findIndex((item) => next[item.id]?.correct === false);
        if (target >= 0) setIndex(target);
      })
      .catch(onError)
      .finally(() => setBusy(false));
  };

  const goNext = () => {
    // Depois de uma conferência, "próxima" pula direto para a próxima que precisa de correção.
    if (wrong.length > 0) {
      const nextWrong = questions.findIndex((item, position) => position > index && results[item.id]?.correct === false);
      if (nextWrong >= 0) return setIndex(nextWrong);
    }
    if (!isLast) setIndex(index + 1);
  };

  return (
    <section className="space-y-5 rounded-2xl border border-border bg-card p-5 sm:p-7" data-testid="policy-quiz">
      <header className="space-y-1.5">
        <h1 className="text-xl font-bold">Vamos conferir o que você entendeu</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          São {total} perguntas rápidas sobre situações do dia a dia, uma de cada vez. Não tem pegadinha: se errar alguma, mostramos a explicação e você
          responde de novo, quantas vezes precisar.
        </p>
      </header>

      {checkedCount > 0 && wrong.length > 0 ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="status" data-testid="policy-quiz-summary">
          <p className="font-semibold">
            Você acertou {correctCount} de {total}. {wrong.length === 1 ? "Falta só 1 pergunta." : `Faltam ${wrong.length} perguntas.`}
          </p>
          <p className="mt-0.5 text-xs">Elas estão marcadas em amarelo abaixo. Leia a explicação, escolha outra resposta e confira de novo.</p>
        </div>
      ) : null}

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
          <span>
            Pergunta {index + 1} de {total}
          </span>
          <span>
            {answered} de {total} respondidas
          </span>
        </div>
        <div className="h-2 rounded-full bg-muted" aria-hidden>
          <div className="h-2 rounded-full bg-primary transition-all" style={{ width: `${(answered / total) * 100}%` }} />
        </div>
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Perguntas">
          {questions.map((item, position) => {
            const itemResult = results[item.id];
            const state = itemResult ? (itemResult.correct ? "correct" : "wrong") : answers[item.id] ? "answered" : "open";
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={position === index}
                aria-label={`Pergunta ${position + 1}${state === "wrong" ? ", precisa ser corrigida" : state === "correct" ? ", correta" : state === "answered" ? ", respondida" : ", sem resposta"}`}
                data-state={state}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold transition-colors",
                  state === "open" && "border-border bg-background text-muted-foreground",
                  state === "answered" && "border-primary/40 bg-primary/10 text-primary",
                  state === "correct" && "border-emerald-300 bg-emerald-50 text-emerald-800",
                  state === "wrong" && "border-amber-400 bg-amber-100 text-amber-900",
                  position === index && "ring-2 ring-primary ring-offset-2 ring-offset-card"
                )}
                onClick={() => setIndex(position)}
              >
                {state === "correct" ? <Check className="h-3.5 w-3.5" /> : position + 1}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-3">
        <h2 id={`quiz-${question.id}`} className="text-lg font-semibold leading-snug">
          {question.prompt}
        </h2>
        <div role="radiogroup" aria-labelledby={`quiz-${question.id}`} className="space-y-2.5">
          {options.map((option, position) => {
            const selected = answers[question.id] === option.id;
            const selectedWrong = selected && result?.correct === false;
            const selectedRight = selected && result?.correct === true;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                className={cn(
                  "flex w-full items-start gap-3 rounded-xl border px-4 py-3.5 text-left text-[15px] leading-relaxed transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                  !selected && "border-border bg-background hover:border-primary/50 hover:bg-accent/50",
                  selected && !result && "border-primary bg-primary/10",
                  selectedWrong && "border-amber-400 bg-amber-50 text-amber-950",
                  selectedRight && "border-emerald-400 bg-emerald-50 text-emerald-950"
                )}
                onClick={() => choose(option.id)}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold",
                    selected ? "border-transparent bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground"
                  )}
                  aria-hidden
                >
                  {LETTERS[position] ?? position + 1}
                </span>
                <span>{option.text}</span>
              </button>
            );
          })}
        </div>

        {result?.correct === true ? (
          <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
            <CheckCircle2 className="h-4 w-4" /> Resposta certa.
          </p>
        ) : null}
        {result?.correct === false ? (
          <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950" data-testid="policy-quiz-explanation">
            <p className="flex items-center gap-2 font-semibold">
              <Lightbulb className="h-4 w-4" /> Ainda não é essa. Veja o que a Política diz:
            </p>
            <p className="leading-relaxed">{result.explanation}</p>
            {question.reviewChapterId ? (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary"
                onClick={() => onReview(question.reviewChapterId ?? "")}
              >
                <BookOpen className="h-4 w-4" /> Reler este trecho da Política
              </button>
            ) : null}
            <p className="text-xs">Escolha outra resposta acima para tentar de novo.</p>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold hover:bg-accent/60"
          onClick={() => (index === 0 ? onBack() : setIndex(index - 1))}
        >
          <ArrowLeft className="h-4 w-4" /> {index === 0 ? "Voltar às regras" : "Anterior"}
        </button>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!isLast || wrong.some((item) => questions.indexOf(item) > index) ? (
            <button
              type="button"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold",
                allAnswered ? "border border-border hover:bg-accent/60" : "bg-primary text-primary-foreground hover:opacity-90"
              )}
              onClick={goNext}
            >
              Próxima <ArrowRight className="h-4 w-4" />
            </button>
          ) : null}
          {allAnswered || isLast ? (
            <button
              type="button"
              disabled={busy || !allAnswered}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
              onClick={check}
            >
              {busy
                ? "Conferindo…"
                : !allAnswered
                  ? total - answered === 1
                    ? "Falta responder 1 pergunta"
                    : `Faltam ${total - answered} perguntas`
                  : checkedCount > 0
                    ? "Conferir de novo"
                    : "Conferir respostas"}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
};
