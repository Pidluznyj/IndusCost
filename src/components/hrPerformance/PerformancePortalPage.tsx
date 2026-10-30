/**
 * Portal do colaborador: uma pergunta por tela, para quem tem pouca familiaridade com
 * tecnologia. Cada toque é salvo no servidor; sem internet, a resposta fica na fila e o
 * envio é repetido sozinho. O token do QR vai no fragmento (#t=) e é apagado da barra
 * antes de qualquer pedido. Sem login administrativo e sem instalar aplicativo.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FREQUENCY_SCALE, NOT_OBSERVED_LABEL, PILLAR_LABELS, type Pillar } from "@/src/lib/hrPerformance/performanceDomain";
import { commentProblem, commentRequired } from "@/src/lib/hrPerformance/performanceLeadership";
import {
  claimAssistedPerformance,
  fetchPerformanceForm,
  logoutPerformancePortal,
  openPerformanceInvite,
  savePerformanceForm,
  submitPerformanceForm,
  verifyPerformanceOtp,
  type PublicForm,
} from "@/src/lib/hrPerformance/performancePortalClient";
import "./performance-portal.css";

/** Nas etapas de liderança a resposta leva um comentário (obrigatório nas notas 1 e 4). */
type Answer = { kind: "score"; score: number; comment?: string } | { kind: "notObserved"; comment?: string } | { kind: "pending" };
type Step = "boot" | "code" | "intro" | "form" | "review" | "done" | "expired" | "blocked";
type SaveState = "idle" | "saving" | "saved" | "offline" | "error";

const NEUTRAL = "Não foi possível abrir esta pesquisa.";

/** Chamadas que a tela usa: o portal público (QR) ou a autoavaliação dentro do sistema (usuário logado). */
export type PortalApi = {
  fetchForm: typeof fetchPerformanceForm;
  saveForm: typeof savePerformanceForm;
  submitForm: typeof submitPerformanceForm;
  logout: typeof logoutPerformancePortal;
};
const PUBLIC_API: PortalApi = { fetchForm: fetchPerformanceForm, saveForm: savePerformanceForm, submitForm: submitPerformanceForm, logout: logoutPerformancePortal };

function answerLabel(answer: Answer | undefined): string | null {
  if (!answer || answer.kind === "pending") return null;
  if (answer.kind === "notObserved") return NOT_OBSERVED_LABEL;
  return FREQUENCY_SCALE.find((s) => s.score === answer.score)?.label ?? null;
}

/**
 * `embedded`: dentro do sistema (aba "Minha avaliação"). Sem QR, código ou botão Sair; a sessão é a do login.
 */
const brDate = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

export function PerformancePortalPage({ api = PUBLIC_API, embedded = false, onFinished }: { api?: PortalApi; embedded?: boolean; onFinished?: () => void } = {}) {
  const [step, setStep] = useState<Step>("boot");
  const [message, setMessage] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<PublicForm | null>(null);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [index, setIndex] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [confirmed, setConfirmed] = useState(false);
  const [assisted, setAssisted] = useState(false);
  /** Etapa que acabou de ser enviada: a tela confirma o envio mesmo quando a próxima etapa ainda não abriu. */
  const [sentTitle, setSentTitle] = useState<string | null>(null);
  const versionRef = useRef(0);
  const stepRef = useRef<string | undefined>(undefined);
  const pendingRef = useRef<Map<string, Answer>>(new Map<string, Answer>());
  const flushing = useRef<Promise<boolean> | null>(null);
  const retryTimer = useRef<number | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const booted = useRef(false);

  const applyForm = useCallback((payload: PublicForm, keepLocal: boolean) => {
    setForm(payload);
    setAssisted(payload.assisted);
    versionRef.current = payload.version;
    stepRef.current = payload.step?.kind;
    const fromServer: Record<string, Answer> = {};
    for (const a of payload.answers) {
      const comment = a.comment ?? undefined;
      if (a.kind === "score" && a.score) fromServer[a.questionCode] = { kind: "score", score: a.score, comment };
      else if (a.kind === "notObserved") fromServer[a.questionCode] = { kind: "notObserved", comment };
      else fromServer[a.questionCode] = { kind: "pending" };
    }
    if (keepLocal) for (const [code, answer] of [...pendingRef.current.entries()] as [string, Answer][]) fromServer[code] = answer;
    setAnswers(fromServer);
    return fromServer;
  }, []);

  const loadForm = useCallback(
    async (opts: { resume: boolean; keepLocal?: boolean }) => {
      const result = await api.fetchForm();
      if (!result.ok || !result.questions || result.version == null) {
        if (result.offline) {
          setMessage(result.message ?? "Sem internet.");
          return false;
        }
        // Etapa fora do calendário ("abre em dd/mm") ou nada pendente: a mensagem do servidor explica.
        const explained = result.code === "STAGE_CLOSED" || result.code === "NO_PENDING";
        setStep(opts.resume || explained ? "blocked" : "expired");
        setMessage(explained ? result.message ?? NEUTRAL : opts.resume ? null : NEUTRAL);
        return false;
      }
      const loaded: Record<string, Answer> = applyForm(result as PublicForm, Boolean(opts.keepLocal));
      if (opts.resume) {
        const first = (result.questions ?? []).findIndex((q) => !loaded[q.code] || loaded[q.code]!.kind === "pending");
        setIndex(first < 0 ? 0 : first);
        setStep(first < 0 ? "review" : Object.values(loaded).some((a) => a.kind !== "pending") ? "form" : "intro");
      }
      return true;
    },
    [api, applyForm]
  );

  useEffect(() => {
    // Uma vez só: o token de assistência vale uma única troca (o modo estrito do React
    // executaria o efeito duas vezes).
    if (booted.current) return;
    booted.current = true;
    if (embedded) {
      void loadForm({ resume: true });
      return;
    }
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const assistToken = params.get("a");
    const linkToken = params.get("t");
    if (assistToken || linkToken) window.history.replaceState(null, "", window.location.pathname);
    (async () => {
      if (assistToken) {
        const claimed = await claimAssistedPerformance(assistToken);
        if (!claimed.ok) {
          setStep("expired");
          setMessage(claimed.message ?? NEUTRAL);
          return;
        }
        await loadForm({ resume: true });
        return;
      }
      if (linkToken) {
        const opened = await openPerformanceInvite(linkToken);
        if (!opened.ok) {
          setStep("expired");
          setMessage(opened.message ?? NEUTRAL);
          return;
        }
        setStep("code");
        return;
      }
      await loadForm({ resume: true });
    })();
  }, [embedded, loadForm]);

  useEffect(() => {
    if (embedded && step === "boot") return;
    headingRef.current?.focus();
  }, [step, index]);

  const flush = useCallback(async (): Promise<boolean> => {
    if (flushing.current) return flushing.current;
    if (pendingRef.current.size === 0) return true;
    const run = (async () => {
      const batch = [...pendingRef.current.entries()];
      setSaveState("saving");
      const result = await api.saveForm(
        versionRef.current,
        batch.map(([code, answer]) => ({
          code,
          answer: answer.kind === "score" ? { kind: "score", score: answer.score, evidence: answer.comment ?? null } : answer.kind === "notObserved" ? { kind: "notObserved", evidence: answer.comment ?? null } : { kind: "pending" },
        })),
        stepRef.current
      );
      if (result.ok && result.version != null) {
        versionRef.current = result.version;
        for (const [code, answer] of batch) if (pendingRef.current.get(code) === answer) pendingRef.current.delete(code);
        setSaveState(pendingRef.current.size ? "saving" : "saved");
        return true;
      }
      if (result.offline || result.code === "RATE_LIMIT") {
        setSaveState("offline");
        if (retryTimer.current) window.clearTimeout(retryTimer.current);
        retryTimer.current = window.setTimeout(() => void flush(), 5000);
        return false;
      }
      if (result.code === "EXPIRED") {
        setStep("expired");
        setMessage("Sua sessão terminou. Abra o QR de novo ou procure o RH. O que já foi salvo continua guardado.");
        return false;
      }
      if (result.code === "VERSION_CONFLICT") {
        const reloaded = await loadForm({ resume: false, keepLocal: true });
        if (reloaded) {
          flushing.current = null;
          return flush();
        }
        return false;
      }
      setSaveState("error");
      setMessage(result.message ?? "Não conseguimos salvar. Tente de novo.");
      return false;
    })();
    flushing.current = run;
    try {
      return await run;
    } finally {
      if (flushing.current === run) flushing.current = null;
    }
  }, [api, loadForm]);

  useEffect(() => {
    const online = () => void flush();
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("online", online);
      if (retryTimer.current) window.clearTimeout(retryTimer.current);
    };
  }, [flush]);

  const questions = form?.questions ?? [];
  const question = questions[index];
  const answeredCount = useMemo(() => questions.filter((q) => answers[q.code] && answers[q.code]!.kind !== "pending").length, [questions, answers]);
  const missing = questions.filter((q) => !answers[q.code] || answers[q.code]!.kind === "pending");
  const commentRule = form?.step?.commentRule ?? null;
  /** Mesma regra do servidor: nota 1 ou 4 pede comentário que descreva o observado. */
  const commentIssue = (answer: Answer | undefined): string | null =>
    commentRule && answer?.kind === "score" && commentRequired(answer.score) ? commentProblem(answer.comment, commentRule.minLetters) : null;
  const commentMissing = questions.filter((q) => commentIssue(answers[q.code]));
  const setComment = (code: string, comment: string) => {
    setAnswers((current) => {
      const answer = current[code];
      if (!answer || answer.kind === "pending") return current;
      return { ...current, [code]: { ...answer, comment } };
    });
  };
  /** Grava o comentário quando a pessoa sai do campo ou avança. */
  const commitComment = (code: string) => {
    const answer = answers[code];
    if (!answer || answer.kind === "pending") return;
    pendingRef.current.set(code, answer);
    void flush();
  };

  const choose = (code: string, answer: Answer) => {
    // Trocar a nota mantém o comentário já escrito.
    const previous = answers[code];
    if (answer.kind !== "pending" && previous && previous.kind !== "pending" && previous.comment) answer = { ...answer, comment: previous.comment };
    setAnswers((current) => ({ ...current, [code]: answer }));
    pendingRef.current.set(code, answer);
    setMessage(null);
    void flush();
  };

  const verify = async () => {
    setBusy(true);
    setMessage(null);
    const result = await verifyPerformanceOtp(otp.replace(/\D/g, ""));
    setBusy(false);
    if (!result.ok) {
      setMessage(result.message ?? NEUTRAL);
      return;
    }
    setOtp("");
    await loadForm({ resume: true });
  };

  const send = async () => {
    setBusy(true);
    setMessage(null);
    const flushed = await flush();
    if (!flushed) {
      setBusy(false);
      setMessage("Ainda não conseguimos salvar tudo. Confira a internet e toque em Enviar de novo.");
      return;
    }
    const result = await api.submitForm(versionRef.current, assisted ? confirmed : true, stepRef.current);
    setBusy(false);
    if (!result.ok) {
      if (result.code === "EXPIRED") {
        setStep("expired");
        setMessage("Sua sessão terminou antes do envio. O que foi salvo continua guardado; abra o QR de novo.");
        return;
      }
      setMessage(result.offline ? "Sem internet. Toque em Enviar quando a conexão voltar." : result.message ?? "Não foi possível enviar.");
      return;
    }
    onFinished?.();
    if (result.done === false) {
      // Próxima etapa na mesma sessão: nada de novo QR, código ou login.
      setSentTitle(form?.step?.title ?? null);
      pendingRef.current.clear();
      setConfirmed(false);
      setIndex(0);
      await loadForm({ resume: true });
      return;
    }
    setStep("done");
    if (assisted) void api.logout();
  };

  const leave = async () => {
    await flush();
    await api.logout();
    setForm(null);
    setAnswers({});
    setStep("blocked");
    setMessage("Você saiu. O que foi salvo continua guardado. Para continuar, abra o QR de novo.");
  };

  const saveText =
    saveState === "saving" ? "Salvando…" : saveState === "saved" ? "Resposta salva ✓" : saveState === "offline" ? "Sem internet: sua resposta está guardada e vamos tentar de novo." : saveState === "error" ? "Não salvou. Toque de novo." : "";

  return (
    <div className={embedded ? "pp pp-embedded" : "pp"} lang="pt-BR" data-testid={embedded ? "my-evaluation" : undefined}>
      <main className="pp-main">
        <div className="pp-top">
          <span className="pp-brand">{embedded ? "Minha avaliação" : "IndusCost · RH"}</span>
          {!embedded && form && (step === "form" || step === "review" || step === "intro") ? (
            <button type="button" className="pp-link" onClick={() => void leave()} data-testid="portal-leave">
              Sair
            </button>
          ) : null}
        </div>

        {step === "boot" ? <p className="pp-muted">Abrindo a pesquisa…</p> : null}

        {step === "code" ? (
          <form
            className="pp-card"
            onSubmit={(e) => {
              e.preventDefault();
              void verify();
            }}
            data-testid="portal-code"
          >
            <h1 ref={headingRef} tabIndex={-1}>
              Confirme que é você
            </h1>
            <p>Digite o código de 6 números que o RH falou para você. Ele não está escrito na folha.</p>
            <label htmlFor="pp-otp" className="pp-muted">
              Código de confirmação
            </label>
            <input
              id="pp-otp"
              className="pp-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              data-testid="portal-otp"
            />
            {message ? (
              <p className="pp-alert pp-alert-danger" role="alert">
                {message}
              </p>
            ) : null}
            <button type="submit" className="pp-btn pp-btn-primary" disabled={busy || otp.length !== 6} data-testid="portal-otp-submit">
              {busy ? "Conferindo…" : "Continuar"}
            </button>
          </form>
        ) : null}

        {form && form.step && form.step.total > 1 && (step === "intro" || step === "form" || step === "review") ? (
          <p className="pp-steps" data-testid="portal-step">
            Etapa {form.step.index} de {form.step.total} · {form.step.title}
          </p>
        ) : null}

        {step === "intro" && form && form.step && form.step.kind !== "SELF" ? (
          <section className="pp-card" data-testid="portal-step-intro">
            {form.step.kind === "LEADERSHIP_UPWARD" ? <p className="pp-alert pp-alert-ok">{form.step.intro.split(". ")[0]}.</p> : null}
            <h1 ref={headingRef} tabIndex={-1}>
              {form.step.kind === "LEADERSHIP_UPWARD" ? `Como é a liderança de ${form.step.subjectFirstName ?? "seu gestor"}?` : form.step.title}
            </h1>
            <p>{form.step.kind === "LEADERSHIP_UPWARD" ? form.step.intro.split(". ").slice(1).join(". ") : form.step.intro}</p>
            <p>São {questions.length} perguntas, uma por tela, no mesmo período de referência.</p>
            {form.opensAt ? (
              <p className="pp-alert pp-alert-ok" data-testid="portal-answer-ahead">
                Esta etapa abre em {brDate(form.opensAt)}, mas você já pode responder agora, se quiser. Se preferir, volte até {brDate(form.dueAt)}.
              </p>
            ) : null}
            <p className="pp-muted">Nas respostas “Nunca ou quase nunca” e “Sempre ou quase sempre”, conte um comportamento ou situação que você observou. Não precisa citar nomes.</p>
            {form.step.kind === "LEADERSHIP_UPWARD" ? (
              <p className="pp-muted" data-testid="portal-upward-privacy">
                Aqui a sua voz conta de verdade. Suas respostas sobre o líder entram numa média com as dos colegas e só aparecem quando houver respostas suficientes. Seu líder não vê quem respondeu o quê, nem lê os comentários: ninguém lê. Pode falar com sinceridade.
              </p>
            ) : null}
            <button type="button" className="pp-btn pp-btn-primary" onClick={() => setStep("form")} data-testid="portal-start">
              {form.opensAt ? "Responder agora" : "Começar"}
            </button>
            {form.opensAt ? (
              <button
                type="button"
                className="pp-link"
                onClick={() => {
                  setStep("blocked");
                  setMessage(`Tudo certo. Você pode responder esta etapa quando quiser, até ${brDate(form.dueAt)}.`);
                }}
                data-testid="portal-answer-later"
              >
                Responder depois
              </button>
            ) : null}
          </section>
        ) : null}

        {step === "intro" && form && (!form.step || form.step.kind === "SELF") ? (
          <section className="pp-card" data-testid="portal-intro">
            <h1 ref={headingRef} tabIndex={-1}>
              Olá, {form.employeeName.split(" ")[0]}. Que bom ter você aqui.
            </h1>
            <p>
              Esta é a sua vez de contar como foi o seu trabalho no período. São {questions.length} perguntas curtas, uma por tela, e leva uns 10 minutos.
              {form.step && form.step.total > 1 ? ` Depois vêm mais ${form.step.total - 1} etapa(s) curta(s) sobre liderança.` : ""}
            </p>
            <p>{form.instructions}</p>
            <p className="pp-muted">
              Não existe resposta certa ou errada: o que vale é a sua percepção. Suas respostas não são anônimas, e é isso que permite a conversa de desenvolvimento com você depois. Cada toque fica salvo; se a internet cair, você continua de onde parou.
            </p>
            {assisted ? <p className="pp-alert pp-alert-warn">Preenchimento com ajuda do RH. As respostas são suas: no final, você confere e confirma.</p> : null}
            <button type="button" className="pp-btn pp-btn-primary" onClick={() => setStep("form")} data-testid="portal-start">
              Começar
            </button>
          </section>
        ) : null}

        {step === "form" && form && question ? (
          <section className="pp-card" style={{ flex: 1 }} data-testid="portal-question">
            <div className="pp-progress" aria-label={`Pergunta ${index + 1} de ${questions.length}`}>
              <span className="pp-muted" data-testid="portal-progress">
                Pergunta {index + 1} de {questions.length} · {answeredCount} respondida(s)
              </span>
              <div className="pp-progress-bar" aria-hidden>
                <span style={{ width: `${Math.round(((index + 1) / questions.length) * 100)}%` }} />
              </div>
            </div>
            <p className="pp-pillar">{question.pillar === "LEADERSHIP" ? question.competency ?? "Liderança" : PILLAR_LABELS[question.pillar as Pillar] ?? question.pillar}</p>
            <h2 ref={headingRef} tabIndex={-1} id="pp-question" data-testid="portal-question-text">
              {question.text}
            </h2>
            <div className="pp-options" role="group" aria-labelledby="pp-question">
              {FREQUENCY_SCALE.map((item) => {
                const on = answers[question.code]?.kind === "score" && (answers[question.code] as { score: number }).score === item.score;
                return (
                  <button key={item.score} type="button" className="pp-option" aria-pressed={on} onClick={() => choose(question.code, { kind: "score", score: item.score })} data-testid={`portal-option-${item.score}`}>
                    {item.label}
                  </button>
                );
              })}
              <button
                type="button"
                className="pp-option pp-option-na"
                aria-pressed={answers[question.code]?.kind === "notObserved"}
                onClick={() => choose(question.code, { kind: "notObserved" })}
                data-testid="portal-option-na"
              >
                {NOT_OBSERVED_LABEL}
              </button>
            </div>
            {commentRule && answers[question.code] && answers[question.code]!.kind !== "pending" ? (
              <div className="pp-comment">
                <label htmlFor="pp-comment" className="pp-muted">
                  {commentIssue(answers[question.code]) !== null || (answers[question.code]!.kind === "score" && commentRequired((answers[question.code] as { score: number }).score))
                    ? "Conte o que você observou (obrigatório nesta resposta)"
                    : "Comentário (opcional)"}
                </label>
                <textarea
                  id="pp-comment"
                  className="pp-input pp-textarea"
                  rows={3}
                  maxLength={600}
                  value={(answers[question.code] as { comment?: string }).comment ?? ""}
                  onChange={(e) => setComment(question.code, e.target.value)}
                  onBlur={() => commitComment(question.code)}
                  placeholder="Ex.: avisou a equipe da mudança de turno com uma semana de antecedência."
                  data-testid="portal-comment"
                />
                {commentIssue(answers[question.code]) ? (
                  <p className="pp-alert pp-alert-warn" data-testid="portal-comment-hint">
                    {commentIssue(answers[question.code])}
                  </p>
                ) : null}
              </div>
            ) : null}
            <p className={`pp-status ${saveState === "saved" ? "pp-status-ok" : saveState === "offline" || saveState === "error" ? "pp-status-warn" : ""}`} aria-live="polite" data-testid="portal-save-state">
              {saveText}
            </p>
            {message ? (
              <p className="pp-alert pp-alert-danger" role="alert">
                {message}
              </p>
            ) : null}
            <div className="pp-nav">
              <button type="button" className="pp-btn" disabled={index === 0} onClick={() => setIndex((v) => Math.max(0, v - 1))} data-testid="portal-back">
                Voltar
              </button>
              <button
                type="button"
                className="pp-btn pp-btn-primary"
                disabled={!answers[question.code] || answers[question.code]!.kind === "pending" || commentIssue(answers[question.code]) !== null}
                onClick={() => {
                  if (commentRule) commitComment(question.code);
                  void flush();
                  if (index < questions.length - 1) setIndex(index + 1);
                  else setStep("review");
                }}
                data-testid="portal-next"
              >
                {index < questions.length - 1 ? "Próxima" : "Revisar"}
              </button>
            </div>
          </section>
        ) : null}

        {step === "review" && form ? (
          <section className="pp-card" data-testid="portal-review">
            <h1 ref={headingRef} tabIndex={-1}>
              Confira suas respostas
            </h1>
            <p className="pp-muted">Toque em “Alterar” se quiser mudar alguma. {embedded ? "Depois do envio, não dá para mudar." : "Depois do envio, não dá para mudar por este convite."}</p>
            <ol className="pp-review">
              {questions.map((q, i) => {
                const text = answerLabel(answers[q.code]);
                return (
                  <li key={q.code}>
                    <span className="pp-muted">
                      {i + 1}. {q.text}
                    </span>
                    {text ? <span className="pp-review-answer">{text}</span> : <span className="pp-review-missing">Sem resposta</span>}
                    {commentRule && answers[q.code] && answers[q.code]!.kind !== "pending" && (answers[q.code] as { comment?: string }).comment ? (
                      <span className="pp-muted">“{(answers[q.code] as { comment?: string }).comment}”</span>
                    ) : null}
                    <button
                      type="button"
                      className="pp-link"
                      onClick={() => {
                        setIndex(i);
                        setStep("form");
                      }}
                    >
                      Alterar
                    </button>
                  </li>
                );
              })}
            </ol>
            {assisted ? (
              <label className="pp-check">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} data-testid="portal-assist-confirm" />
                <span>Eu, {form.employeeName}, conferi e confirmo que estas respostas são minhas.</span>
              </label>
            ) : null}
            <p className={`pp-status ${saveState === "offline" ? "pp-status-warn" : ""}`} aria-live="polite">
              {saveState === "offline" ? saveText : ""}
            </p>
            {message ? (
              <p className="pp-alert pp-alert-danger" role="alert">
                {message}
              </p>
            ) : null}
            {missing.length ? <p className="pp-alert pp-alert-warn">Faltam {missing.length} resposta(s).</p> : null}
            {commentMissing.length ? <p className="pp-alert pp-alert-warn">Falta comentário em {commentMissing.length} resposta(s) extrema(s).</p> : null}
            <button
              type="button"
              className="pp-btn pp-btn-primary"
              disabled={busy || missing.length > 0 || commentMissing.length > 0 || (assisted && !confirmed)}
              onClick={() => void send()}
              data-testid="portal-send"
            >
              {busy ? "Enviando…" : form.step && form.step.index < form.step.total ? "Enviar e continuar" : "Enviar respostas"}
            </button>
          </section>
        ) : null}

        {step === "done" ? (
          <section className="pp-card" data-testid="portal-done">
            <h1 ref={headingRef} tabIndex={-1}>
              Obrigado, {form?.employeeName.split(" ")[0] ?? "você"}. Sua voz foi registrada.
            </h1>
            <p className="pp-alert pp-alert-ok">Tudo enviado. Não precisa fazer mais nada por aqui.</p>
            <p>
              <strong>O que acontece agora:</strong> o seu líder faz a avaliação dele, o RH confere tudo com cuidado e, depois disso, vocês dois conversam sobre o resultado e sobre o seu desenvolvimento. Esse é o momento de ouvir e de ser ouvido.
            </p>
            <p className="pp-muted">{assisted ? "Pode devolver o aparelho para o RH." : embedded ? "Você pode continuar usando o sistema normalmente." : "Você já pode fechar esta página."}</p>
          </section>
        ) : null}

        {step === "expired" || step === "blocked" ? (
          <section className="pp-card" data-testid="portal-closed">
            {sentTitle && step === "blocked" ? (
              <p className="pp-alert pp-alert-ok" data-testid="portal-step-sent">
                {sentTitle}: enviada ✓
              </p>
            ) : null}
            <h1 ref={headingRef} tabIndex={-1}>
              {step === "expired" ? "Pesquisa indisponível" : sentTitle ? "Próxima etapa" : "Pesquisa de desempenho"}
            </h1>
            <p>{message ?? (embedded ? "Você não tem pesquisa de desempenho aberta agora." : "Para responder, aponte a câmera do celular para o QR que o RH entregou.")}</p>
            <p className="pp-muted">Dúvidas: procure o RH da sua unidade.</p>
          </section>
        ) : null}
      </main>
    </div>
  );
}
