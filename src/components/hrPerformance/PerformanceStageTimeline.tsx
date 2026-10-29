/**
 * Linha do tempo das etapas do ciclo (Autoavaliação → Avaliação do líder → Avaliação da liderança →
 * Calibração e devolutiva → Encerramento), com as datas e a etapa de hoje. Só leitura: a regra das janelas
 * mora no servidor (performanceStages), aqui ela só é desenhada.
 */
import React from "react";
import { currentStage, hasStageSchedule, localDay, stageWindows, windowState, type StageCycle } from "@/src/lib/hrPerformance/performanceStages";
import { cn } from "@/src/lib/utils";

const dayBr = (iso: string | null) => (iso ? iso.split("-").reverse().slice(0, 2).join("/") : "—");

export function PerformanceStageTimeline({ cycle, now = new Date() }: { cycle: StageCycle; now?: Date }) {
  const today = localDay(now);
  const stage = currentStage(cycle, today);
  const scheduled = hasStageSchedule(cycle);
  const windows = stageWindows(cycle);
  const collecting = cycle.status === "OPEN";
  const closed = cycle.status === "CLOSED";
  const steps = [
    ...windows.map((w) => {
      const state: "DONE" | "NOW" | "NEXT" =
        closed || (w.key !== "CALIBRATION" && !collecting && cycle.status !== "DRAFT" && cycle.status !== "PREPARED")
          ? "DONE"
          : w.key === "CALIBRATION"
            ? stage.key === "CALIBRATION"
              ? "NOW"
              : "NEXT"
            : collecting
              ? !scheduled
                ? "NOW"
                : windowState(w, today) === "AFTER"
                  ? "DONE"
                  : windowState(w, today) === "OPEN"
                    ? "NOW"
                    : "NEXT"
              : "NEXT";
      return { key: w.key, index: w.index, label: w.label, who: w.who, startsAt: w.key === "SELF" || w.key === "LEADER" || scheduled ? w.startsAt : null, endsAt: w.endsAt, state };
    }),
    { key: "CLOSED", index: windows.length + 1, label: "Encerramento", who: "Devolutivas registradas e ciclo encerrado", startsAt: null, endsAt: null, state: closed ? ("NOW" as const) : ("NEXT" as const) },
  ];
  return (
    <div className="space-y-2" data-testid="perf-stage-timeline">
      <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5" aria-label="Etapas da avaliação">
        {steps.map((step) => (
          <li
            key={step.key}
            aria-current={step.state === "NOW" ? "step" : undefined}
            data-testid={`perf-stage-${step.key}`}
            data-state={step.state}
            className={cn(
              "rounded-lg border px-3 py-2",
              step.state === "NOW" ? "border-primary bg-primary/10" : step.state === "DONE" ? "border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/30" : "border-border bg-card"
            )}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {step.index}. {step.state === "DONE" ? "Concluída" : step.state === "NOW" ? "Agora" : "A seguir"}
            </p>
            <p className="text-sm font-semibold">{step.label}</p>
            <p className="text-xs text-muted-foreground">{step.who}</p>
            {step.startsAt || step.endsAt ? (
              <p className="mt-1 text-xs font-medium">
                {step.startsAt ? `${dayBr(step.startsAt)} a ${dayBr(step.endsAt)}` : `até ${dayBr(step.endsAt)}`}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
      {collecting && !scheduled ? (
        <p className="text-xs text-muted-foreground" data-testid="perf-stage-legacy">
          Ciclo sem calendário de etapas: autoavaliação, líder e liderança ficam abertos ao mesmo tempo até os prazos.
        </p>
      ) : null}
      {stage.advice ? (
        <p className="text-sm text-foreground" data-testid="perf-stage-advice">
          <strong>Próximo passo:</strong> {stage.advice}
        </p>
      ) : null}
    </div>
  );
}

/** O ciclo como a linha do tempo precisa (o resumo do cliente traz as datas de etapa como opcionais). */
export function toStageCycle(cycle: {
  status: string;
  leadershipModelId?: string | null;
  selfDueAt: string;
  leaderDueAt: string;
  selfStartAt?: string | null;
  leaderStartAt?: string | null;
  leadershipStartAt?: string | null;
  leadershipDueAt?: string | null;
  calibrationStartAt?: string | null;
  calibrationDueAt?: string | null;
}): StageCycle {
  return {
    status: cycle.status as StageCycle["status"],
    leadershipModelId: cycle.leadershipModelId ?? null,
    selfDueAt: cycle.selfDueAt,
    leaderDueAt: cycle.leaderDueAt,
    selfStartAt: cycle.selfStartAt ?? null,
    leaderStartAt: cycle.leaderStartAt ?? null,
    leadershipStartAt: cycle.leadershipStartAt ?? null,
    leadershipDueAt: cycle.leadershipDueAt ?? null,
    calibrationStartAt: cycle.calibrationStartAt ?? null,
    calibrationDueAt: cycle.calibrationDueAt ?? null,
  };
}
