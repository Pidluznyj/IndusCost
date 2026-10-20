/**
 * Guia do primeiro ciclo: os passos na ordem, cada um com estado e atalho. Some sozinho quando o
 * ciclo está aberto e com convites emitidos, ou quando o RH o fecha.
 */
import React, { useState } from "react";
import { CheckCircle2, ChevronRight, Circle } from "lucide-react";
import { OverlayBadge } from "@/src/components/ui/overlay";
import type { CycleCounts, CycleSummary, ModelSummary } from "@/src/lib/hrPerformance/performanceClient";
import { BTN_GHOST, PANEL } from "./performanceUi";

export type GuideStepId = "model" | "leadership" | "cycle" | "people" | "readiness" | "open" | "invites";

export function FirstCycleGuide({
  models,
  cycle,
  counts,
  readinessOk,
  onGo,
}: {
  models: ModelSummary[];
  cycle: CycleSummary | null;
  counts: CycleCounts | null;
  readinessOk: boolean | null;
  onGo: (step: GuideStepId) => void;
}) {
  const [hidden, setHidden] = useState(() => {
    try {
      return sessionStorage.getItem("ic-perf-guide-hidden") === "1";
    } catch {
      return false;
    }
  });
  const modelOk = models.some((m) => m.status === "PUBLISHED" && m.kind !== "LEADERSHIP");
  const leadershipOk = models.some((m) => m.status === "PUBLISHED" && m.kind === "LEADERSHIP");
  const cycleOk = Boolean(cycle);
  const peopleOk = Boolean(counts && counts.eligible + counts.notEligible + counts.insufficient > 0);
  const status = cycle?.status ?? "DRAFT";
  const opened = ["OPEN", "CONSOLIDATION", "CALIBRATION", "HOMOLOGATED", "CLOSED"].includes(status);
  const invitesOk = Boolean(counts && counts.invited > 0);
  if (hidden || (opened && invitesOk)) return null;
  const steps: { id: GuideStepId; label: string; done: boolean; hint: string }[] = [
    { id: "model", label: "Publicar o modelo de avaliação", done: modelOk, hint: "12 perguntas em três pilares. Revise os textos e publique." },
    { id: "leadership", label: "Publicar o modelo de liderança (180°)", done: leadershipOk, hint: "8 competências; sem ele ninguém avalia o próprio líder." },
    { id: "cycle", label: "Criar o ciclo", done: cycleOk, hint: "Nome, período, tipo e prazos. A 180° já vem escolhida." },
    { id: "people", label: "Incluir as pessoas", done: peopleOk, hint: "Pelo líder (equipe ou árvore) ou uma a uma. A prévia mostra quem entra." },
    { id: "readiness", label: "Conferir a prontidão", done: readinessOk === true, hint: "Líderes dentro, acessos e topo. Cada pendência tem um clique de solução." },
    { id: "open", label: "Preparar e abrir", done: opened, hint: "Congela a lista e cria as avaliações de cada pessoa." },
    { id: "invites", label: "Gerar e entregar os convites", done: invitesOk, hint: "QR impresso e código falado. Depois, acompanhe na Central." },
  ];
  const next = steps.find((s) => !s.done);
  const done = steps.filter((s) => s.done).length;
  return (
    <section className={`${PANEL} p-4`} data-testid="perf-first-cycle-guide">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Seu caminho até a primeira pesquisa</p>
          <p className="text-xs text-muted-foreground">
            {done} de {steps.length} passos prontos{next ? ` · próximo: ${next.label.toLowerCase()}` : ""}
          </p>
        </div>
        <button
          type="button"
          className={BTN_GHOST}
          onClick={() => {
            setHidden(true);
            try {
              sessionStorage.setItem("ic-perf-guide-hidden", "1");
            } catch {
              /* sem memória */
            }
          }}
          data-testid="perf-guide-hide"
        >
          Esconder guia
        </button>
      </div>
      <ol className="mt-3 grid gap-2 md:grid-cols-2">
        {steps.map((s, i) => (
          <li key={s.id} className={`flex items-start gap-2 rounded-lg border p-2 ${s.id === next?.id ? "border-primary bg-primary/5" : "border-border"}`} data-testid={`perf-guide-step-${s.id}`}>
            {s.done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {i + 1}. {s.label} {s.id === next?.id ? <OverlayBadge tone="primary">agora</OverlayBadge> : null}
              </p>
              <p className="text-xs text-muted-foreground">{s.hint}</p>
            </div>
            {!s.done ? (
              <button type="button" className={BTN_GHOST} onClick={() => onGo(s.id)} aria-label={`Ir para: ${s.label}`} data-testid={`perf-guide-go-${s.id}`}>
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
