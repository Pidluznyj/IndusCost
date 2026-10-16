/**
 * Portal do colaborador. Uma pergunta por tela. O código do QR não fica na query.
 */
import React, { useEffect, useMemo, useState } from "react";
import { FREQUENCY_SCALE, NOT_OBSERVED_LABEL, PILLAR_LABELS, type Pillar } from "@/src/lib/hrPerformance/performanceDomain";
import { fetchPerformanceForm, openPerformanceInvite, savePerformanceForm, submitPerformanceForm, verifyPerformanceOtp } from "@/src/lib/hrPerformance/performanceClient";

async function claimAssist(token: string) {
  const response = await fetch("/api/public/performance/assist", { cache: "no-store", credentials: "same-origin", method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
  return response.json() as Promise<{ ok: boolean; message?: string }>;
}

type FormState = {
  employeeName: string;
  periodLabel: string;
  version: number;
  questions: { code: string; text: string; pillar: string }[];
  selected: Record<string, { kind: "score"; score: number } | { kind: "notObserved" } | { kind: "pending" }>;
};

export function PerformancePortalPage() {
  const [step, setStep] = useState<"code" | "form" | "review" | "done" | "error">("code");
  const [message, setMessage] = useState("Digite o código que o RH entregou separado do QR.");
  const [otp, setOtp] = useState("");
  const [form, setForm] = useState<FormState | null>(null);
  const [index, setIndex] = useState(0);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const assisted = params.get("a");
    const raw = params.get("t");
    if (!raw && !assisted) return;
    window.history.replaceState(null, "", window.location.pathname);
    if (assisted) {
      void claimAssist(assisted).then((result) => {
        if (!result.ok) {
          setStep("error");
          setMessage(result.message || "Não foi possível abrir esta pesquisa.");
          return;
        }
        void loadForm();
      });
      return;
    }
    void openPerformanceInvite(raw || "").then((result) => {
      if (!result.ok) {
        setStep("error");
        setMessage(result.message || "Não foi possível abrir esta pesquisa.");
      }
    });
  }, []);

  const question = form?.questions[index];
  const progress = useMemo(() => (form ? `Pergunta ${index + 1} de ${form.questions.length}` : ""), [form, index]);

  async function loadForm() {
    const result = await fetchPerformanceForm();
    if (!result.ok || !result.questions || result.version == null) {
      setStep("error");
      setMessage(result.message || "Não foi possível abrir esta pesquisa.");
      return;
    }
    const selected: FormState["selected"] = {};
    for (const answer of result.answers ?? []) {
      if (answer.kind === "score" && answer.score) selected[answer.questionCode] = { kind: "score", score: answer.score };
      else if (answer.kind === "notObserved") selected[answer.questionCode] = { kind: "notObserved" };
      else selected[answer.questionCode] = { kind: "pending" };
    }
    setForm({
      employeeName: result.employeeName || "",
      periodLabel: result.periodLabel || "",
      version: result.version,
      questions: result.questions,
      selected,
    });
    setStep("form");
  }

  async function persist(next: FormState) {
    setSaving("saving");
    const answers = next.questions
      .filter((item) => next.selected[item.code] && next.selected[item.code].kind !== "pending")
      .map((item) => ({ code: item.code, answer: next.selected[item.code] }));
    const saved = await savePerformanceForm(next.version, answers);
    if (!saved.ok || saved.version == null) {
      setSaving("error");
      setMessage(saved.message || "Não conseguimos salvar. Tente de novo.");
      return null;
    }
    setSaving("saved");
    return { ...next, version: saved.version };
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col gap-4 bg-background px-4 py-6 text-foreground">
      <p className="text-sm font-medium text-primary">IndusCost</p>
      <h1 className="text-2xl font-semibold">Como você age no trabalho</h1>
      {step === "code" && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void verifyPerformanceOtp(otp).then((result) => {
              if (!result.ok) {
                setMessage(result.message || "Não foi possível abrir esta pesquisa.");
                return;
              }
              void loadForm();
            });
          }}
        >
          <p>{message}</p>
          <label className="text-sm font-medium" htmlFor="otp">Código de confirmação</label>
          <input id="otp" inputMode="numeric" autoComplete="one-time-code" className="min-h-11 rounded-xl border border-border px-3 text-lg" value={otp} onChange={(event) => setOtp(event.target.value)} />
          <button type="submit" className="min-h-11 rounded-xl bg-primary px-4 font-semibold text-primary-foreground">Continuar</button>
        </form>
      )}
      {step === "form" && form && question && (
        <section className="flex flex-1 flex-col gap-4">
          <p className="text-sm text-muted-foreground">{form.employeeName} · {form.periodLabel}</p>
          <p className="text-sm font-medium">{progress}</p>
          <p className="text-sm text-primary">{PILLAR_LABELS[question.pillar as Pillar] ?? question.pillar}</p>
          <h2 className="text-xl leading-snug">{question.text}</h2>
          <div className="flex flex-col gap-2" role="radiogroup" aria-label={question.text}>
            {FREQUENCY_SCALE.map((item) => (
              <button
                key={item.score}
                type="button"
                className={`min-h-11 rounded-xl border px-4 text-left text-base ${form.selected[question.code]?.kind === "score" && form.selected[question.code]?.score === item.score ? "border-primary bg-primary/10" : "border-border"}`}
                onClick={() => setForm({ ...form, selected: { ...form.selected, [question.code]: { kind: "score", score: item.score } } })}
              >
                {item.label}
              </button>
            ))}
            <button
              type="button"
              className={`min-h-11 rounded-xl border px-4 text-left ${form.selected[question.code]?.kind === "notObserved" ? "border-primary bg-primary/10" : "border-border"}`}
              onClick={() => setForm({ ...form, selected: { ...form.selected, [question.code]: { kind: "notObserved" } } })}
            >
              {NOT_OBSERVED_LABEL}
            </button>
          </div>
          <p className="text-xs text-muted-foreground" aria-live="polite">{saving === "saved" ? "Salvo" : saving === "saving" ? "Salvando…" : saving === "error" ? message : ""}</p>
          <div className="mt-auto flex gap-2">
            <button type="button" className="min-h-11 flex-1 rounded-xl border border-border" disabled={index === 0} onClick={() => setIndex((value) => Math.max(0, value - 1))}>Voltar</button>
            <button
              type="button"
              className="min-h-11 flex-1 rounded-xl bg-primary font-semibold text-primary-foreground"
              onClick={() => {
                void persist(form).then((next) => {
                  if (!next) return;
                  setForm(next);
                  if (index < form.questions.length - 1) setIndex(index + 1);
                  else setStep("review");
                });
              }}
            >
              {index < form.questions.length - 1 ? "Próxima" : "Revisar"}
            </button>
          </div>
        </section>
      )}
      {step === "review" && form && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Confira antes de enviar</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {form.questions.map((item) => {
              const answer = form.selected[item.code];
              const label = !answer || answer.kind === "pending" ? "Sem resposta" : answer.kind === "notObserved" ? NOT_OBSERVED_LABEL : FREQUENCY_SCALE.find((scale) => scale.score === answer.score)?.label;
              return <li key={item.code} className="rounded-lg border border-border p-3"><p>{item.text}</p><p className="font-medium">{label}</p></li>;
            })}
          </ul>
          <button type="button" className="min-h-11 rounded-xl border border-border" onClick={() => setStep("form")}>Voltar</button>
          <button
            type="button"
            className="min-h-11 rounded-xl bg-primary font-semibold text-primary-foreground"
            onClick={() => {
              const missing = form.questions.some((item) => !form.selected[item.code] || form.selected[item.code].kind === "pending");
              if (missing) {
                setMessage("Responda todas as perguntas antes de enviar.");
                return;
              }
              void persist(form).then((next) => {
                if (!next) return;
                void submitPerformanceForm(next.version).then((result) => {
                  if (!result.ok) {
                    setMessage(result.message || "Não foi possível enviar.");
                    return;
                  }
                  setStep("done");
                });
              });
            }}
          >
            Enviar
          </button>
          {message && <p className="text-sm">{message}</p>}
        </section>
      )}
      {step === "done" && <p className="text-lg">Pronto. Sua resposta foi enviada e não pode mais ser alterada por este link.</p>}
      {step === "error" && <p>{message}</p>}
    </main>
  );
}
