import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { HttpError } from "@/src/lib/http";
import {
  downloadAuthenticatedFile,
  loadPendingPolicy,
  reauthForPolicy,
  signPolicy,
  submitPolicyAttempt,
  uploadPolicyPhoto,
  type PendingPolicy,
} from "@/src/lib/commercialPolicy/commercialPolicyClient";
import { isOfficialCommercialPolicyContent } from "@/src/lib/commercialPolicy/official/polCom001V1View.js";
import { CommercialPolicyReader } from "@/src/components/security/CommercialPolicyReader";

const STEPS = [
  "Política",
  "Principais regras",
  "Teste",
  "Declarações",
  "Identidade",
  "Registro visual",
  "Assinar",
];

export const CommercialPolicyAcceptancePage: React.FC = () => {
  const { authUser, loadMe, logout } = useAuth();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [step, setStep] = useState(0);
  const [policy, setPolicy] = useState<PendingPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [explanations, setExplanations] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [password, setPassword] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [reviewChapterId, setReviewChapterId] = useState<string | null>(null);
  const [signed, setSigned] = useState<{ id: string; acceptedAt: string } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadPendingPolicy()
      .then((data) => {
        if (cancelled) return;
        if (!data.pending || !data.version) {
          navigate("/home", { replace: true });
          return;
        }
        setPolicy(data.version);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Não foi possível abrir a política.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  useEffect(() => {
    return () => {
      const stream = videoRef.current?.srcObject;
      if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const fail = (err: unknown) => {
    setError(err instanceof HttpError ? err.message : err instanceof Error ? err.message : "Não foi possível continuar.");
  };

  const startCamera = async () => {
    setError(null);
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
    }
  };

  const capture = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    setPreview(dataUrl);
    setPhotoId(null);
  };

  const confirmPhoto = async () => {
    if (!policy || !challengeId || !preview) return;
    setBusy(true);
    setError(null);
    try {
      const imageBase64 = preview.split(",")[1] ?? "";
      const saved = await uploadPolicyPhoto({
        policyVersionId: policy.id,
        challengeId,
        mimeType: "image/jpeg",
        imageBase64,
      });
      setPhotoId(saved.photoId);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const sign = async () => {
    if (!policy || !challengeId || !photoId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await signPolicy({
        policyVersionId: policy.id,
        challengeId,
        photoId,
        declarations: policy.declarations,
      });
      setSigned({ id: result.acceptanceId, acceptedAt: result.acceptedAt });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!policy) {
    return <p className="p-8 text-sm text-muted-foreground">{error ?? "Nenhuma política pendente."}</p>;
  }

  if (signed) {
    return (
      <div className="min-h-screen bg-background px-4 py-10">
        <div className="mx-auto max-w-lg space-y-4 rounded-2xl border border-border bg-card p-6">
          <h1 className="text-lg font-bold">Política Comercial assinada com sucesso.</h1>
          <p className="text-sm">Versão {policy.version}</p>
          <p className="text-sm">Data/hora do servidor: {new Date(signed.acceptedAt).toLocaleString("pt-BR")}</p>
          <p className="break-all text-xs text-muted-foreground">Acceptance ID {signed.id}</p>
          <button
            type="button"
            className="rounded-lg border border-border px-3 py-2 text-sm font-semibold"
            onClick={() => void downloadAuthenticatedFile(`/api/commercial-policy/acceptances/${signed.id}/receipt`, `comprovante-${signed.id}.pdf`)}
          >
            Baixar comprovante de aceite
          </button>
          <button
            type="button"
            className="block rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
            onClick={() => {
              void loadMe().then(() => navigate("/home", { replace: true }));
            }}
          >
            Entrar no IndusCost
          </button>
        </div>
      </div>
    );
  }

  if (step === 0 && isOfficialCommercialPolicyContent(policy.content)) {
    return (
      <div className="flex h-screen flex-col bg-background">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
          <p className="text-xs font-semibold text-muted-foreground">Etapa 1 de {STEPS.length} — Leitura</p>
          <button type="button" className="text-xs font-semibold" onClick={() => void logout().then(() => navigate("/login", { replace: true }))}>
            Sair
          </button>
        </div>
        {error ? <p className="px-4 py-2 text-xs text-red-800">{error}</p> : null}
        <CommercialPolicyReader
          effectiveFrom={policy.effectiveFrom}
          initialChapterId={reviewChapterId}
          onGeneratePdf={() => void downloadAuthenticatedFile(`/api/commercial-policy/versions/${policy.id}/document`, "POL-COM-001-copia-controlada.pdf")}
          onFinish={() => setStep(1)}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold text-muted-foreground">
            Etapa {step + 1} de {STEPS.length} — {STEPS[step]}
          </p>
          <button
            type="button"
            className="text-xs font-semibold text-muted-foreground"
            onClick={() => void logout().then(() => navigate("/login", { replace: true }))}
          >
            Sair
          </button>
        </div>
        <div className="h-1.5 rounded-full bg-muted">
          <div className="h-1.5 rounded-full bg-primary" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </div>
        {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p> : null}

        {step === 0 ? (
          <section className="space-y-3 rounded-2xl border border-border bg-card p-5">
            <h1 className="text-lg font-bold">{policy.title}</h1>
            <p className="text-xs text-muted-foreground">
              Versão {policy.version}. Vigência {new Date(policy.effectiveFrom).toLocaleString("pt-BR")}. Publicada{" "}
              {policy.publishedAt ? new Date(policy.publishedAt).toLocaleString("pt-BR") : "—"}.
            </p>
            <p className="break-all text-[11px] text-muted-foreground">SHA-256 {policy.contentHash}</p>
            <p className="text-xs text-muted-foreground">
              {authUser?.name} · {authUser?.email} · SELLER
              {authUser?.externalSellerId ? ` · Nomus ${authUser.externalSellerId}` : ""}
            </p>
            <article className="max-h-[28rem] overflow-auto whitespace-pre-wrap text-sm leading-relaxed">
              {policy.content}
            </article>
            <button
              type="button"
              className="text-xs font-semibold text-primary"
              onClick={() => void downloadAuthenticatedFile(`/api/commercial-policy/versions/${policy.id}/document`, "politica-comercial.pdf")}
            >
              Baixar cópia
            </button>
            <div className="flex justify-end">
              <button type="button" className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground" onClick={() => setStep(1)}>
                Li o documento
              </button>
            </div>
          </section>
        ) : null}

        {step === 1 ? (
          <section className="space-y-3 rounded-2xl border border-border bg-card p-5">
            <h1 className="text-lg font-bold">O que você precisa entender</h1>
            <p className="text-xs text-muted-foreground">Trechos do documento oficial. O texto integral permanece na leitura.</p>
            <ul className="list-disc space-y-2 pl-5 text-sm">
              {policy.summaryRules.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
            <div className="flex justify-between">
              <button type="button" className="text-xs font-semibold" onClick={() => setStep(0)}>Voltar</button>
              <button type="button" className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground" onClick={() => setStep(2)}>
                Continuar
              </button>
            </div>
          </section>
        ) : null}

        {step === 2 ? (
          <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
            <h1 className="text-lg font-bold">Teste de compreensão</h1>
            {policy.questions.map((question) => (
              <fieldset key={question.id} className="space-y-2">
                <legend className="text-sm font-semibold">{question.prompt}</legend>
                {question.options.map((option) => (
                  <label key={option.id} className="flex items-start gap-2 text-sm">
                    <input
                      type="radio"
                      name={question.id}
                      checked={answers[question.id] === option.id}
                      onChange={() => setAnswers((current) => ({ ...current, [question.id]: option.id }))}
                    />
                    {option.text}
                  </label>
                ))}
                {explanations[question.id] ? (
                  <div className="space-y-1">
                    <p className="text-xs text-amber-800">{explanations[question.id]}</p>
                    {question.reviewChapterId ? (
                      <button
                        type="button"
                        className="text-xs font-semibold text-primary"
                        onClick={() => {
                          setReviewChapterId(question.reviewChapterId ?? null);
                          setStep(0);
                        }}
                      >
                        Revisar regra
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </fieldset>
            ))}
            <div className="flex justify-between">
              <button type="button" className="text-xs font-semibold" onClick={() => setStep(1)}>Voltar</button>
              <button
                type="button"
                disabled={busy}
                className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                onClick={() => {
                  setBusy(true);
                  setError(null);
                  void submitPolicyAttempt(
                    policy.id,
                    policy.questions.map((question) => ({ questionId: question.id, optionId: answers[question.id] ?? "" }))
                  )
                    .then((result) => {
                      if (!result.passed) {
                        const next: Record<string, string> = {};
                        for (const item of result.results) {
                          if (!item.correct) next[item.questionId] = item.explanation;
                        }
                        setExplanations(next);
                        setError("Algumas respostas precisam ser corrigidas. Você pode tentar de novo.");
                        return;
                      }
                      setExplanations({});
                      setStep(3);
                    })
                    .catch(fail)
                    .finally(() => setBusy(false));
                }}
              >
                Conferir respostas
              </button>
            </div>
          </section>
        ) : null}

        {step === 3 ? (
          <section className="space-y-3 rounded-2xl border border-border bg-card p-5">
            <h1 className="text-lg font-bold">Declarações</h1>
            {policy.declarations.map((line, index) => (
              <label key={line} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={checked[index] === true}
                  onChange={(event) => setChecked((current) => ({ ...current, [index]: event.target.checked }))}
                />
                {line}
              </label>
            ))}
            <div className="flex justify-between">
              <button type="button" className="text-xs font-semibold" onClick={() => setStep(2)}>Voltar</button>
              <button
                type="button"
                className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                disabled={policy.declarations.some((_, index) => !checked[index])}
                onClick={() => setStep(4)}
              >
                Continuar
              </button>
            </div>
          </section>
        ) : null}

        {step === 4 ? (
          <section className="space-y-3 rounded-2xl border border-border bg-card p-5">
            <h1 className="text-lg font-bold">Confirme sua identidade</h1>
            <p className="text-sm text-muted-foreground">Digite sua senha atual para confirmar que é você quem está realizando este aceite.</p>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm"
            />
            <div className="flex justify-between">
              <button type="button" className="text-xs font-semibold" onClick={() => setStep(3)}>Voltar</button>
              <button
                type="button"
                disabled={busy || password.length === 0}
                className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                onClick={() => {
                  setBusy(true);
                  setError(null);
                  void reauthForPolicy(policy.id, password)
                    .then((result) => {
                      setPassword("");
                      setChallengeId(result.challengeId);
                      setStep(5);
                    })
                    .catch(fail)
                    .finally(() => setBusy(false));
                }}
              >
                Confirmar senha
              </button>
            </div>
          </section>
        ) : null}

        {step === 5 ? (
          <section className="space-y-3 rounded-2xl border border-border bg-card p-5">
            <h1 className="text-lg font-bold">Registro visual do aceite</h1>
            <p className="text-sm text-muted-foreground">
              A fotografia será armazenada de forma restrita como evidência adicional do ato de aceite. Não há reconhecimento facial.
            </p>
            <video ref={videoRef} className="w-full rounded-lg bg-black" playsInline muted />
            {preview ? <img src={preview} alt="Prévia da captura" className="w-full rounded-lg" /> : null}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="rounded-lg border border-border px-3 py-2 text-xs font-semibold" onClick={() => void startCamera().catch(fail)}>
                Abrir câmera
              </button>
              <button type="button" className="rounded-lg border border-border px-3 py-2 text-xs font-semibold" onClick={capture}>
                Tirar novamente
              </button>
              <button type="button" disabled={!preview || busy} className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50" onClick={() => void confirmPhoto()}>
                Usar esta foto
              </button>
            </div>
            <div className="flex justify-end">
              <button type="button" disabled={!photoId} className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50" onClick={() => setStep(6)}>
                Continuar
              </button>
            </div>
          </section>
        ) : null}

        {step === 6 ? (
          <section className="space-y-3 rounded-2xl border border-border bg-card p-5">
            <h1 className="text-lg font-bold">Assinar</h1>
            <p className="text-sm">
              {authUser?.name} vai assinar a versão {policy.version} agora. O horário oficial é o do servidor.
            </p>
            <button
              type="button"
              disabled={busy || !photoId || !challengeId}
              className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
              onClick={() => void sign()}
            >
              {busy ? "Registrando…" : "ASSINAR ELETRONICAMENTE E ACEITAR"}
            </button>
          </section>
        ) : null}
      </div>
    </div>
  );
};
