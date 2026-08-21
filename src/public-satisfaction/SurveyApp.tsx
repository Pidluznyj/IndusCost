/**
 * Formulário público de Satisfação — app isolado.
 *
 * Não importa NADA do app administrativo: sem AuthProvider, sem sidebar, sem
 * React Router, sem design system interno. O cliente baixa só isto.
 *
 * Fluxo: lê o token do fragmento → troca por sessão → carrega formulário →
 * autosave com debounce → envia. Estados terminais cobrem link inválido,
 * expirado, revogado, pesquisa encerrada e "já respondida".
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ─── Contratos do DTO público (espelho do backend, sem importar server code) ──

type PublicQuestion = {
  code: string;
  label: string;
  helpText: string | null;
  type: "RATING" | "TEXT" | "SHORT_TEXT" | "PHONE" | "DATE" | "TAX_ID" | string;
  required: boolean;
  scaleMin: number | null;
  scaleMax: number | null;
};

type PublicForm = {
  surveyTitle: string;
  surveyDescription: string | null;
  referencePeriod: { start: string; end: string };
  customerDisplayName: string | null;
  requiresSelfIdentification: boolean;
  questions: PublicQuestion[];
  draft: {
    version: number;
    answers: Array<{
      questionCode: string;
      ratingValue: number | null;
      textValue: string | null;
      dateValue: string | null;
    }>;
    respondentName: string | null;
    respondentPhone: string | null;
  } | null;
  ratingScale: Array<{ value: number; label: string }>;
  turnstileSiteKey: string | null;
};

type AnswerState = Record<string, { rating?: number; text?: string; date?: string }>;

type Phase =
  | { kind: "loading" }
  | { kind: "form"; form: PublicForm }
  | { kind: "done" }
  | { kind: "unavailable"; reason: string; message: string };

const AUTOSAVE_DEBOUNCE_MS = 1200;

/** Mensagens dos estados terminais — linguagem de cliente, não de sistema. */
const TERMINAL_COPY: Record<string, { icon: string; title: string; text: string }> = {
  ALREADY_ANSWERED: {
    icon: "✅",
    title: "Suas respostas já foram registradas",
    text: "Obrigado por participar! Não é necessário responder novamente.",
  },
  CLOSED: {
    icon: "📋",
    title: "Pesquisa encerrada",
    text: "O prazo para responder já terminou. Agradecemos o interesse!",
  },
  NOT_STARTED: {
    icon: "🗓️",
    title: "Pesquisa ainda não começou",
    text: "Este link ficará ativo assim que a pesquisa for aberta.",
  },
  EXPIRED: {
    icon: "⏳",
    title: "Link expirado",
    text: "Peça um novo link ao seu contato comercial.",
  },
  REVOKED: {
    icon: "🔒",
    title: "Link não é mais válido",
    text: "Peça um novo link ao seu contato comercial.",
  },
  INVALID: {
    icon: "🔍",
    title: "Link inválido",
    text: "Confira se o endereço foi copiado por inteiro, incluindo o final.",
  },
  NETWORK: {
    icon: "📡",
    title: "Não foi possível conectar",
    text: "Verifique sua conexão e tente abrir o link novamente.",
  },
};

/** Lê o token do fragmento e o remove da barra de endereços. */
function consumeTokenFromFragment(): string | null {
  const raw = window.location.hash.replace(/^#/, "").trim();
  if (!raw) return null;
  const token = raw.startsWith("token=") ? raw.slice("token=".length) : raw;
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return null;
  // Tira o segredo da barra de endereços/histórico assim que é consumido.
  window.history.replaceState(null, "", window.location.pathname);
  return token;
}

async function postJson(url: string, body: unknown): Promise<any> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  return response.json();
}

function MessageScreen(props: { reason: string; message?: string }) {
  const copy = TERMINAL_COPY[props.reason] ?? TERMINAL_COPY.INVALID!;
  return (
    <div className="sat-centered">
      <div className="sat-message-card" role="status" aria-live="polite">
        <div className="sat-message-icon" aria-hidden="true">
          {copy.icon}
        </div>
        <h1 className="sat-message-title">{copy.title}</h1>
        <p className="sat-message-text">{props.message || copy.text}</p>
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="sat-centered">
      <div className="sat-message-card">
        <div className="sat-spinner" aria-hidden="true" />
        <p className="sat-message-text" role="status">
          Carregando sua pesquisa…
        </p>
      </div>
    </div>
  );
}

export function SurveyApp() {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [answers, setAnswers] = useState<AnswerState>({});
  const [respondentName, setRespondentName] = useState("");
  const [respondentPhone, setRespondentPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [saveHint, setSaveHint] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const versionRef = useRef<number | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Gerada UMA vez por sessão: é o que torna o reenvio idempotente. */
  const idempotencyKey = useRef<string>(
    (globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random()}`) as string
  );

  // ── Boot: troca token → sessão e carrega o formulário ────────────────────
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const token = consumeTokenFromFragment();
        if (token) {
          const session = await postJson("/api/public/satisfaction/session", { token });
          if (cancelled) return;
          if (!session?.ok) {
            setPhase({
              kind: "unavailable",
              reason: session?.reason ?? "INVALID",
              message: session?.message ?? "",
            });
            return;
          }
        }

        const response = await fetch("/api/public/satisfaction/form", {
          credentials: "same-origin",
        });
        const payload = await response.json();
        if (cancelled) return;

        if (!payload?.ok) {
          setPhase({
            kind: "unavailable",
            reason: payload?.reason ?? "INVALID",
            message: payload?.message ?? "",
          });
          return;
        }

        const form = payload.form as PublicForm;
        const initial: AnswerState = {};
        for (const answer of form.draft?.answers ?? []) {
          initial[answer.questionCode] = {
            rating: answer.ratingValue ?? undefined,
            text: answer.textValue ?? undefined,
            date: answer.dateValue ? answer.dateValue.slice(0, 10) : undefined,
          };
        }
        setAnswers(initial);
        setRespondentName(form.draft?.respondentName ?? "");
        setRespondentPhone(form.draft?.respondentPhone ?? "");
        versionRef.current = form.draft?.version ?? null;
        setPhase({ kind: "form", form });
      } catch {
        if (!cancelled) {
          setPhase({ kind: "unavailable", reason: "NETWORK", message: "" });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const form = phase.kind === "form" ? phase.form : null;

  /** Payload COMPLETO — o backend trata rascunho como estado inteiro, não delta. */
  const buildAnswerPayload = useCallback(() => {
    if (!form) return [];
    return form.questions
      .map((question) => {
        const value = answers[question.code];
        if (!value) return null;
        if (question.type === "RATING") {
          return value.rating != null
            ? { questionCode: question.code, ratingValue: value.rating }
            : null;
        }
        if (question.type === "DATE") {
          return value.date ? { questionCode: question.code, dateValue: value.date } : null;
        }
        return value.text?.trim()
          ? { questionCode: question.code, textValue: value.text }
          : null;
      })
      .filter(Boolean);
  }, [answers, form]);

  // ── Autosave com debounce ───────────────────────────────────────────────
  const scheduleSave = useCallback(() => {
    if (!form) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        setSaveHint("Salvando…");
        const result = await fetch("/api/public/satisfaction/draft", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            answers: buildAnswerPayload(),
            respondentName,
            respondentPhone,
            expectedVersion: versionRef.current,
          }),
        }).then((r) => r.json());

        if (result?.ok) {
          versionRef.current = result.version;
          setSaveHint("Respostas salvas");
        } else if (result?.reason === "VERSION_CONFLICT") {
          versionRef.current = result.currentVersion ?? null;
          setSaveHint("Atualizado em outra aba — recarregue se necessário");
        } else {
          setSaveHint("");
        }
      } catch {
        // Perda temporária de rede não pode assustar o cliente: ele continua
        // preenchendo e o envio final é o que realmente importa.
        setSaveHint("Sem conexão — suas respostas continuam nesta tela");
      }
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [buildAnswerPayload, form, respondentName, respondentPhone]);

  useEffect(() => {
    if (phase.kind !== "form") return;
    scheduleSave();
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [answers, respondentName, respondentPhone, phase.kind, scheduleSave]);

  const setRating = (code: string, rating: number) => {
    setAnswers((prev) => ({ ...prev, [code]: { ...prev[code], rating } }));
    setErrors((prev) => ({ ...prev, [code]: "" }));
  };

  const setText = (code: string, text: string) => {
    setAnswers((prev) => ({ ...prev, [code]: { ...prev[code], text } }));
    setErrors((prev) => ({ ...prev, [code]: "" }));
  };

  const setDate = (code: string, date: string) => {
    setAnswers((prev) => ({ ...prev, [code]: { ...prev[code], date } }));
    setErrors((prev) => ({ ...prev, [code]: "" }));
  };

  const progress = useMemo(() => {
    if (!form) return { answered: 0, total: 0, percent: 0 };
    const required = form.questions.filter((q) => q.required);
    const answered = required.filter((q) => {
      const value = answers[q.code];
      if (!value) return false;
      if (q.type === "RATING") return value.rating != null;
      if (q.type === "DATE") return Boolean(value.date);
      return Boolean(value.text?.trim());
    }).length;
    return {
      answered,
      total: required.length,
      percent: required.length === 0 ? 0 : Math.round((answered / required.length) * 100),
    };
  }, [answers, form]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form || submitting) return;

    // Validação no cliente é só cortesia — o servidor valida de novo.
    const nextErrors: Record<string, string> = {};
    for (const question of form.questions) {
      if (!question.required) continue;
      const value = answers[question.code];
      const filled =
        question.type === "RATING"
          ? value?.rating != null
          : question.type === "DATE"
            ? Boolean(value?.date)
            : Boolean(value?.text?.trim());
      if (!filled) nextErrors[question.code] = "Esta pergunta é obrigatória.";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setFormError("Faltam respostas obrigatórias. Elas estão destacadas abaixo.");
      const first = document.querySelector<HTMLElement>("[data-sat-invalid='true']");
      first?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    setFormError(null);
    setSubmitting(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);

    try {
      const turnstileToken =
        (document.querySelector<HTMLInputElement>("[name='cf-turnstile-response']")?.value ??
          null) || null;

      const result = await postJson("/api/public/satisfaction/submit", {
        answers: buildAnswerPayload(),
        respondentName,
        respondentPhone,
        declaredCompanyName: form.requiresSelfIdentification
          ? answers.CUSTOMER_NAME?.text ?? null
          : null,
        declaredTaxId: form.requiresSelfIdentification ? answers.TAX_ID?.text ?? null : null,
        idempotencyKey: idempotencyKey.current,
        turnstileToken,
      });

      if (result?.ok) {
        setPhase({ kind: "done" });
        return;
      }
      if (result?.reason === "VALIDATION") {
        const issueMap: Record<string, string> = {};
        for (const issue of result.issues ?? []) {
          issueMap[issue.questionCode] = issue.message;
        }
        setErrors(issueMap);
        setFormError("Revise as respostas destacadas.");
      } else if (result?.reason === "ALREADY_ANSWERED") {
        setPhase({ kind: "done" });
      } else {
        setFormError(result?.message ?? "Não foi possível enviar. Tente novamente.");
      }
    } catch {
      setFormError("Falha de conexão ao enviar. Verifique a internet e tente de novo.");
    } finally {
      setSubmitting(false);
    }
  };

  if (phase.kind === "loading") return <LoadingScreen />;
  if (phase.kind === "unavailable") {
    return <MessageScreen reason={phase.reason} message={phase.message} />;
  }
  if (phase.kind === "done") {
    return (
      <div className="sat-centered">
        <div className="sat-message-card" role="status" aria-live="polite">
          <div className="sat-message-icon" aria-hidden="true">
            🎉
          </div>
          <h1 className="sat-message-title">Respostas enviadas!</h1>
          <p className="sat-message-text">
            Obrigado por dedicar seu tempo. Sua opinião é usada para melhorar nosso
            atendimento, prazo e qualidade.
          </p>
        </div>
      </div>
    );
  }

  const activeForm = phase.form;

  return (
    <div className="sat-shell">
      <div className="sat-container">
        <header className="sat-header">
          <p className="sat-eyebrow">Pesquisa de satisfação</p>
          <h1 className="sat-title">{activeForm.surveyTitle}</h1>
          {activeForm.customerDisplayName ? (
            <p className="sat-subtitle">{activeForm.customerDisplayName}</p>
          ) : null}
          {activeForm.surveyDescription ? (
            <p className="sat-subtitle">{activeForm.surveyDescription}</p>
          ) : null}
        </header>

        <div className="sat-card">
          <p className="sat-progress-text">
            {progress.answered} de {progress.total} perguntas obrigatórias respondidas
          </p>
          <div
            className="sat-progress"
            role="progressbar"
            aria-valuenow={progress.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Progresso do preenchimento"
          >
            <div className="sat-progress-bar" style={{ width: `${progress.percent}%` }} />
          </div>
        </div>

        {formError ? (
          <div className="sat-alert sat-alert-error" role="alert">
            {formError}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} noValidate>
          {activeForm.questions.map((question) => {
            const value = answers[question.code];
            const error = errors[question.code];
            const errorId = `err-${question.code}`;

            return (
              <div
                className="sat-card"
                key={question.code}
                data-sat-invalid={error ? "true" : "false"}
              >
                {question.type === "RATING" ? (
                  <fieldset className="sat-scale-fieldset" style={{ border: 0, padding: 0, margin: 0 }}>
                    <legend className="sat-question-label">
                      {question.label}
                      {question.required ? (
                        <span className="sat-required" aria-hidden="true">
                          *
                        </span>
                      ) : null}
                    </legend>
                    {question.helpText ? <p className="sat-help">{question.helpText}</p> : null}
                    <div className="sat-scale">
                      {activeForm.ratingScale.map((option) => {
                        const selected = value?.rating === option.value;
                        return (
                          <label
                            key={option.value}
                            className={`sat-scale-option${selected ? " is-selected" : ""}`}
                          >
                            <input
                              type="radio"
                              name={question.code}
                              value={option.value}
                              checked={selected}
                              onChange={() => setRating(question.code, option.value)}
                              aria-describedby={error ? errorId : undefined}
                            />
                            <span className="sat-scale-value">{option.value}</span>
                            {/* O significado nunca depende só de cor ou número. */}
                            <span className="sat-scale-text">{option.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                ) : question.type === "DATE" ? (
                  <>
                    <label className="sat-question-label" htmlFor={`q-${question.code}`}>
                      {question.label}
                      {question.required ? <span className="sat-required">*</span> : null}
                    </label>
                    <input
                      id={`q-${question.code}`}
                      className="sat-input"
                      type="date"
                      value={value?.date ?? ""}
                      onChange={(e) => setDate(question.code, e.target.value)}
                      aria-invalid={error ? "true" : undefined}
                      aria-describedby={error ? errorId : undefined}
                    />
                  </>
                ) : question.type === "TEXT" ? (
                  <>
                    <label className="sat-question-label" htmlFor={`q-${question.code}`}>
                      {question.label}
                      {question.required ? <span className="sat-required">*</span> : null}
                    </label>
                    <textarea
                      id={`q-${question.code}`}
                      className="sat-textarea"
                      maxLength={4000}
                      value={value?.text ?? ""}
                      onChange={(e) => setText(question.code, e.target.value)}
                      aria-invalid={error ? "true" : undefined}
                      aria-describedby={error ? errorId : undefined}
                    />
                    <p className="sat-counter">{(value?.text ?? "").length}/4000</p>
                  </>
                ) : (
                  <>
                    <label className="sat-question-label" htmlFor={`q-${question.code}`}>
                      {question.label}
                      {question.required ? <span className="sat-required">*</span> : null}
                    </label>
                    <input
                      id={`q-${question.code}`}
                      className="sat-input"
                      type={question.type === "PHONE" ? "tel" : "text"}
                      inputMode={question.type === "PHONE" ? "tel" : undefined}
                      autoComplete={question.type === "PHONE" ? "tel" : "organization"}
                      value={value?.text ?? ""}
                      onChange={(e) => setText(question.code, e.target.value)}
                      aria-invalid={error ? "true" : undefined}
                      aria-describedby={error ? errorId : undefined}
                    />
                  </>
                )}

                {error ? (
                  <p className="sat-field-error" id={errorId} role="alert">
                    {error}
                  </p>
                ) : null}
              </div>
            );
          })}

          {activeForm.turnstileSiteKey ? (
            <div className="sat-card">
              <div
                className="cf-turnstile"
                data-sitekey={activeForm.turnstileSiteKey}
                data-appearance="interaction-only"
              />
            </div>
          ) : null}

          <div className="sat-actions">
            <button className="sat-button" type="submit" disabled={submitting}>
              {submitting ? "Enviando…" : "Enviar respostas"}
            </button>
            <p className="sat-status" aria-live="polite">
              {saveHint}
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
